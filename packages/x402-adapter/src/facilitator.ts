/**
 * NanoSession facilitator implementation for the Exact payment scheme.
 * Wraps NanoSessionFacilitatorHandler to implement SchemeNetworkFacilitator interface.
 */

import type { NanoRpcClient } from '@nanosession/rpc';
import {
  NanoSessionFacilitatorHandler,
  type SessionRegistry,
  type SpentSetStorage
} from '@nanosession/facilitator';
import { SCHEME, NETWORK } from '@nanosession/core';
import type {
  SchemeNetworkFacilitator,
  PaymentPayload,
  PaymentRequirements,
  FacilitatorContext,
  VerifyResponse,
  SettleResponse,
  Network,
  SupportedResponse
} from './types.js';
import { toNanoRequirements, toNanoPayload } from './converter.js';
import { x402ContextStorage } from './context.js';

/**
 * Configuration options for ExactNanoFacilitator
 */
export interface ExactNanoFacilitatorConfig {
/** Nano RPC client instance */
rpcClient: NanoRpcClient;
/** Optional spent set storage (defaults to in-memory) */
spentSet?: SpentSetStorage;
/** Optional session storage (defaults to in-memory Map) */
sessionRegistry?: SessionRegistry;
  /**
   * Seed for Track 2 (nanoSignature) receive block signing.
   * 64-character hexadecimal string.
   * Required for Track 2 settlement, optional for Track 1.
   */
  seed?: string;
  /**
   * Account index for Track 2 wallet derivation.
   * Used with seed to derive the receiving address.
   * Default: 0
   */
  accountIndex?: number;
  /**
   * Track 2 receive mode.
   * 'sync': Wait for receive block confirmation before returning (default)
   * 'async': Queue receive block, return immediately
   */
  receiveMode?: 'sync' | 'async';
}

/**
 * NanoSession facilitator implementation for the Exact payment scheme.
 * Thin wrapper around NanoSessionFacilitatorHandler that converts
 * between x402 types and NanoSession types.
 */
export class ExactNanoFacilitator implements SchemeNetworkFacilitator {
  readonly scheme = SCHEME;
  readonly caipFamily = 'nano:*';
  private underlying: NanoSessionFacilitatorHandler;

  /**
   * Creates a new ExactNanoFacilitator instance.
   *
   * @param config - Configuration for the facilitator
   */
  constructor(config: ExactNanoFacilitatorConfig) {
    this.underlying = new NanoSessionFacilitatorHandler({
      rpcClient: config.rpcClient,
      spentSet: config.spentSet,
      sessionRegistry: config.sessionRegistry,
seed: config.seed,
accountIndex: config.accountIndex,
receiveMode: config.receiveMode,
  });
  }

  /**
   * Returns support information for the facilitator.
   */
  async getSupported(): Promise<SupportedResponse> {
    return {
      kinds: [{
        x402Version: 2,
        scheme: this.scheme,
        network: NETWORK as Network,
        extra: this.getExtra(NETWORK as Network)
      }],
      extensions: [],
      signers: {
        [NETWORK as Network]: this.getSigners(NETWORK as Network)
      }
    };
  }

  /**
   * Returns undefined — NanoSession has no mechanism-specific extra data
   * for the supported kinds endpoint.
   *
   * @param _ - The network identifier (unused)
   * @returns undefined
   */
  getExtra(_: Network): Record<string, unknown> | undefined {
    void _;
    return undefined;
  }

  /**
   * Returns empty array — NanoSession doesn't use facilitator signers.
   * Nano is feeless, so no fee payer or signer addresses are needed.
   *
   * @param _ - The network identifier (unused)
   * @returns Empty array
   */
  getSigners(_: Network): string[] {
    void _;
    return [];
  }

