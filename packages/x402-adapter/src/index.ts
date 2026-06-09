/**
 * x402.Nano Adapter
 * 
 * x402 binding using nanoMacaroon mechanism.
 * Simplified single-track implementation.
 */

import type { NanoMacaroonFacilitator } from '@nanomacaroon/facilitator';
import type { PaymentRequired, PaymentPayload, PaymentRequirements } from '@nanosession/core';
import { buildPaymentRequired, encodePaymentRequired, decodePaymentPayload } from '@nanosession/core';

export type { PaymentRequired, PaymentPayload, PaymentRequirements };

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
      const result = await this.facilitator.verifyCredential(
        payload.payload.credential,
        payload.resource?.url
      );
      return {
        valid: result.valid,
        error: result.error,
        credential: result.valid ? payload.payload.credential : undefined,
      };
    }

    // Otherwise verify settlement proof
    const challengeId = payload.accepted.extra?.challengeId;
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
