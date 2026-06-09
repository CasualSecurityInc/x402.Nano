import { describe, test, expect } from 'vitest';
import {
  buildPaymentAccessPayload,
  buildPaymentResponse,
  encodePaymentResponse,
  decodePaymentResponse,
  parsePaymentRequired,
  parsePaymentPayload,
} from '../builders.js';
import { X402_VERSION } from '../constants.js';

describe('buildPaymentAccessPayload', () => {
  test('wraps access proof with x402Version', () => {
    const accessProof = {
      version: 'nm1' as const,
      mechanism: 'nanoMacaroon' as const,
      mode: 'access' as const,
      credential: 'base64-credential-string',
    };
    const result = buildPaymentAccessPayload(accessProof);
    expect(result.x402Version).toBe(X402_VERSION);
    expect(result.payload).toBe(accessProof);
  });
});

describe('buildPaymentResponse', () => {
  test('wraps settlement result with success flag', () => {
    const result = {
      version: 'nm1' as const,
      mechanism: 'nanoMacaroon' as const,
      mode: 'access' as const,
      challengeId: 'test-challenge',
      acceptedPayment: {
        challengeId: 'test-challenge',
        sendHash: 'A'.repeat(64),
        payerAccount: 'nano_payer',
        destination: 'nano_dest',
        network: 'nano:mainnet' as const,
        amount: '1000000',
        settledAt: new Date().toISOString(),
      },
      credential: { format: 'macaroon' as const, value: 'cred-value' },
    };

    const response = buildPaymentResponse(result, true);
    expect(response.x402Version).toBe(X402_VERSION);
    expect(response.result).toBe(result);
    expect(response.success).toBe(true);
  });

  test('sets success=false for failed settlement', () => {
    const result = {
      version: 'nm1' as const,
      mechanism: 'nanoMacaroon' as const,
      mode: 'access' as const,
      challengeId: 'test',
      acceptedPayment: {
        challengeId: 'test',
        sendHash: 'B'.repeat(64),
        payerAccount: 'nano_payer',
        destination: 'nano_dest',
        network: 'nano:mainnet' as const,
        amount: '1000',
        settledAt: new Date().toISOString(),
      },
      credential: { format: 'macaroon' as const, value: 'cred' },
    };
    const response = buildPaymentResponse(result, false);
    expect(response.success).toBe(false);
  });
});

describe('encodePaymentResponse / decodePaymentResponse', () => {
  test('round-trips symmetrically', () => {
    const response = {
      x402Version: X402_VERSION as 2,
      result: {
        version: 'nm1' as const,
        mechanism: 'nanoMacaroon' as const,
        mode: 'access' as const,
        challengeId: 'test',
        acceptedPayment: {
          challengeId: 'test',
          sendHash: 'C'.repeat(64),
          payerAccount: 'nano_payer',
          destination: 'nano_dest',
          network: 'nano:mainnet' as const,
          amount: '1000',
          settledAt: new Date().toISOString(),
        },
        credential: { format: 'macaroon' as const, value: 'cred' },
      },
      success: true,
    };

    const encoded = encodePaymentResponse(response);
    expect(typeof encoded).toBe('string');

    const decoded = decodePaymentResponse(encoded);
    expect(decoded).toEqual(response);
  });

  test('returns null for missing x402Version', () => {
    const invalid = { result: { mode: 'access' } };
    const encoded = Buffer.from(JSON.stringify(invalid)).toString('base64url');
    expect(decodePaymentResponse(encoded)).toBeNull();
  });

  test('returns null for missing result.mode', () => {
    const invalid = { x402Version: 2, result: {} };
    const encoded = Buffer.from(JSON.stringify(invalid)).toString('base64url');
    expect(decodePaymentResponse(encoded)).toBeNull();
  });
});

describe('parsePaymentRequired', () => {
  test('rejects missing resource.url', () => {
    const invalid = { x402Version: 2, resource: {}, accepts: [] };
    expect(parsePaymentRequired(invalid)).toBeNull();
  });

  test('rejects non-array accepts', () => {
    const invalid = { x402Version: 2, resource: { url: '/api' }, accepts: 'not-array' };
    expect(parsePaymentRequired(invalid)).toBeNull();
  });
});

describe('parsePaymentPayload', () => {
  test('rejects missing payload.mode AND payload.proof', () => {
    const invalid = { x402Version: 2, payload: {} };
    expect(parsePaymentPayload(invalid)).toBeNull();
  });

  test('accepts payload with proof field (legacy shape)', () => {
    const valid = { x402Version: 2, payload: { proof: 'ABC123' } };
    expect(parsePaymentPayload(valid)).not.toBeNull();
  });
});
