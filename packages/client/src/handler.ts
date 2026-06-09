import type { PaymentRequirements, PaymentPayload } from '@nanosession/core';
import type { NanoRpcClient } from '@nanosession/rpc';
import {
  SCHEME,
  NETWORK,
  assertValidPaymentRequirements,
  deriveAddressFromSeed,
  createPaymentPayload,
} from '@nanosession/core';
import {
  deriveSecretKey,
  createBlock,
  convert,
  Unit,
  type BlockData,
} from 'nanocurrency';
import { generateWork as generateWorkRsp, validateWork as validateWorkRsp, WorkType } from 'nano-rspow-node';
import debug from 'debug';
import { signMessage } from './signing.js';

const log = debug('nanosession:client:payment');

/**
 * An object that can execute a specific payment requirement
 */
export interface PaymentExecer {
  /** The requirements this execer will satisfy */
  requirements: PaymentRequirements;
  /** Executes the payment and returns the cryptographic proof */
  exec: () => Promise<{ payload: PaymentPayload }>;
}

/**
 * Configuration options for the NanoSessionPaymentHandler
 */
export interface ClientOptions {
  /** The RPC client used to interact with the Nano network */
  rpcClient: NanoRpcClient;
  /** The 64-character hex seed used to derive accounts */
  seed: string;
  /** Optional limit on how much can be spent in raw (daily process lifetime) */
  maxSpend?: string;
  /** Nano account index used for sending (default: 0) */
  accountIndex?: number;
  /** Confirmation wait timeout in ms (default: 30s) */
  confirmationTimeoutMs?: number;
}

/**
 * A client-side handler that automatically creates Nano payments for x402 "exact" requirements.
 */
export class NanoSessionPaymentHandler {
  private rpcClient: NanoRpcClient;
  private seed: string;
  private maxSpend?: string;
  private spentToday: bigint = 0n;
  private accountIndex: number;
  private confirmationTimeoutMs: number;

  /**
   * @param options Initialization options
   */
  constructor(options: ClientOptions) {
    this.rpcClient = options.rpcClient;
    this.seed = options.seed;
    this.maxSpend = options.maxSpend;
    this.accountIndex = options.accountIndex ?? 0;
    this.confirmationTimeoutMs = options.confirmationTimeoutMs ?? 30_000;
  }

  /**
   * Evaluates a list of payment requirements and returns execers for those it can satisfy.
   * Currently only supports "exact" scheme on "nano:mainnet".
   * 
   * @param _context Optional implementation context (ignored)
   * @param accepts List of payment requirements from the server
   * @returns List of execers that can satisfy one or more requirements
   * @throws {Error} if a matching requirement exceeds maxSpend
   */
  async handle(
    context: unknown,
    accepts: PaymentRequirements[]
  ): Promise<PaymentExecer[]> {
    const execers: PaymentExecer[] = [];

    for (const requirements of accepts) {
      if (requirements.scheme !== SCHEME || requirements.network !== NETWORK) {
        continue;
      }

      assertValidPaymentRequirements(requirements);
      const totalAmount = BigInt(requirements.amount);

      if (this.maxSpend && (this.spentToday + totalAmount) > BigInt(this.maxSpend)) {
        throw new Error(`Payment exceeds max spend: ${this.spentToday + totalAmount} > ${this.maxSpend}`);
      }

      execers.push({
        requirements,
        exec: async () => {
          const result = await this.executePayment(requirements, context);
          this.spentToday += totalAmount;
          return result;
        }
      });
    }

    return execers;
  }

  private async executePayment(requirements: PaymentRequirements, context?: unknown): Promise<{ payload: PaymentPayload }> {
    const accountAddress = deriveAddressFromSeed(this.seed, this.accountIndex);
    const accountInfo = await this.rpcClient.getAccountInfo(accountAddress);
    const totalAmount = BigInt(requirements.amount);
    const currentBalance = BigInt(accountInfo.balance);

    if (currentBalance < totalAmount) {
      const balanceXno = convert(currentBalance.toString(), { from: Unit.raw, to: Unit.NANO });
      const requiredXno = convert(totalAmount.toString(), { from: Unit.raw, to: Unit.NANO });
      throw new Error(`Insufficient balance on ${accountAddress}: ${balanceXno} < ${requiredXno} XNO`);
    }

    const secretKeyHex = deriveSecretKey(this.seed, this.accountIndex);
    const work = await this.generateWork(accountInfo.frontier);
    const nextBalance = (currentBalance - totalAmount).toString();

    const blockData: BlockData = {
      work,
      balance: nextBalance,
      representative: accountInfo.representative,
      previous: accountInfo.frontier,
      link: requirements.payTo,
    };

    const block = createBlock(secretKeyHex, blockData);
    const blockHash = await this.rpcClient.processBlock(block.block as unknown as Record<string, unknown>);
    await this.waitForConfirmation(blockHash, this.confirmationTimeoutMs);

    // Track 2 verification signing
    let signature: string | undefined;
    if (requirements.extra?.nanoSignature) {
      // Use the canonical URL from requirements (server-specified), not from client context
      // This prevents replay attacks where client URL differs from server's canonical URL
      const url = requirements.extra.nanoSignature.url;
      if (!url) {
        throw new Error('nanoSignature track requires a url in requirements.extra.nanoSignature.url');
      }
      const messageToSign = blockHash + url;
      signature = signMessage(messageToSign, secretKeyHex);
    }

    const payload = createPaymentPayload({
      accepted: requirements,
      proof: blockHash
    });

    if (signature) {
      payload.payload.signature = signature;
    }

    return { payload };
  }

  private async generateWork(root: string): Promise<string> {
    try {
      const difficulty = await this.rpcClient.getActiveDifficulty();
      return await this.rpcClient.generateWork(root, difficulty);
    } catch {
      // RPC work generation failed - fall back to local CPU/GPU computation via nano-rspow-node exclusively
      log('RPC work generation failed, falling back to local CPU/GPU computation via nano-rspow-node (this may take seconds)...');
      const work = await generateWorkRsp(root, WorkType.Send);
      if (!work) {
        throw new Error('Local work generation failed');
      }
      if (!validateWorkRsp(root, work, WorkType.Send)) {
        throw new Error('Local work failed threshold validation');
      }
      return work;
    }
  }

  private async waitForConfirmation(hash: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const blockInfo = await this.rpcClient.getBlockInfo(hash);
      if (blockInfo.confirmed) {
        return;
      }
      await this.rpcClient.confirmBlock(hash).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Payment block ${hash} not confirmed within ${timeoutMs}ms`);
  }
}
