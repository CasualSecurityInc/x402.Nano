/**
 * x402.Nano Constants
 */

import type { Network } from './types.js';

/** Protocol version */
export const VERSION = '8.0.0';

/** x402 version */
export const X402_VERSION = 2;

/** Scheme identifier */
export const SCHEME = 'exact' as const;

/** Network identifier */
export const NETWORK: Network = 'nano:mainnet';

/** Asset identifier */
export const ASSET = 'XNO';

/** Default timeout in seconds (5 minutes) */
export const DEFAULT_TIMEOUT_SECONDS = 300;

/** HTTP headers */
export const HEADERS = {
  PAYMENT_REQUIRED: 'PAYMENT-REQUIRED',
  PAYMENT_SIGNATURE: 'PAYMENT-SIGNATURE',
  PAYMENT_RESPONSE: 'PAYMENT-RESPONSE',
} as const;
