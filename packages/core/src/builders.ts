/**
 * x402.Nano Builders
 * 
 * Build and parse x402 V2 payloads using nanoMacaroon mechanism.
 */

import type {
  Challenge,
  SettlementProof,
  SettlementResult,
  AccessProof,
} from './types.js';
import type {
  PaymentRequired,
  PaymentRequirements,
  PaymentPayload,
  PaymentSettlementPayload,
  PaymentAccessPayload,
  PaymentResponse,
} from './types.js';
import { X402_VERSION, SCHEME, NETWORK, ASSET, DEFAULT_TIMEOUT_SECONDS } from './constants.js';

/**
 * Build PaymentRequired response from a nanoMacaroon challenge
 */
export function buildPaymentRequired(
  resourceUrl: string,
  challenge: Challenge,
  options: {
    description?: string;
    mimeType?: string;
  } = {}
): PaymentRequired {
  const requirements: PaymentRequirements = {
    scheme: SCHEME,
    network: NETWORK,
    asset: ASSET,
    amount: challenge.amount,
    payTo: challenge.destination,
      maxTimeoutSeconds: challenge.expiresInSeconds,
      extra: {
        challenge,
      },
    };
  
  return {
    x402Version: X402_VERSION,
    resource: {
      url: resourceUrl,
      description: options.description,
      mimeType: options.mimeType,
    },
    accepts: [requirements],
  };
}

/**
 * Build PaymentPayload from settlement
 */
export function buildPaymentSettlementPayload(
  requirements: PaymentRequirements,
  proof: SettlementProof
): PaymentSettlementPayload {
  return {
    x402Version: X402_VERSION,
    accepted: requirements,
    payload: proof,
  };
}

/**
 * Build access payload from a previously issued credential
 */
export function buildPaymentAccessPayload(
  accessProof: AccessProof,
): PaymentAccessPayload {
  return {
    x402Version: X402_VERSION,
    payload: accessProof,
  };
}

/**
 * Build payment response from a settlement result
 */
export function buildPaymentResponse(result: SettlementResult, success = true): PaymentResponse {
  return {
    x402Version: X402_VERSION,
    result,
    success,
  };
}

/**
 * Parse PaymentRequired from JSON/base64
 */
export function parsePaymentRequired(data: string | object): PaymentRequired | null {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    
    if (parsed.x402Version !== X402_VERSION) {
      return null;
    }
    
    if (!parsed.resource?.url || !Array.isArray(parsed.accepts)) {
      return null;
    }
    
    return parsed as PaymentRequired;
  } catch {
    return null;
  }
}

/**
 * Parse PaymentPayload from JSON/base64
 */
export function parsePaymentPayload(data: string | object): PaymentPayload | null {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    
    if (parsed.x402Version !== X402_VERSION) {
      return null;
    }
    
    if (!parsed.payload?.mode && !parsed.payload?.proof) {
      return null;
    }
    
    return parsed as PaymentPayload;
  } catch {
    return null;
  }
}

/**
 * Encode PaymentRequired to Base64 for header
 */
export function encodePaymentRequired(paymentRequired: PaymentRequired): string {
  return Buffer.from(JSON.stringify(paymentRequired)).toString('base64url');
}

/**
 * Decode PaymentRequired from Base64 header
 */
export function decodePaymentRequired(encoded: string): PaymentRequired | null {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf-8');
    return parsePaymentRequired(json);
  } catch {
    return null;
  }
}

/**
 * Encode PaymentPayload to Base64 for header
 */
export function encodePaymentPayload(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode PaymentPayload from Base64 header
 */
export function decodePaymentPayload(encoded: string): PaymentPayload | null {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf-8');
    return parsePaymentPayload(json);
  } catch {
    return null;
  }
}

/**
 * Encode PaymentResponse to Base64 for header
 */
export function encodePaymentResponse(payload: PaymentResponse): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode PaymentResponse from Base64 header
 */
export function decodePaymentResponse(encoded: string): PaymentResponse | null {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as PaymentResponse;
    if (parsed.x402Version !== X402_VERSION || !parsed.result?.mode) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
