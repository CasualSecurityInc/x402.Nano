/**
 * FacilitatorHandler implementation for x402/Faremeter compatibility
 * Handles nano-session payment verification and settlement
 */

import {
  SCHEME,
  NETWORK,
  assertValidPaymentRequirements,
  assertValidRawAmount,
  createPaymentRequirements,
  createSignatureRequirements,
  deriveAddressFromSeed
} from '@nanosession/core';
import {
  derivePublicKey,
  deriveSecretKey,
  createBlock,
  verifyBlock
} from 'nanocurrency';
import { generateWork as generateWorkRsp, WorkType } from 'nano-rspow-node';
import blakejs from 'blakejs';
import debug from 'debug';
import type { PaymentRequirements, PaymentPayload } from '@nanosession/core';
import type { NanoRpcClient } from '@nanosession/rpc';
import type { SpentSetStorage } from './spent-set.js';
import { InMemorySpentSet } from './spent-set.js';
import { randomBytes } from 'crypto';

const { blake2bHex } = blakejs;
const log = debug('nanosession:facilitator');

/**
 * Interface for session storage
 */
export interface SessionRegistry {
  get(sessionId: string): PaymentRequirements | undefined;
  set(sessionId: string, requirements: PaymentRequirements): void;
  delete(sessionId: string): void;
  has(sessionId: string): boolean;
}

/**
 * Configuration options for the handler
 */
export interface HandlerOptions {
  /** Nano RPC client instance */
  rpcClient: NanoRpcClient;
  /** Optional spent set storage (defaults to in-memory) */
  spentSet?: SpentSetStorage;
  /** Optional session storage (defaults to in-memory Map) */
  sessionRegistry?: SessionRegistry;
  /** Seed for generating receive blocks in Track 2 (nanoSignature) */
  seed?: string;
  /** Account index for the Facilitator's wallet. Defaults to 0. */
  accountIndex?: number;
  /** Track 2 Receive Mode. Defaults to 'sync'. */
  receiveMode?: 'sync' | 'async';
}

/**
 * Supported payment scheme information
 */
export interface SupportedScheme {
  /** x402 protocol version */
  x402Version: 2;
  /** Payment scheme identifier */
  scheme: string;
  /** Network identifier (CAIP-2 format) */
  network: string;
}

/**
 * Result of payment verification
 */
export interface VerifyResult {
  /** Whether the payment is valid */
  isValid: boolean;
  /** Error message if verification failed */
  error?: string;
  /** The transaction hash if verified */
  blockHash?: string;
}

/**
 * Result of payment settlement
 */
export interface SettleResult {
  /** Whether settlement succeeded */
  success: boolean;
  /** Transaction hash if successful */
  transactionHash?: string;
  /** Error message if settlement failed */
  error?: string;
}

/**
 * NanoSession Facilitator Handler
 * Implements x402/Faremeter FacilitatorHandler interface
 * 
 * SECURITY: This handler maintains a session registry to prevent session spoofing attacks.
 * Only session IDs issued via getRequirements() are considered valid.
 */
export class NanoSessionFacilitatorHandler {
  private rpcClient: NanoRpcClient;
  private spentSet: SpentSetStorage;
  /**
   * Session registry - maps sessionId to the PaymentRequirements that were issued.
   * This prevents attackers from submitting payments with forged session IDs.
   * See: AGENTS.md § Security-First Protocol Development
   */
  private sessionRegistry: SessionRegistry;
  private activeSessionAmounts: Map<string, string>;
  private seed?: string;
  private accountIndex: number;
  private receiveMode: 'sync' | 'async';

  constructor(options: HandlerOptions) {
    this.rpcClient = options.rpcClient;
    this.spentSet = options.spentSet ?? new InMemorySpentSet();
    this.seed = options.seed;
    this.accountIndex = options.accountIndex ?? 0;
    this.receiveMode = options.receiveMode ?? 'sync';

    // Default implementation using Map
    const inMemoryRegistry = new Map<string, PaymentRequirements>();
    this.sessionRegistry = options.sessionRegistry ?? {
      get: (id) => inMemoryRegistry.get(id),
      set: (id, reqs) => inMemoryRegistry.set(id, reqs),
      delete: (id) => { inMemoryRegistry.delete(id); },
      has: (id) => inMemoryRegistry.has(id)
    };
    this.activeSessionAmounts = new Map();
  }

