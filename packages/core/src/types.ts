/**
 * x402.Nano Types
 * 
 * Unified type system supporting both nanoMacaroon mechanism and legacy session/signature tracks.
 */

import type {
  Network,
  Challenge,
  SettlementProof,
  SettlementResult,
  AccessProof,
  MacaroonCredential,
} from '@nanomacaroon/core';

/**
 * Re-export core types for x402 compatibility
 */
export type { Network, Challenge, SettlementProof, SettlementResult, AccessProof, MacaroonCredential };

/**
 * Track A (nanoSession) extra data embedded in PaymentRequirements
 */
export interface NanoSessionExtra {
  id: string;
  tag: number;
  resourceAmountRaw: string;
  tagAmountRaw: string;
  expiresAt?: string;
}

/**
 * Track B (nanoSignature) extra data embedded in PaymentRequirements
 */
export interface NanoSignatureExtra {
  url: string;
  messageToSign?: string;
}

/**
 * x402 V2 Payment Required response
 */
export interface PaymentRequired {
  /** Protocol version */
  x402Version: 2;
  
  /** Resource information */
  resource: ResourceInfo;
  
  /** Accepted payment options */
  accepts: PaymentRequirements[];
  
  /** Optional extensions */
  extensions?: Record<string, unknown>;
}

/**
 * Resource information
 */
export interface ResourceInfo {
  /** URL of the protected resource */
  url: string;
  
  /** Human-readable description */
  description?: string;
  
  /** Content type */
  mimeType?: string;
}

/**
 * Payment requirements for x402 V2
 */
export interface PaymentRequirements {
  /** Scheme identifier - always "exact" */
  scheme: 'exact';
  
  /** Network identifier (e.g., "nano:mainnet") */
  network: `${string}:${string}`;
  
  /** Asset identifier (e.g., "XNO") */
  asset: string;
  
  /** Amount in raw */
  amount: string;
  
  /** Destination address */
  payTo: string;
  
  /** Maximum timeout in seconds */
  maxTimeoutSeconds: number;
  
  /** Mechanism-specific data (nanoMacaroon, nanoSession, nanoSignature) */
  extra: {
    /** Full nanoMacaroon challenge envelope */
    challenge?: Challenge;
    /** Track A: stateful session binding */
    nanoSession?: NanoSessionExtra;
    /** Track B: stateless signature binding */
    nanoSignature?: NanoSignatureExtra;
    [key: string]: unknown;
  };
}

/**
 * x402 V2 payment submission using settlement proof
 */
export interface PaymentSettlementPayload {
  /** Protocol version */
  x402Version: 2;
  
  /** Resource being accessed */
  resource?: ResourceInfo;
  
  /** Accepted requirements */
  accepted: PaymentRequirements;

  /** Settlement proof */
  payload: SettlementProof;
  
  /** Optional extensions */
  extensions?: Record<string, unknown>;
}

/**
 * x402 V2 access request using a previously issued credential
 */
export interface PaymentAccessPayload {
  /** Protocol version */
  x402Version: 2;

  /** Resource being accessed */
  resource?: ResourceInfo;

  /** Access proof */
  payload: AccessProof;

  /** Optional extensions */
  extensions?: Record<string, unknown>;
}

/**
 * x402 V2 payment payload — the shape used by facilitator handlers.
 * Supports both legacy proof/signature and nanoMacaroon settlement shapes.
 */
export interface PaymentPayload {
  /** Protocol version */
  x402Version: 2;

  /** Accepted requirements */
  accepted: PaymentRequirements;

  /** Payment proof data */
  payload: {
    /** Block hash or settlement proof identifier */
    proof: string;
    /** Optional NOMS signature for Track B */
    signature?: string;
    [key: string]: unknown;
  };

  /** Resource being accessed */
  resource?: ResourceInfo;

  /** Optional extensions */
  extensions?: Record<string, unknown>;
}

/**
 * x402 V2 payment response
 */
export interface PaymentResponse {
  /** Protocol version */
  x402Version: 2;

  /** Settlement result */
  result: SettlementResult;

  /** Optional status indicator for UI clients */
  success?: boolean;

  /** Optional error */
  error?: string;
}

/**
 * HTTP header names for x402
 */
export const HEADERS = {
  PAYMENT_REQUIRED: 'PAYMENT-REQUIRED',
  PAYMENT_SIGNATURE: 'PAYMENT-SIGNATURE',
  PAYMENT_RESPONSE: 'PAYMENT-RESPONSE',
} as const;

/**
 * Scheme identifier for x402.Nano
 */
export const SCHEME = 'exact' as const;

/**
 * Network identifier
 */
export const NETWORK = 'nano:mainnet' as const;

/**
 * Asset identifier
 */
export const ASSET = 'XNO' as const;