  /**
   * Verifies a payment payload.
   * Converts x402 types to NanoSession types and delegates to underlying handler.
   *
   * @param payload - The payment payload to verify
   * @param requirements - The payment requirements
   * @param _context - Optional facilitator context (unused)
   * @returns Promise resolving to verification response
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    // Check scheme and network match
    if (requirements.scheme !== SCHEME || requirements.network !== NETWORK) {
      return {
        isValid: false,
        invalidReason: 'scheme_mismatch',
        invalidMessage: `Expected scheme ${SCHEME} on network ${NETWORK}, got ${requirements.scheme} on ${requirements.network}`,
      };
    }

    // Convert x402 types to NanoSession types
    const nanoReq = toNanoRequirements(requirements);
    if (!nanoReq) {
      return {
        isValid: false,
        invalidReason: 'invalid_requirements',
        invalidMessage: 'Failed to parse NanoSession requirements from payload',
      };
    }

    const nanoPayload = toNanoPayload(payload, nanoReq);
    if (!nanoPayload) {
      return {
        isValid: false,
        invalidReason: 'invalid_payload',
        invalidMessage: 'Failed to parse NanoSession payload',
      };
    }

    // Get URL from context for nanoSignature verification
    const context = x402ContextStorage.getStore();
    const verifyContext = context?.url ? { url: context.url } : undefined;

    // Delegate to underlying handler
    const result = await this.underlying.handleVerify(nanoReq, nanoPayload, verifyContext);

    if (!result) {
      return {
        isValid: false,
        invalidReason: 'verification_failed',
        invalidMessage: 'Underlying verification returned null',
      };
    }

    return {
      isValid: result.isValid,
      invalidReason: result.isValid ? undefined : 'verification_failed',
      invalidMessage: result.error,
      payer: undefined, // NanoSession doesn't expose payer in verification
    };
  }

  /**
   * Settles a payment.
   * Converts x402 types to NanoSession types and delegates to underlying handler.
   * Uses atomic check-and-set via addIfNotExists to prevent double-spending.
   *
   * @param payload - The payment payload to settle
   * @param requirements - The payment requirements
   * @param _context - Optional facilitator context (unused)
   * @returns Promise resolving to settlement response
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<SettleResponse> {
    // Check scheme and network match
    if (requirements.scheme !== SCHEME || requirements.network !== NETWORK) {
      return {
        success: false,
        errorReason: 'scheme_mismatch',
        errorMessage: `Expected scheme ${SCHEME} on network ${NETWORK}, got ${requirements.scheme} on ${requirements.network}`,
        transaction: payload.payload.proof ?? '',
        network: requirements.network,
      };
    }

    // Convert x402 types to NanoSession types
    const nanoReq = toNanoRequirements(requirements);
    if (!nanoReq) {
      return {
        success: false,
        errorReason: 'invalid_requirements',
        errorMessage: 'Failed to parse NanoSession requirements from payload',
        transaction: payload.payload.proof ?? '',
        network: requirements.network,
      };
    }

    const nanoPayload = toNanoPayload(payload, nanoReq);
    if (!nanoPayload) {
      return {
        success: false,
        errorReason: 'invalid_payload',
        errorMessage: 'Failed to parse NanoSession payload',
        transaction: payload.payload.proof ?? '',
        network: requirements.network,
      };
    }

    // Get URL from context for nanoSignature settlement
    const context = x402ContextStorage.getStore();
    const settleContext = context?.url ? { url: context.url } : undefined;

    // Delegate to underlying handler
    const result = await this.underlying.handleSettle(nanoReq, nanoPayload, settleContext);

    if (!result) {
      return {
        success: false,
        errorReason: 'settlement_failed',
        errorMessage: 'Underlying settlement returned null',
        transaction: payload.payload.proof ?? '',
        network: requirements.network,
      };
    }

    return {
      success: result.success,
      errorReason: result.success ? undefined : 'settlement_failed',
      errorMessage: result.error,
      transaction: result.transactionHash ?? payload.payload.proof ?? '',
      network: result.success ? NETWORK : requirements.network,
    };
  }

  /**
   * Get the underlying NanoSessionFacilitatorHandler.
   * Use this to access advanced features like generating requirements.
   *
   * @returns The underlying handler instance
   */
  getUnderlyingHandler(): NanoSessionFacilitatorHandler {
    return this.underlying;
  }
}