  private releaseSession(sessionId: string): void {
    this.sessionRegistry.delete(sessionId);
    this.activeSessionAmounts.delete(sessionId);
  }

  private isAmountInUse(amountRaw: string): boolean {
    for (const activeAmount of this.activeSessionAmounts.values()) {
      if (activeAmount === amountRaw) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns the list of payment schemes supported by this facilitator.
   * @returns Array of supported protocol versions, schemes, and networks
   */
  getSupported(): SupportedScheme[] {
    return [
      {
        x402Version: 2,
        scheme: SCHEME,
        network: NETWORK
      }
    ];
  }

  /**
   * Generates new payment requirements for a session.
   * Internally generates a unique session ID and reserved payment tag.
   * 
   * @param args Configuration for the requirements
   * @returns Standard x402 PaymentRequirements object
   */
  getRequirements(args: {
    /** Resource amount in raw, before the tag amount is added */
    resourceAmountRaw: string;
    /** Destination account address */
    payTo: string;
    /** How long before session expires */
    maxTimeoutSeconds?: number;
    /** Optional tag amount in raw (auto-generated if omitted) */
    tagAmountRaw?: string;
  }): PaymentRequirements {
    assertValidRawAmount(args.resourceAmountRaw, 'resourceAmountRaw');
    if (args.tagAmountRaw !== undefined) {
      assertValidRawAmount(args.tagAmountRaw, 'tagAmountRaw');
    }

    const maxTimeoutSeconds = args.maxTimeoutSeconds ?? 600;
    const expiresAt = new Date(Date.now() + maxTimeoutSeconds * 1000).toISOString();

    for (let attempt = 0; attempt < 16; attempt++) {
      const tagAmountRaw = args.tagAmountRaw ??
        randomBytes(8).readBigUInt64BE(0).toString();
      const amount = (BigInt(args.resourceAmountRaw) + BigInt(tagAmountRaw)).toString();

      if (this.isAmountInUse(amount)) {
        if (args.tagAmountRaw !== undefined) {
          throw new Error(`Tagged amount collision for active session: ${amount}`);
        }
        continue;
      }

      const sessionId = randomBytes(16).toString('hex');
      const requirements = createPaymentRequirements({
        payTo: args.payTo,
        maxTimeoutSeconds,
        id: sessionId,
        resourceAmountRaw: args.resourceAmountRaw,
        tagAmountRaw,
        amount,
        expiresAt
      });

      this.sessionRegistry.set(sessionId, requirements);
      this.activeSessionAmounts.set(sessionId, amount);
      return requirements;
    }

    throw new Error('Unable to allocate unique tagged amount for session');
  }

  /**
   * Generates payment requirements for the nanoSignature (stateless) variant.
   * No session ID, no tag — the amount is the clean resource price.
   * Returns a SEPARATE PaymentRequirements from getRequirements().
   *
   * A Facilitator advertising both variants should include BOTH in the accepts array:
   * ```ts
   * const accepts = [
   *   facilitator.getRequirements({ resourceAmountRaw, payTo }),
   *   facilitator.getSignatureRequirements({ amount: resourceAmountRaw, payTo, url })
   * ];
   * ```
   */
  getSignatureRequirements(args: {
    /** Amount in raw (clean resource price) */
    amount: string;
    /** Destination account address */
    payTo: string;
    /** How long before this requirement expires (default: 600s) */
    maxTimeoutSeconds?: number;
    /** The canonical URL for signature binding (required for replay protection) */
    url: string;
    /** Template for the message the client must sign (default: "block_hash+url") */
    messageToSign?: string;
  }): PaymentRequirements {
    return createSignatureRequirements({
      payTo: args.payTo,
      maxTimeoutSeconds: args.maxTimeoutSeconds ?? 600,
      amount: args.amount,
      url: args.url,
      messageToSign: args.messageToSign
    });
  }

  /**
   * Retrieves previously generated requirements for a session.
   * @param sessionId Hexadecimal session identifier
   * @returns The stored requirements, or undefined if not found or expired
   */
  getStoredRequirements(sessionId: string): PaymentRequirements | undefined {
    const requirements = this.sessionRegistry.get(sessionId);
    if (!requirements) {
      return undefined;
    }

    // Check if session has expired
    const expiresAt = requirements.extra?.nanoSession?.expiresAt;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      this.releaseSession(sessionId);
      return undefined;
    }

    return requirements;
  }

  /**
   * Re-registers a session from externally-supplied requirements.
   * Used for recovery when the in-memory registry is lost (e.g. server restart)
   * but the client still holds the original 402 requirements.
   * 
   * @WARNING: This skips session ID verification. Ensure you trust the
   * requirements if you use this to recover state.
   * 
   * @param sessionId Hexadecimal session identifier
   * @param requirements The requirements to register
   */
  registerSessionFromRequirements(sessionId: string, requirements: PaymentRequirements): void {
    assertValidPaymentRequirements(requirements);
    if (requirements.extra.nanoSession?.id !== sessionId) {
      throw new Error('Session ID mismatch in registerSessionFromRequirements');
    }
    this.sessionRegistry.set(sessionId, requirements);
    this.activeSessionAmounts.set(sessionId, requirements.amount);
  }

  /**
   * Verifies that a payment proof (block hash) satisfies the given requirements.
   * Performs cryptographic validation, session checks, and amount verification.
   * 
   * @param requirements The requirements the payment must satisfy
   * @param payload The payment response containing the proof (hash)
   * @returns Verification result with validity status and optional error
   */
  async handleVerify(
    requirements: PaymentRequirements,
    payload: PaymentPayload,
    context?: unknown
  ): Promise<VerifyResult | null> {
    // Return null for non-matching schemes
    if (requirements.scheme !== SCHEME || requirements.network !== NETWORK) {
      return null;
    }

    try {
      assertValidPaymentRequirements(requirements);

      // ── Mutual exclusivity guard ──────────────────────────────────
      // Each variant MUST be in a separate PaymentRequirements object.
      // A single requirement with BOTH extra keys is malformed.
      if (requirements.extra?.nanoSession && requirements.extra?.nanoSignature) {
        return {
          isValid: false,
          error: 'Malformed requirements: nanoSession and nanoSignature are mutually exclusive. Each variant must be a separate PaymentRequirements in the accepts array.'
        };
      }

      // ── nanoSignature (stateless) ──────────────────────────────────
      if (requirements.extra?.nanoSignature) {
        return this.verifyNanoSignature(requirements, payload, context);
      }

      // Track 1: nanoSession (Stateful Compatibility)
      const sessionId = requirements.extra?.nanoSession?.id;
      if (!sessionId) {
        return { isValid: false, error: 'Missing session ID in requirements' };
      }

      // Session Binding: Verify session ID echoed by client
      const payloadSessionId = payload.accepted?.extra?.nanoSession?.id ?? sessionId;
      if (payloadSessionId !== sessionId) {
        return {
          isValid: false,
          error: 'Session ID mismatch'
        };
      }

      // Session Registry Check: Ensure the session was issued and active
      const issuedRequirements = this.sessionRegistry.get(sessionId);
      if (!issuedRequirements) {
        return {
          isValid: false,
          error: 'Session not found or expired'
        };
      }

      // Requirements consistency check: do not trust mutated requirements
      if (
        requirements.amount !== issuedRequirements.amount ||
        requirements.payTo !== issuedRequirements.payTo ||
        requirements.extra.nanoSession?.tag !== issuedRequirements.extra.nanoSession?.tag ||
        requirements.extra.nanoSession?.resourceAmountRaw !== issuedRequirements.extra.nanoSession?.resourceAmountRaw ||
        requirements.extra.nanoSession?.tagAmountRaw !== issuedRequirements.extra.nanoSession?.tagAmountRaw
      ) {
        return {
          isValid: false,
          error: 'Requirements mismatch for issued session'
        };
      }

      const blockHash = payload.payload.proof;
      // Get block information from Nano RPC
      let blockInfo = await this.rpcClient.getBlockInfo(blockHash);

      // Simple retry logic for confirmation propagation delay
      // WebSocket often sees block faster than RPC node marks it as confirmed
      if (!blockInfo.confirmed) {
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          blockInfo = await this.rpcClient.getBlockInfo(blockHash);
          if (blockInfo.confirmed) break;
        }
      }

      // Verify block is confirmed
      if (!blockInfo.confirmed) {
        return {
          isValid: false,
          error: 'Block not confirmed'
        };
      }

      // Verify destination address matches
      // Support both `link_as_account` and `link` fields for compatibility with mocks
      const destination = blockInfo.link_as_account ?? blockInfo.link;
      if (destination !== issuedRequirements.payTo) {
        return {
          isValid: false,
          error: `Address mismatch: expected ${issuedRequirements.payTo}, got ${destination}`
        };
      }

      // Amount check: expected amount is explicitly provided as requirements.amount
      const actualAmount = BigInt(blockInfo.amount);
      const expectedAmount = BigInt(issuedRequirements.amount);

      if (actualAmount !== expectedAmount) {
        return {
          isValid: false,
          error: `Amount mismatch: expected ${expectedAmount}, got ${actualAmount}`
        };
      }

      return {
        isValid: true,
        blockHash: payload.payload.proof
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isValid: false,
        error: message
      };
    }
  }

