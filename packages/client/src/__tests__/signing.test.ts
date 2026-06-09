import { describe, test, expect } from 'vitest';
import { signMessage, verifyMessage, deriveKeyPair, createSendBlock, signBlock } from '../signing.js';

const TEST_SEED = '0'.repeat(64);

describe('signMessage', () => {
    test('generates valid deterministic Ed25519 signature', () => {
        const keyPair = deriveKeyPair(TEST_SEED, 0);
        const message = 'MOCK_BLOCK_HASHhttps://api.example.com/data';

        const secretKeyHex = Buffer.from(keyPair.secretKey).toString('hex');
        const signature = signMessage(message, secretKeyHex);

        expect(signature).toBeDefined();
        expect(signature).toMatch(/^[0-9A-Fa-f]{128}$/);

        const signature2 = signMessage(message, secretKeyHex);
        expect(signature).toBe(signature2);
    });
});

describe('verifyMessage', () => {
    test('verifies a valid NOMS signature', () => {
        const keyPair = deriveKeyPair(TEST_SEED, 0);
        const message = 'test message for verification';
        const secretKeyHex = Buffer.from(keyPair.secretKey).toString('hex');
        const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');

        const signature = signMessage(message, secretKeyHex);
        expect(verifyMessage(message, signature, publicKeyHex)).toBe(true);
    });

    test('rejects tampered message', () => {
        const keyPair = deriveKeyPair(TEST_SEED, 0);
        const secretKeyHex = Buffer.from(keyPair.secretKey).toString('hex');
        const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');

        const signature = signMessage('original message', secretKeyHex);
        expect(verifyMessage('tampered message', signature, publicKeyHex)).toBe(false);
    });

    test('rejects wrong public key', () => {
        const keyPairA = deriveKeyPair(TEST_SEED, 0);
        const keyPairB = deriveKeyPair(TEST_SEED, 1);
        const secretKeyHex = Buffer.from(keyPairA.secretKey).toString('hex');
        const publicKeyBHex = Buffer.from(keyPairB.publicKey).toString('hex');

        const signature = signMessage('test', secretKeyHex);
        expect(verifyMessage('test', signature, publicKeyBHex)).toBe(false);
    });

    test('rejects truncated signature', () => {
        const keyPair = deriveKeyPair(TEST_SEED, 0);
        const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');

        // NOMS.verifyMessage throws on malformed (short) signatures
        expect(() => verifyMessage('test', 'a'.repeat(64), publicKeyHex)).toThrow();
        // Also verify with a valid-length but wrong signature
        expect(verifyMessage('test', '0'.repeat(128), publicKeyHex)).toBe(false);
    });
});

describe('deriveKeyPair', () => {
    test('produces 32-byte secret key and 32-byte public key', () => {
        const kp = deriveKeyPair(TEST_SEED, 0);
        expect(kp.secretKey).toBeInstanceOf(Uint8Array);
        expect(kp.publicKey).toBeInstanceOf(Uint8Array);
        expect(kp.secretKey.length).toBe(32);
        expect(kp.publicKey.length).toBe(32);
    });

    test('deterministic for same seed + index', () => {
        const kp1 = deriveKeyPair(TEST_SEED, 0);
        const kp2 = deriveKeyPair(TEST_SEED, 0);
        expect(Buffer.from(kp1.secretKey).toString('hex')).toBe(Buffer.from(kp2.secretKey).toString('hex'));
        expect(Buffer.from(kp1.publicKey).toString('hex')).toBe(Buffer.from(kp2.publicKey).toString('hex'));
    });

    test('different seeds produce different keypairs', () => {
        const kp1 = deriveKeyPair(TEST_SEED, 0);
        const kp2 = deriveKeyPair('1'.repeat(64), 0);
        expect(Buffer.from(kp1.publicKey).toString('hex')).not.toBe(Buffer.from(kp2.publicKey).toString('hex'));
    });

    test('different indices produce different keypairs', () => {
        const kp0 = deriveKeyPair(TEST_SEED, 0);
        const kp1 = deriveKeyPair(TEST_SEED, 1);
        expect(Buffer.from(kp0.publicKey).toString('hex')).not.toBe(Buffer.from(kp1.publicKey).toString('hex'));
    });
});

describe('createSendBlock', () => {
    test('returns object with all required fields', () => {
        const block = createSendBlock({
            account: 'nano_1sender',
            previous: 'A'.repeat(64),
            representative: 'nano_1rep',
            balance: '9000000',
            link: 'nano_1recipient',
        });
        expect(block.account).toBe('nano_1sender');
        expect(block.previous).toBe('A'.repeat(64));
        expect(block.representative).toBe('nano_1rep');
        expect(block.balance).toBe('9000000');
        expect(block.link).toBe('nano_1recipient');
    });
});

describe('signBlock', () => {
    test('produces 128-char hex signature for valid block params', () => {
        const keyPair = deriveKeyPair(TEST_SEED, 0);
        const { derivePublicKey, deriveAddress } = require('nanocurrency');
        const pkHex = Buffer.from(keyPair.publicKey).toString('hex');
        const addr = deriveAddress(pkHex, { useNanoPrefix: true });

        const block = createSendBlock({
            account: addr,
            previous: '0'.repeat(64),
            representative: addr,
            balance: '9000000',
            link: '0'.repeat(64),
        });
        const sig = signBlock(block, keyPair.secretKey);
        expect(sig).toMatch(/^[0-9A-Fa-f]{128}$/);
    });

    test('signature changes when balance changes', () => {
        const keyPair = deriveKeyPair(TEST_SEED, 0);
        const { derivePublicKey, deriveAddress } = require('nanocurrency');
        const pkHex = Buffer.from(keyPair.publicKey).toString('hex');
        const addr = deriveAddress(pkHex, { useNanoPrefix: true });

        const base = {
            account: addr,
            previous: '0'.repeat(64),
            representative: addr,
            link: '0'.repeat(64),
        };
        const sig1 = signBlock({ ...base, balance: '9000000' }, keyPair.secretKey);
        const sig2 = signBlock({ ...base, balance: '8000000' }, keyPair.secretKey);
        expect(sig1).not.toBe(sig2);
    });
});
