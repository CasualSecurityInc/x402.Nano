import { describe, test, expect } from 'vitest';
import { deriveAddressFromSeed } from '../utils.js';
import { assertValidPaymentRequirements } from '../utils.js';
import { SCHEME, NETWORK, ASSET } from '../constants.js';
import type { PaymentRequirements } from '../types.js';

describe('deriveAddressFromSeed', () => {
    const TEST_SEED = '0'.repeat(64);

    test('returns nano_ prefixed address', () => {
        const addr = deriveAddressFromSeed(TEST_SEED, 0);
        expect(addr).toMatch(/^nano_/);
    });

    test('is deterministic', () => {
        const addr1 = deriveAddressFromSeed(TEST_SEED, 0);
        const addr2 = deriveAddressFromSeed(TEST_SEED, 0);
        expect(addr1).toBe(addr2);
    });

    test('different indices produce different addresses', () => {
        const addr0 = deriveAddressFromSeed(TEST_SEED, 0);
        const addr1 = deriveAddressFromSeed(TEST_SEED, 1);
        expect(addr0).not.toBe(addr1);
    });

    test('different seeds produce different addresses', () => {
        const addr0 = deriveAddressFromSeed(TEST_SEED, 0);
        const addr1 = deriveAddressFromSeed('1'.repeat(64), 0);
        expect(addr0).not.toBe(addr1);
    });
});

describe('assertValidPaymentRequirements edge cases', () => {
    const base = {
        scheme: SCHEME,
        network: NETWORK,
        asset: ASSET,
        amount: '10000',
        payTo: 'nano_123',
        maxTimeoutSeconds: 60,
    };

    test('rejects both nanoSession AND nanoSignature on same requirements', () => {
        const invalid: PaymentRequirements = {
            ...base,
            extra: {
                nanoSession: { id: 's1', tag: 0, resourceAmountRaw: '5000', tagAmountRaw: '5000' },
                nanoSignature: { url: 'https://example.com' },
            },
        };
        expect(() => assertValidPaymentRequirements(invalid)).toThrow(/mutually exclusive/);
    });

    test('rejects nanoSession without id field', () => {
        const invalid: PaymentRequirements = {
            ...base,
            extra: {
                nanoSession: { id: '', tag: 0, resourceAmountRaw: '5000', tagAmountRaw: '5000' },
            },
        };
        expect(() => assertValidPaymentRequirements(invalid)).toThrow(/Missing extra\.nanoSession\.id/);
    });

    test('rejects nanoSession with non-integer tag', () => {
        const invalid: PaymentRequirements = {
            ...base,
            extra: {
                nanoSession: { id: 's1', tag: 1.5, resourceAmountRaw: '5000', tagAmountRaw: '5000' },
            },
        };
        expect(() => assertValidPaymentRequirements(invalid)).toThrow(/non-negative integer/);
    });

    test('rejects nanoSession with negative tag', () => {
        const invalid: PaymentRequirements = {
            ...base,
            extra: {
                nanoSession: { id: 's1', tag: -1, resourceAmountRaw: '5000', tagAmountRaw: '5000' },
            },
        };
        expect(() => assertValidPaymentRequirements(invalid)).toThrow(/non-negative integer/);
    });

    test('rejects nanoSignature without url field', () => {
        const invalid: PaymentRequirements = {
            ...base,
            extra: {
                nanoSignature: { url: '' },
            },
        };
        expect(() => assertValidPaymentRequirements(invalid)).toThrow(/Missing extra\.nanoSignature\.url/);
    });

    test('accepts valid nanoSignature requirements', () => {
        const valid: PaymentRequirements = {
            ...base,
            extra: {
                nanoSignature: { url: 'https://example.com/api' },
            },
        };
        expect(() => assertValidPaymentRequirements(valid)).not.toThrow();
    });
});