  /**
   * Verifies and finalizes a payment (settlement).
   * Unlike verify, this marks the proof as spent to prevent double-spending.
   * 
   * @param requirements The requirements the payment must satisfy
   * @param payload The payment response containing the proof (hash)
   * @returns Settlement result with success status
   */
  async handleSettle(
    requirements: PaymentRequirements,
    payload: PaymentPayload,
    context?: unknown
  ): Promise<SettleResult | null> {
    // Verify first
    const verifyResult = await this.handleVerify(requirements, payload, context);

    if (!verifyResult) {
      return null;
    }

    if (!verifyResult.isValid) {
      return {
        success: false,
        error: verifyResult.error
      };
    }

    // Atomically check and mark as spent to prevent race conditions
    const added = await this.spentSet.addIfNotExists(payload.payload.proof);
    if (!added) {
      return {
        success: false,
        error: 'Payment already spent'
      };
    }

    // ── nanoSignature: Settle-Before-Grant ─────────────────────────
    // The receive block is broadcast AFTER the spent set check to ensure
    // replay attempts never trigger a blockchain write.
    if (requirements.extra?.nanoSignature) {
      if (!this.seed) {
        return { success: false, error: 'Facilitator not configured with seed for nanoSignature settlement' };
      }
      const myAddress = deriveAddressFromSeed(this.seed, this.accountIndex);
      if (myAddress !== requirements.payTo) {
        return { success: false, error: 'Facilitator seed does not match payTo address' };
      }

      const blockHash = payload.payload.proof;
      const blockInfo = await this.rpcClient.getBlockInfo(blockHash);

      if (this.receiveMode === 'sync') {
        const receiveHash = await this.settleReceiveBlock(blockHash, myAddress, blockInfo.amount);
        if (!receiveHash) {
          return { success: false, error: 'Failed to settle (receive) block — funds may already be pocketed' };
        }
        return { success: true, transactionHash: receiveHash };
      } else {
        this.queueReceiveBlock(blockHash, myAddress, blockInfo.amount);
      }
    }

    // ── nanoSession: release session state ─────────────────────────
    if (requirements.extra?.nanoSession?.id) {
      this.releaseSession(requirements.extra.nanoSession.id);
    }

    return {
      success: true,
      transactionHash: payload.payload.proof
    };
  }

