/**
 * x402.Nano Adapter
 * 
 * x402 binding using nanoMacaroon mechanism.
 * Simplified single-track implementation.
 */

import type { PaymentRequired, PaymentPayload, PaymentRequirements } from '@nanosession/core';
import { buildPaymentRequired, encodePaymentRequired, decodePaymentPayload } from '@nanosession/core';

export type { PaymentRequired, PaymentPayload, PaymentRequirements };

/**
 * Minimal interface for a nanoMacaroon-compatible facilitator
 */
interface NanoMacaroonFacilitator {
  createChallenge(
    destination: string,
    amount: string,
    options: { resourceUrl: string; resourceDescription?: string }
  ): Promise<{
    version: string;
    mechanism: string;
    mode: 'settle';
    id: string;
    scheme: 'exact';
    network: `${string}:${string}`;
    asset: string;
    amount: string;
    destination: string;
    settlementPolicy: string;
    expiresInSeconds: number;
    createdAt: string;
    issuedAt: string;
    expiresAt: string;
    resource: { url: string; description?: string; mimeType?: string };
  }>;
  verifyCredential(credential: string, resourceUrl?: string): Promise<{ valid: boolean; error?: string }>;
  verifySettlement(proof: { blockHash: string; sourceAddress: string; challengeId: string }): Promise<{
    valid: boolean;
    error?: string;
    credential?: string;
  }>;
}

/**
 * x402 Server Adapter
 */
export class X402Adapter {
  constructor(private facilitator: NanoMacaroonFacilitator) {}

  /**
   * Create a payment required response
   */
  async createPaymentRequired(
    resourceUrl: string,
    amount: string,
    destination: string,
    options?: {
      description?: string;
      mimeType?: string;
    }
  ): Promise<{ status: 402; header: string; body: PaymentRequired }> {
    const challenge = await this.facilitator.createChallenge(
      destination,
      amount,
      {
        resourceUrl,
        resourceDescription: options?.description,
      }
    );

    const paymentRequired = buildPaymentRequired(resourceUrl, challenge, options);

    return {
      status: 402,
      header: encodePaymentRequired(paymentRequired),
      body: paymentRequired,
    };
  }

  /**
   * Verify a payment payload
   */
  async verifyPayment(payload: PaymentPayload): Promise<{
    valid: boolean;
    error?: string;
    credential?: string;
  }> {
    // Check for credential first
    if (payload.payload.credential) {
      const credential = payload.payload.credential as string;
      const result = await this.facilitator.verifyCredential(
        credential,
        payload.resource?.url
      );
      return {
        valid: result.valid,
        error: result.error,
        credential: result.valid ? credential : undefined,
      };
    }

    // Otherwise verify settlement proof
    const challengeId = payload.accepted.extra?.challengeId as string | undefined;
    if (!challengeId) {
      return { valid: false, error: 'Missing challenge ID' };
    }

    const proof = {
      blockHash: payload.payload.proof,
      sourceAddress: '', // Will be verified from block
      challengeId,
    };

    const result = await this.facilitator.verifySettlement(proof);
    return {
      valid: result.valid,
      error: result.error,
      credential: result.credential,
    };
  }
}

/**
 * Parse payment signature header
 */
export function parsePaymentSignature(header: string): PaymentPayload | null {
  return decodePaymentPayload(header);
}

/**
 * Encode payment required for header
 */
export function encodePaymentRequiredHeader(paymentRequired: PaymentRequired): string {
  return encodePaymentRequired(paymentRequired);
}

export { encodePaymentRequired, decodePaymentPayload };
