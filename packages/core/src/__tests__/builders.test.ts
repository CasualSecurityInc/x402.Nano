import { describe, test, expect } from 'vitest';
import {
  createPaymentRequirements,
  createPaymentPayload,
  createPaymentRequired,
  assertValidPaymentPayload
} from '../compat.js';
import type { PaymentRequirements } from '../types.js';

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: 'nano:mainnet',
  asset: 'XNO',
  amount: '1001234',
  payTo: 'nano_abc',
  maxTimeoutSeconds: 180,
  extra: {
    nanoSession: {
      tag: 1234,
      id: 'session-1',
      resourceAmountRaw: '1000000',
      tagAmountRaw: '1234'
    }
  }
};

describe('builders', () => {
  test('createPaymentRequirements computes and validates amount invariant', () => {
    const built = createPaymentRequirements({
      payTo: 'nano_abc',
      maxTimeoutSeconds: 180,
      id: 'session-1',
      tag: 1234,
      resourceAmountRaw: '1000000',
      tagAmountRaw: '1234',
      expiresAt: '2026-01-01T00:00:00.000Z'
    });
    expect(built.amount).toBe('1001234');
  });

  test('createPaymentRequirements rejects inconsistent amount', () => {
    expect(() =>
      createPaymentRequirements({
        payTo: 'nano_abc',
        maxTimeoutSeconds: 180,
        id: 'session-1',
        tag: 1234,
        resourceAmountRaw: '1000000',
        tagAmountRaw: '1234',
        amount: '1001235',
        expiresAt: '2026-01-01T00:00:00.000Z'
      })
    ).toThrow(/Amount invariant/);
  });

  test('createPaymentRequired builds canonical payload', () => {
    const payload = createPaymentRequired({
      resource: { url: 'https://example.com' },
      accepts: [requirements]
    });
    expect(payload.x402Version).toBe(2);
    expect(payload.accepts[0]).toEqual(requirements);
  });

  test('createPaymentPayload builds canonical payload and validates', () => {
    const payload = createPaymentPayload({
      accepted: requirements,
      proof: 'ABC123'
    });
    expect(payload.x402Version).toBe(2);
    expect(payload.payload.proof).toBe('ABC123');
    expect(() => assertValidPaymentPayload(payload)).not.toThrow();
  });

  test('assertValidPaymentPayload rejects missing proof', () => {
    const payload = {
      x402Version: 2 as const,
      accepted: requirements,
      payload: { proof: '' }
    };
    expect(() => assertValidPaymentPayload(payload)).toThrow(/missing payload\.proof/);
  });
});
