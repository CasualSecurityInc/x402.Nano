/**
 * x402.Nano Core
 * 
 * Unified type system supporting nanoMacaroon mechanism and legacy session/signature tracks.
 */

// Types
export type {
  PaymentRequired,
  PaymentRequirements,
  PaymentSettlementPayload,
  PaymentAccessPayload,
  PaymentPayload,
  PaymentResponse,
  ResourceInfo,
  Challenge,
  SettlementProof,
  SettlementResult,
  AccessProof,
  MacaroonCredential,
  NanoSessionExtra,
  NanoSignatureExtra,
} from './types.js';

// Constants
export {
  VERSION,
  X402_VERSION,
  SCHEME,
  NETWORK,
  ASSET,
  DEFAULT_TIMEOUT_SECONDS,
  HEADERS,
} from './constants.js';

// Builders (nanoMacaroon mechanism)
export {
  buildPaymentRequired,
  buildPaymentSettlementPayload,
  buildPaymentAccessPayload,
  buildPaymentResponse,
  parsePaymentRequired,
  parsePaymentPayload,
  encodePaymentRequired,
  decodePaymentRequired,
  encodePaymentPayload,
  decodePaymentPayload,
  encodePaymentResponse,
  decodePaymentResponse,
} from './builders.js';

// Utilities
export {
  assertValidRawAmount,
  assertValidPaymentRequirements,
  calculateTaggedAmount,
  deriveAddressFromSeed,
} from './utils.js';

// Backward-compatible wrappers (legacy API)
export {
  createPaymentRequirements,
  createSignatureRequirements,
  createPaymentPayload,
  assertValidPaymentPayload,
  createPaymentRequired,
} from './compat.js';
export type {
  CreatePaymentRequirementsOpts,
  CreateSignatureRequirementsOpts,
  CreatePaymentPayloadOpts,
  CreatePaymentRequiredOpts,
} from './compat.js';

// Mapping aliases (backward-compatible header names)
export {
  encodePaymentSignature,
  decodePaymentSignature,
} from './mapping.js';
