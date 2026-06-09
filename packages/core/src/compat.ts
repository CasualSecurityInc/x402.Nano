/**
 * Backward-compatible wrappers for the pre-nanoMacaroon API.
 *
 * These accept the old flat-parameter shapes used by facilitator, client,
 * faremeter-plugin, x402-adapter, and all existing tests, and produce
 * the current PaymentRequirements / PaymentPayload types.
 */

import type {
  PaymentRequirements,
  PaymentPayload,
  PaymentRequired,
  NanoSessionExtra,
  NanoSignatureExtra,
} from './types.js';
import { X402_VERSION, SCHEME, NETWORK, ASSET } from './constants.js';
import { assertValidRawAmount } from './utils.js';

export interface CreatePaymentRequirementsOpts {
  payTo: string;
  maxTimeoutSeconds: number;
  id: string;
  tag?: number;
  resourceAmountRaw: string;
  tagAmountRaw: string;
  amount?: string;
  expiresAt?: string;
  scheme?: string;
  network?: string;
  asset?: string;
}

/**
 * Creates PaymentRequirements with nanoSession extra (Track A).
 * Preserves the old flat-parameter API used by all consumers.
 */
export function createPaymentRequirements(opts: CreatePaymentRequirementsOpts): PaymentRequirements {
  const amount = opts.amount ??
    (BigInt(opts.resourceAmountRaw) + BigInt(opts.tagAmountRaw)).toString();

  if (opts.amount !== undefined) {
    const expected = (BigInt(opts.resourceAmountRaw) + BigInt(opts.tagAmountRaw)).toString();
    if (opts.amount !== expected) {
      throw new Error(
        `Amount invariant violation: amount=${opts.amount}, expected=${expected}`
      );
    }
  }

  assertValidRawAmount(opts.resourceAmountRaw, 'resourceAmountRaw');
  assertValidRawAmount(opts.tagAmountRaw, 'tagAmountRaw');

  const nanoSession: NanoSessionExtra = {
    id: opts.id,
    tag: opts.tag ?? parseInt(opts.tagAmountRaw, 10),
    resourceAmountRaw: opts.resourceAmountRaw,
    tagAmountRaw: opts.tagAmountRaw,
    expiresAt: opts.expiresAt,
  };

  return {
    scheme: (opts.scheme as PaymentRequirements['scheme']) ?? SCHEME,
    network: (opts.network as PaymentRequirements['network']) ?? NETWORK,
    asset: opts.asset ?? ASSET,
    amount,
    payTo: opts.payTo,
    maxTimeoutSeconds: opts.maxTimeoutSeconds,
    extra: {
      nanoSession,
    },
  };
}

export interface CreateSignatureRequirementsOpts {
  payTo: string;
  maxTimeoutSeconds: number;
  amount: string;
  url: string;
  messageToSign?: string;
  scheme?: string;
  network?: string;
  asset?: string;
}

/**
 * Creates PaymentRequirements with nanoSignature extra (Track B).
 * No nanoMacaroon equivalent — pure standalone compat function.
 */
export function createSignatureRequirements(opts: CreateSignatureRequirementsOpts): PaymentRequirements {
  assertValidRawAmount(opts.amount, 'amount');

  const nanoSignature: NanoSignatureExtra = {
    url: opts.url,
    messageToSign: opts.messageToSign ?? 'block_hash+url',
  };

  return {
    scheme: (opts.scheme as PaymentRequirements['scheme']) ?? SCHEME,
    network: (opts.network as PaymentRequirements['network']) ?? NETWORK,
    asset: opts.asset ?? ASSET,
    amount: opts.amount,
    payTo: opts.payTo,
    maxTimeoutSeconds: opts.maxTimeoutSeconds,
    extra: {
      nanoSignature,
    },
  };
}

export interface CreatePaymentPayloadOpts {
  accepted: PaymentRequirements;
  proof: string;
  signature?: string;
}

/**
 * Creates a PaymentPayload with the legacy proof/signature shape.
 * This is the shape all handler code actually expects.
 */
export function createPaymentPayload(opts: CreatePaymentPayloadOpts): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    accepted: opts.accepted,
    payload: {
      proof: opts.proof,
      signature: opts.signature,
    },
  };
}

/**
 * Validates that a PaymentPayload has a non-empty proof.
 */
export function assertValidPaymentPayload(payload: PaymentPayload): void {
  if (!payload.payload?.proof) {
    throw new Error('Invalid payment payload: missing payload.proof');
  }
}

export interface CreatePaymentRequiredOpts {
  resource: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirements[];
}

/**
 * Creates a PaymentRequired response (old API).
 * Wraps requirements in the x402 V2 envelope.
 */
export function createPaymentRequired(opts: CreatePaymentRequiredOpts): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    resource: {
      url: opts.resource.url,
      description: opts.resource.description,
      mimeType: opts.resource.mimeType,
    },
    accepts: opts.accepts,
  };
}