  // ── nanoSignature verification (Track 2: stateless) ──────────────

  /**
   * Verifies a nanoSignature (stateless) payment proof.
   * Checks: signature validity, block confirmation, receivability, destination, amount.
   * Does NOT broadcast receive block — that happens in handleSettle.
   */
  private async verifyNanoSignature(
    requirements: PaymentRequirements,
    payload: PaymentPayload,
    _context?: unknown
  ): Promise<VerifyResult> {
    const blockHash = payload.payload.proof;
    const signature = payload.payload.signature;

    if (!signature) {
      return { isValid: false, error: 'Signature required for nanoSignature verification' };
    }

    // URL comes from requirements (server-specified), not from context
    // This prevents replay attacks where client URL differs from server's canonical URL
    const url = requirements.extra?.nanoSignature?.url;
    if (!url) {
      return { isValid: false, error: 'URL missing in requirements.extra.nanoSignature.url' };
    }

    // 1. Fetch and confirm the send block
    let blockInfo = await this.rpcClient.getBlockInfo(blockHash);
    if (!blockInfo.confirmed) {
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        blockInfo = await this.rpcClient.getBlockInfo(blockHash);
        if (blockInfo.confirmed) break;
      }
    }
    if (!blockInfo.confirmed) {
      return { isValid: false, error: 'Block not confirmed' };
    }

