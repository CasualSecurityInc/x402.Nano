import { describe, test, expect } from 'vitest';
import {
  encodePaymentRequired,
  decodePaymentRequired,
  encodePaymentSignature,
  decodePaymentSignature
} from '../mapping.js';
import type { PaymentRequired, PaymentPayload } from '../types.js';

describe('PaymentRequired encoding/decoding', () => {
  const mockRequired: PaymentRequired = {
    x402Version: 2,
    resource: { url: 'https://example.com/api' },
    accepts: [
      {
        scheme: 'exact',
        network: 'nano:mainnet',
        asset: 'XNO',
        amount: '1001234',
        payTo: 'nano_abc',
        maxTimeoutSeconds: 180,
        extra: {
          nanoSession: {
            tag: 1234,
            id: 'uuid-1234',
            resourceAmountRaw: '1000000',
            tagAmountRaw: '1234'
          }
        }
      }
    ]
  };

  test('encodes and decodes PaymentRequired symmetrically', () => {
    const encoded = encodePaymentRequired(mockRequired);
    expect(typeof encoded).toBe('string');
    // Ensure it's valid base64
    expect(Buffer.from(encoded, 'base64').toString('base64')).toBe(encoded);

    const decoded = decodePaymentRequired(encoded);
    expect(decoded).toEqual(mockRequired);
  });

  test('decode returns null if x402Version is not 2', () => {
    const invalidObj = { ...mockRequired, x402Version: 1 };
    const encoded = Buffer.from(JSON.stringify(invalidObj)).toString('base64');
    expect(decodePaymentRequired(encoded)).toBeNull();
  });
});

describe('PaymentPayload encoding/decoding', () => {
  const mockPayload: PaymentPayload = {
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: 'nano:mainnet',
      asset: 'XNO',
      amount: '1001234',
      payTo: 'nano_abc',
      maxTimeoutSeconds: 180,
      extra: {
        nanoSession: {
          tag: 1234,
          id: 'uuid-1234',
          resourceAmountRaw: '1000000',
          tagAmountRaw: '1234'
        }
      }
    },
    payload: {
      proof: 'ABCDEFGHIJ1234567890'
    }
  };

  test('encodes and decodes PaymentPayload symmetrically', () => {
    const encoded = encodePaymentSignature(mockPayload);
    expect(typeof encoded).toBe('string');

    const decoded = decodePaymentSignature(encoded);
    expect(decoded).toEqual(mockPayload);
  });
});
