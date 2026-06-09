/**
 * x402.Nano Types
 * 
 * Unified type system supporting both nanoMacaroon mechanism and legacy session/signature tracks.
 */

// ── Network identifier ───────────────────────────────────────────────
/** Network identifier in CAIP-2 format, e.g. "nano:mainnet" */
export type Network = `${string}:${string}`;

// ── Macaroon credential (opaque base64-url string) ───────────────────
export type MacaroonCredential = string;

// ── nanoMacaroon types (vendored, no external dependency) ────────────

/**
 * A challenge issued by a facilitator to a client
 */
export interface Challenge {
  version: string;
  mechanism: string;
  mode: 'settle';
  id: string;
  scheme: 'exact';
  network: Network;
  asset: string;
  amount: string;
  destination: string;
  settlementPolicy: string;
  expiresInSeconds: number;
  createdAt: string;
  issuedAt: string;
  expiresAt: string;
  resource?: ResourceInfo;
  caveats?: { cid: string; value: string }[];
  serverProof?: string;
}

/**
 * Proof of settlement submitted by client
 */
export interface SettlementProof {
  version: string;
  mechanism: string;
  mode: 'settle';
  challenge?: string;
  sendHash: string;
  payerAccount: string;
  challengeId: string;
  sendBlock?: Record<string, unknown>;
  proofOptions?: { blockIncluded?: boolean };
}

/**
 * Settlement details extracted from verification
 */
export interface SettlementDetails {
  challengeId: string;
  sendHash: string;
  payerAccount: string;
  destination: string;
  network: Network;
  amount: string;
  settledAt: string;
}

/**
 * Result returned by the server after accepting settlement
 */
export interface SettlementResult {
  version: string;
  mechanism: string;
  mode: 'access';
  challengeId: string;
  acceptedPayment: SettlementDetails;
  credential: { format: 'macaroon'; value: MacaroonCredential; expiresAt?: string };
}

/**
 * Access proof submitted on later requests
 */
export interface AccessProof {
  version: string;
  mechanism: string;
  mode: 'access';
  credential: MacaroonCredential;
}

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