    // 2. The block must still be receivable (funds not yet pocketed)
    const isReceivable = await this.rpcClient.receivableExists(blockHash);
    if (!isReceivable) {
      return { isValid: false, error: 'Block is not receivable — funds already pocketed or unknown hash' };
    }

    // 3. Verify Ed25519 signature binding block_hash + url
    //    NOTE: nanocurrency.verifyBlock is a generic Ed25519 verify wrapper.
    //    It accepts any 32-byte hex hash, not just Nano block hashes.
    const messageHash = blake2bHex(blockHash + url, undefined, 32);
    try {
      const publicKey = derivePublicKey(blockInfo.block_account);
      if (!verifyBlock({ hash: messageHash, signature, publicKey })) {
        return { isValid: false, error: 'Cryptographic signature is invalid' };
      }
    } catch {
      return { isValid: false, error: 'Signature verification failed — malformed input' };
    }

    // 4. Destination and amount checks
    const destination = blockInfo.link_as_account ?? blockInfo.link;
    if (destination !== requirements.payTo) {
      return { isValid: false, error: `Address mismatch: expected ${requirements.payTo}, got ${destination}` };
    }
    if (BigInt(blockInfo.amount) !== BigInt(requirements.amount)) {
      return { isValid: false, error: `Amount mismatch: expected ${requirements.amount}, got ${blockInfo.amount}` };
    }

    return { isValid: true, blockHash };
  }

  // ── Receive block helpers (Settle-Before-Grant) ────────────────

  private async settleReceiveBlock(hash: string, accountAddress: string, amount: string): Promise<string | null> {
    try {
      if (!this.seed) return null;
      const accountInfo = await this.rpcClient.getAccountInfo(accountAddress);
      if (!accountInfo.frontier) return null;

      const secretKeyHex = deriveSecretKey(this.seed, this.accountIndex);
      const newBalance = (BigInt(accountInfo.balance) + BigInt(amount)).toString();
      const work = await this.generateWork(accountInfo.frontier);

      const blockData = {
        work,
        balance: newBalance,
        representative: accountInfo.representative,
        link: hash,
        previous: accountInfo.frontier,
      };

      const block = createBlock(secretKeyHex, blockData);
      const newHash = await this.rpcClient.processBlock(block.block as any);

      await this.waitForConfirmation(newHash, 30_000);
      return newHash;
    } catch (e) {
      log('Failed to create/process receive block: %O', e);
      return null;
    }
  }

  private queueReceiveBlock(hash: string, accountAddress: string, amount: string): void {
    this.settleReceiveBlock(hash, accountAddress, amount).catch(console.error);
  }

  private async generateWork(root: string): Promise<string> {
    try {
      const difficulty = await this.rpcClient.getActiveDifficulty();
      return await this.rpcClient.generateWork(root, difficulty);
    } catch {
      // Exclusively use nano-rspow-node for local server/facilitator PoW (receive blocks)
      const work = await generateWorkRsp(root, WorkType.Receive);
      if (!work) throw new Error('Local work generation (nano-rspow-node) failed');
      return work;
    }
  }

  private async waitForConfirmation(hash: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await this.rpcClient.getBlockInfo(hash).catch(() => null);
      if (info && info.confirmed) return;
      await this.rpcClient.confirmBlock(hash).catch(() => undefined);
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Confirmation timeout for block ${hash}`);
  }
}
