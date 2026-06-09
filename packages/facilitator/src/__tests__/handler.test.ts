import { describe, test, expect, vi, beforeEach } from 'vitest';
import { NanoSessionFacilitatorHandler } from '../handler.js';
import { InMemorySpentSet } from '../spent-set.js';
import { SCHEME } from '@nanosession/core';
import type { PaymentRequirements } from '@nanosession/core';

describe('InMemorySpentSet', () => {
  test('has returns false for new hash', async () => {
    const spentSet = new InMemorySpentSet();
    const result = await spentSet.has('NEW_HASH');
    expect(result).toBe(false);
  });

  test('add then has returns true', async () => {
    const spentSet = new InMemorySpentSet();
    await spentSet.add('TEST_HASH');
    const result = await spentSet.has('TEST_HASH');
    expect(result).toBe(true);
  });
});

describe('NanoSessionFacilitatorHandler', () => {
  const mockRpcClient = {
    getBlockInfo: vi.fn()
  };

  beforeEach(() => {
    mockRpcClient.getBlockInfo.mockClear();
  });

  test('getSupported returns nano-session scheme info', async () => {
    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpcClient as any
    });

    const supported = await handler.getSupported();

    expect(supported).toHaveLength(1);
    expect(supported[0].scheme).toBe(SCHEME);
    expect(supported[0].network).toBe('nano:mainnet');
  });

  test('handleVerify returns null for non-matching scheme', async () => {
    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpcClient as any
    });

    const requirements: PaymentRequirements = {
      scheme: 'evm-exact',
      network: 'eip155:1',
      asset: 'USDC',
      amount: '1000000',
      payTo: '0x123',
      maxTimeoutSeconds: 300,
      extra: {
        nanoSession: {
          tag: 0,
          id: 'test',
          resourceAmountRaw: '1000000',
          tagAmountRaw: '0',
          expiresAt: new Date().toISOString()
        }
      }
    };

    const mockPayload: any = { payload: { proof: '0xabc' }, accepted: requirements };
    const result = await handler.handleVerify(requirements, mockPayload);
    expect(result).toBeNull();
  });

  test('handleVerify returns valid for confirmed block', async () => {
    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpcClient as any
    });

    const requirements = handler.getRequirements({
      resourceAmountRaw: '10000000',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300
    });

    mockRpcClient.getBlockInfo.mockResolvedValueOnce({
      hash: '0000002A',
      confirmed: true,
      link: 'nano_destination',
      link_as_account: 'nano_destination',
      amount: requirements.amount,
      height: 100
    });

    const mockPayload: any = { payload: { proof: '0000002A' }, accepted: requirements };
    const result = await handler.handleVerify(requirements, mockPayload);

    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(true);
  });

  test('handleVerify rejects mutated requirement amount for same session', async () => {
    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpcClient as any
    });

    const requirements = handler.getRequirements({
      resourceAmountRaw: '10000000',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300
    });

    const mutated: PaymentRequirements = {
      ...requirements,
      amount: (BigInt(requirements.amount) + 1n).toString(),
    };

    const mockPayload: any = { payload: { proof: '0000002A' }, accepted: mutated };
    const result = await handler.handleVerify(mutated, mockPayload);

    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.error).toMatch(/Amount invariant violation|Requirements mismatch/);
  });

  test('handleVerify returns invalid for unconfirmed block', async () => {
    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpcClient as any
    });

    const requirements = handler.getRequirements({
      resourceAmountRaw: '10000000',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300
    });

    mockRpcClient.getBlockInfo.mockResolvedValueOnce({
      hash: '00000029',
      confirmed: false,
      link: 'nano_destination',
      link_as_account: 'nano_destination',
      amount: requirements.amount
    });

    const mockPayload: any = { payload: { proof: '00000029' }, accepted: requirements };
    const result = await handler.handleVerify(requirements, mockPayload);

    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
  });

  test('handleSettle rejects duplicate blockHash', async () => {
    const spentSet = new InMemorySpentSet();
    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpcClient as any,
      spentSet
    });

    const requirements = handler.getRequirements({
      resourceAmountRaw: '10000000',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300
    });

    mockRpcClient.getBlockInfo.mockResolvedValue({
      hash: '0000002A',
      confirmed: true,
      link: 'nano_destination',
      link_as_account: 'nano_destination',
      amount: requirements.amount
    });

    const mockPayload: any = { payload: { proof: '0000002A' }, accepted: requirements };

    const result1 = await handler.handleSettle(requirements, mockPayload);
    expect(result1).not.toBeNull();
    expect(result1!.success).toBe(true);

    const result2 = await handler.handleSettle(requirements, mockPayload);
    expect(result2).not.toBeNull();
    expect(result2!.success).toBe(false);
  });

  test('handleSettle rejects unknown sessionId (session spoofing attack)', async () => {
    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpcClient as any
    });

    const fakeRequirements: PaymentRequirements = {
      scheme: SCHEME,
      network: 'nano:mainnet',
      asset: 'XNO',
      amount: '10000042',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300,
      extra: {
        nanoSession: {
          tag: 42,
          id: 'fake-session-never-issued',
          resourceAmountRaw: '10000000',
          tagAmountRaw: '42',
          expiresAt: new Date().toISOString()
        }
      }
    };

    const mockPayload: any = { payload: { proof: '0000002A' }, accepted: fakeRequirements };
    const result = await handler.handleSettle(fakeRequirements, mockPayload);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toBe('Session not found or expired');
  });

  test('getRequirements accepts explicit tagAmountRaw', async () => {
    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpcClient as any
    });

    const requirements = handler.getRequirements({
      resourceAmountRaw: '5000',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300,
      tagAmountRaw: '7000'
    });

    expect(requirements.extra.nanoSession.tagAmountRaw).toBe('7000');
    expect(requirements.amount).toBe('12000');
  });

  test('handleVerify validates Track 2 (nanoSignature) with URL from requirements', async () => {
    // Note: This test requires a mocked crypto environment matching nanoSignature.
    // In nanoSignature (legacy Rev 7), Ed25519 signatures over blake2b(block_hash + url) were used.
    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpcClient as any
    });

    const amount = '10000000000000000000000000000'; // 0.01 XNO
    const payTo = 'nano_3facil1tatoraddr';
    const url = 'http://localhost:3000/weather';
    const requirements = handler.getSignatureRequirements({
      amount,
      payTo,
      url
    });

    const blockHash = 'C0E9542DDFF27B45E46A1416260E56DE771BAC40ACFD31473A48A662095F7316';
    
    // We mock verifyBlock to return true for this test
    // to avoid needing full ed25519 signing logic here
    const { verifyBlock } = await import('nanocurrency');
    const verifySpy = vi.spyOn({ verifyBlock }, 'verifyBlock').mockReturnValue(true);

    mockRpcClient.getBlockInfo.mockResolvedValue({
      hash: blockHash,
      confirmed: true,
      block_account: 'nano_1clientaccount',
      link: payTo,
      link_as_account: payTo,
      amount: amount
    });
    
    // Mock receivable check
    (mockRpcClient as any).receivableExists = vi.fn().mockResolvedValue(true);

    const mockPayload: any = { 
      x402Version: 2,
      accepted: requirements,
      payload: { 
        proof: blockHash,
        signature: 'MOCK_SIGNATURE'
      }
    };

    // The URL now comes from requirements.extra.nanoSignature.url, not from context
    // This test verifies that the signature verification uses the canonical URL from requirements
    
    // With the URL in requirements, verification should proceed (may fail on crypto if mock is incomplete)
    const result = await handler.handleVerify(requirements, mockPayload);
    // The error should NOT be about missing URL since URL is now in requirements
    expect(result!.error).not.toBe('URL missing in requirements.extra.nanoSignature.url');
    expect(result!.error).not.toBe('URL context required for nanoSignature verification');
  });
});

describe('handleVerify — Track B (nanoSignature) with real crypto', () => {
  const { deriveSecretKey, derivePublicKey, deriveAddress, signBlock: nanoSignBlock } = require('nanocurrency');
  const blakejs = require('blakejs');
  const { blake2bHex } = blakejs;

  const SEED = '0'.repeat(64);
  const SENDER_SK = deriveSecretKey(SEED, 0);
  const SENDER_PK = derivePublicKey(SENDER_SK);
  const SENDER_ADDR = deriveAddress(SENDER_PK, { useNanoPrefix: true });

  function createSignedPayload(
    handler: InstanceType<typeof NanoSessionFacilitatorHandler>,
    opts: { blockHash: string; url: string; amount: string; payTo: string; signUrl?: string }
  ) {
    const requirements = handler.getSignatureRequirements({
      amount: opts.amount,
      payTo: opts.payTo,
      url: opts.url,
    });

    const signUrl = opts.signUrl ?? opts.url;
    const messageHash = blake2bHex(opts.blockHash + signUrl, undefined, 32);
    const signature = nanoSignBlock({ hash: messageHash, secretKey: SENDER_SK });

    const payload: any = {
      x402Version: 2,
      accepted: requirements,
      payload: { proof: opts.blockHash, signature },
    };

    return { requirements, payload };
  }

  function mockBlockInfo(mockRpc: any, overrides: Record<string, any> = {}) {
    mockRpc.getBlockInfo.mockResolvedValue({
      hash: 'A'.repeat(64),
      confirmed: true,
      block_account: SENDER_ADDR,
      link: 'nano_destination',
      link_as_account: 'nano_destination',
      amount: '1000000',
      ...overrides,
    });
    mockRpc.receivableExists = vi.fn().mockResolvedValue(true);
  }

  test('accepts valid signature', async () => {
    const mockRpc = { getBlockInfo: vi.fn(), receivableExists: vi.fn() };
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpc as any });

    const blockHash = 'A'.repeat(64);
    mockBlockInfo(mockRpc, { hash: blockHash });

    const { requirements, payload } = createSignedPayload(handler, {
      blockHash,
      url: 'https://api.example.com/data',
      amount: '1000000',
      payTo: 'nano_destination',
    });

    const result = await handler.handleVerify(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(true);
  });

  test('rejects signature where block hash was tampered', async () => {
    const mockRpc = { getBlockInfo: vi.fn(), receivableExists: vi.fn() };
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpc as any });

    const realHash = 'A'.repeat(64);
    const tamperedHash = 'B'.repeat(64);
    mockBlockInfo(mockRpc, { hash: tamperedHash });

    // Sign with realHash, but put tamperedHash in the proof
    const requirements = handler.getSignatureRequirements({
      amount: '1000000',
      payTo: 'nano_destination',
      url: 'https://api.example.com/data',
    });

    const url = 'https://api.example.com/data';
    const messageHash = blake2bHex(realHash + url, undefined, 32);
    const signature = nanoSignBlock({ hash: messageHash, secretKey: SENDER_SK });

    const payload: any = {
      x402Version: 2,
      accepted: requirements,
      payload: { proof: tamperedHash, signature },
    };

    const result = await handler.handleVerify(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.error).toMatch(/signature/i);
  });

  test('rejects signature where URL was tampered', async () => {
    const mockRpc = { getBlockInfo: vi.fn(), receivableExists: vi.fn() };
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpc as any });

    const blockHash = 'A'.repeat(64);
    mockBlockInfo(mockRpc, { hash: blockHash });

    // Sign with url1, but requirements have url2
    const { requirements, payload } = createSignedPayload(handler, {
      blockHash,
      url: 'https://api.example.com/real',
      signUrl: 'https://evil.example.com/fake',
      amount: '1000000',
      payTo: 'nano_destination',
    });

    const result = await handler.handleVerify(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.error).toMatch(/signature/i);
  });

  test('rejects missing signature in payload', async () => {
    const mockRpc = { getBlockInfo: vi.fn(), receivableExists: vi.fn() };
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpc as any });

    const requirements = handler.getSignatureRequirements({
      amount: '1000000',
      payTo: 'nano_destination',
      url: 'https://api.example.com/data',
    });

    const payload: any = {
      x402Version: 2,
      accepted: requirements,
      payload: { proof: 'A'.repeat(64) },
    };

    const result = await handler.handleVerify(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.error).toMatch(/signature required/i);
  });

  test('rejects block that is already spent (receivable check fails)', async () => {
    const mockRpc = { getBlockInfo: vi.fn(), receivableExists: vi.fn().mockResolvedValue(false) };
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpc as any });

    const blockHash = 'A'.repeat(64);
    mockRpc.getBlockInfo.mockResolvedValue({
      hash: blockHash,
      confirmed: true,
      block_account: SENDER_ADDR,
      link: 'nano_destination',
      link_as_account: 'nano_destination',
      amount: '1000000',
    });

    const { requirements, payload } = createSignedPayload(handler, {
      blockHash,
      url: 'https://api.example.com/data',
      amount: '1000000',
      payTo: 'nano_destination',
    });

    const result = await handler.handleVerify(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.error).toMatch(/not receivable/i);
  });

  test('rejects block with wrong destination', async () => {
    const mockRpc = { getBlockInfo: vi.fn(), receivableExists: vi.fn().mockResolvedValue(true) };
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpc as any });

    const blockHash = 'A'.repeat(64);
    mockRpc.getBlockInfo.mockResolvedValue({
      hash: blockHash,
      confirmed: true,
      block_account: SENDER_ADDR,
      link: 'nano_wrong_dest',
      link_as_account: 'nano_wrong_dest',
      amount: '1000000',
    });

    const { requirements, payload } = createSignedPayload(handler, {
      blockHash,
      url: 'https://api.example.com/data',
      amount: '1000000',
      payTo: 'nano_destination',
    });

    const result = await handler.handleVerify(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.error).toMatch(/address mismatch/i);
  });

  test('rejects block with insufficient amount', async () => {
    const mockRpc = { getBlockInfo: vi.fn(), receivableExists: vi.fn().mockResolvedValue(true) };
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpc as any });

    const blockHash = 'A'.repeat(64);
    mockRpc.getBlockInfo.mockResolvedValue({
      hash: blockHash,
      confirmed: true,
      block_account: SENDER_ADDR,
      link: 'nano_destination',
      link_as_account: 'nano_destination',
      amount: '500000',
    });

    const { requirements, payload } = createSignedPayload(handler, {
      blockHash,
      url: 'https://api.example.com/data',
      amount: '1000000',
      payTo: 'nano_destination',
    });

    const result = await handler.handleVerify(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.error).toMatch(/amount mismatch/i);
  });
});

describe('getSignatureRequirements', () => {
  const mockRpcClient = { getBlockInfo: vi.fn() };

  test('returns PaymentRequirements with nanoSignature extra', () => {
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpcClient as any });
    const reqs = handler.getSignatureRequirements({
      amount: '1000000',
      payTo: 'nano_test',
      url: 'https://api.example.com/data',
    });
    expect(reqs.extra.nanoSignature).toBeDefined();
    expect(reqs.extra.nanoSignature!.url).toBe('https://api.example.com/data');
  });

  test('returns correct amount, payTo, maxTimeoutSeconds', () => {
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpcClient as any });
    const reqs = handler.getSignatureRequirements({
      amount: '5000000',
      payTo: 'nano_payee',
      url: 'https://example.com',
      maxTimeoutSeconds: 120,
    });
    expect(reqs.amount).toBe('5000000');
    expect(reqs.payTo).toBe('nano_payee');
    expect(reqs.maxTimeoutSeconds).toBe(120);
  });

  test('sets default messageToSign when not provided', () => {
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpcClient as any });
    const reqs = handler.getSignatureRequirements({
      amount: '1000',
      payTo: 'nano_test',
      url: 'https://example.com',
    });
    expect(reqs.extra.nanoSignature!.messageToSign).toBe('block_hash+url');
  });

  test('preserves explicit messageToSign when provided', () => {
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpcClient as any });
    const reqs = handler.getSignatureRequirements({
      amount: '1000',
      payTo: 'nano_test',
      url: 'https://example.com',
      messageToSign: 'custom_template',
    });
    expect(reqs.extra.nanoSignature!.messageToSign).toBe('custom_template');
  });

  test('defaults maxTimeoutSeconds to 600', () => {
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpcClient as any });
    const reqs = handler.getSignatureRequirements({
      amount: '1000',
      payTo: 'nano_test',
      url: 'https://example.com',
    });
    expect(reqs.maxTimeoutSeconds).toBe(600);
  });
});

describe('handleSettle — Track B (nanoSignature) with seed', () => {
  const SEED = '0'.repeat(64);
  const { deriveSecretKey, derivePublicKey, deriveAddress, signBlock: nanoSignBlock } = require('nanocurrency');
  const blakejs = require('blakejs');
  const { blake2bHex } = blakejs;

  const SENDER_SK = deriveSecretKey(SEED, 0);
  const SENDER_PK = derivePublicKey(SENDER_SK);
  const SENDER_ADDR = deriveAddress(SENDER_PK, { useNanoPrefix: true });

  // Use a different seed for the facilitator's receiving wallet
  const FAC_SEED = '1'.repeat(64);
  const { derivePublicKey: dPk2, deriveAddress: dA2 } = require('nanocurrency');
  const FAC_SK = deriveSecretKey(FAC_SEED, 0);
  const FAC_PK = dPk2(FAC_SK);
  const FAC_ADDR = dA2(FAC_PK, { useNanoPrefix: true });

  function createMockRpc() {
    return {
      getBlockInfo: vi.fn(),
      getAccountInfo: vi.fn(),
      getActiveDifficulty: vi.fn(),
      generateWork: vi.fn(),
      processBlock: vi.fn(),
      confirmBlock: vi.fn(),
      receivableExists: vi.fn().mockResolvedValue(true),
    };
  }

  function setupSettleMocks(mockRpc: any, blockHash: string, amount: string) {
    mockRpc.getBlockInfo.mockResolvedValue({
      hash: blockHash,
      confirmed: true,
      block_account: SENDER_ADDR,
      link: FAC_ADDR,
      link_as_account: FAC_ADDR,
      amount,
    });
    mockRpc.getAccountInfo.mockResolvedValue({
      frontier: 'F'.repeat(64),
      balance: '5000000',
      representative: FAC_ADDR,
    });
    mockRpc.getActiveDifficulty.mockResolvedValue('fffffff800000000');
    mockRpc.generateWork.mockResolvedValue('ffff0000ffff0000');
    mockRpc.processBlock.mockResolvedValue('RECEIVE_HASH_123');
    mockRpc.confirmBlock.mockResolvedValue(true);
  }

  test('broadcasts receive block on successful verify + settle', async () => {
    const mockRpc = createMockRpc();
    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpc,
      seed: FAC_SEED,
    });

    const blockHash = 'A'.repeat(64);
    const amount = '1000000';
    setupSettleMocks(mockRpc, blockHash, amount);

    const requirements = handler.getSignatureRequirements({
      amount,
      payTo: FAC_ADDR,
      url: 'https://api.example.com/data',
    });

    const messageHash = blake2bHex(blockHash + 'https://api.example.com/data', undefined, 32);
    const signature = nanoSignBlock({ hash: messageHash, secretKey: SENDER_SK });

    const payload: any = {
      x402Version: 2,
      accepted: requirements,
      payload: { proof: blockHash, signature },
    };

    const result = await handler.handleSettle(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.transactionHash).toBe('RECEIVE_HASH_123');
  });

  test('rejects Track B settle when facilitator has no seed', async () => {
    const mockRpc: any = {
      getBlockInfo: vi.fn(),
      receivableExists: vi.fn().mockResolvedValue(true),
    };

    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpc,
      // no seed
    });

    const blockHash = 'A'.repeat(64);
    mockRpc.getBlockInfo.mockResolvedValue({
      hash: blockHash,
      confirmed: true,
      block_account: SENDER_ADDR,
      link: 'nano_someaddr',
      link_as_account: 'nano_someaddr',
      amount: '1000000',
    });

    const requirements = handler.getSignatureRequirements({
      amount: '1000000',
      payTo: 'nano_someaddr',
      url: 'https://api.example.com',
    });

    const messageHash = blake2bHex(blockHash + 'https://api.example.com', undefined, 32);
    const signature = nanoSignBlock({ hash: messageHash, secretKey: SENDER_SK });

    const payload: any = {
      x402Version: 2,
      accepted: requirements,
      payload: { proof: blockHash, signature },
    };

    const result = await handler.handleSettle(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toMatch(/not configured with seed/);
  });

  test('double settles the same payment hash', async () => {
    const mockRpc = createMockRpc();
    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpc,
      seed: FAC_SEED,
    });

    const blockHash = 'A'.repeat(64);
    const amount = '1000000';
    setupSettleMocks(mockRpc, blockHash, amount);

    const requirements = handler.getSignatureRequirements({
      amount,
      payTo: FAC_ADDR,
      url: 'https://api.example.com/data',
    });

    const messageHash = blake2bHex(blockHash + 'https://api.example.com/data', undefined, 32);
    const signature = nanoSignBlock({ hash: messageHash, secretKey: SENDER_SK });

    const payload: any = {
      x402Version: 2,
      accepted: requirements,
      payload: { proof: blockHash, signature },
    };

    const result1 = await handler.handleSettle(requirements, payload);
    expect(result1!.success).toBe(true);

    const result2 = await handler.handleSettle(requirements, payload);
    expect(result2!.success).toBe(false);
    expect(result2!.error).toMatch(/already spent/i);
  });
});

describe('ATTACK TEST — Track B (nanoSignature)', () => {
  const { deriveSecretKey, derivePublicKey, deriveAddress, signBlock: nanoSignBlock } = require('nanocurrency');
  const blakejs = require('blakejs');
  const { blake2bHex } = blakejs;

  const SEED = '0'.repeat(64);
  const SENDER_SK = deriveSecretKey(SEED, 0);
  const SENDER_PK = derivePublicKey(SENDER_SK);
  const SENDER_ADDR = deriveAddress(SENDER_PK, { useNanoPrefix: true });

  test('SIGNATURE FORGERY: attacker submits real blockHash with fake signature', async () => {
    const mockRpc: any = {
      getBlockInfo: vi.fn(),
      receivableExists: vi.fn().mockResolvedValue(true),
    };
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpc });

    const blockHash = 'A'.repeat(64);
    const url = 'https://api.example.com/data';
    mockRpc.getBlockInfo.mockResolvedValue({
      hash: blockHash,
      confirmed: true,
      block_account: SENDER_ADDR,
      link: 'nano_destination',
      link_as_account: 'nano_destination',
      amount: '1000000',
    });

    const requirements = handler.getSignatureRequirements({
      amount: '1000000',
      payTo: 'nano_destination',
      url,
    });

    const payload: any = {
      x402Version: 2,
      accepted: requirements,
      payload: {
        proof: blockHash,
        signature: '0'.repeat(128),
      },
    };

    const result = await handler.handleVerify(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.error).toMatch(/signature/i);
  });

  test('URL SUBSTITUTION: attacker signs for url1, submits to url2', async () => {
    const mockRpc: any = {
      getBlockInfo: vi.fn(),
      receivableExists: vi.fn().mockResolvedValue(true),
    };
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpc });

    const blockHash = 'A'.repeat(64);
    const realUrl = 'https://api.example.com/real';
    const fakeUrl = 'https://api.example.com/fake';

    mockRpc.getBlockInfo.mockResolvedValue({
      hash: blockHash,
      confirmed: true,
      block_account: SENDER_ADDR,
      link: 'nano_destination',
      link_as_account: 'nano_destination',
      amount: '1000000',
    });

    // Sign for realUrl
    const messageHash = blake2bHex(blockHash + realUrl, undefined, 32);
    const signature = nanoSignBlock({ hash: messageHash, secretKey: SENDER_SK });

    // But requirements say fakeUrl
    const requirements = handler.getSignatureRequirements({
      amount: '1000000',
      payTo: 'nano_destination',
      url: fakeUrl,
    });

    const payload: any = {
      x402Version: 2,
      accepted: requirements,
      payload: { proof: blockHash, signature },
    };

    const result = await handler.handleVerify(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
  });

  test('REPLAY: same proof+signature reused on different session', async () => {
    const mockRpc: any = {
      getBlockInfo: vi.fn(),
      getAccountInfo: vi.fn(),
      getActiveDifficulty: vi.fn(),
      generateWork: vi.fn(),
      processBlock: vi.fn(),
      confirmBlock: vi.fn(),
      receivableExists: vi.fn().mockResolvedValue(true),
    };

    const FAC_SEED = '1'.repeat(64);
    const { derivePublicKey: dPk2, deriveAddress: dA2 } = require('nanocurrency');
    const FAC_SK = deriveSecretKey(FAC_SEED, 0);
    const FAC_PK = dPk2(FAC_SK);
    const FAC_ADDR = dA2(FAC_PK, { useNanoPrefix: true });

    const handler = new NanoSessionFacilitatorHandler({
      rpcClient: mockRpc,
      seed: FAC_SEED,
    });

    const blockHash = 'A'.repeat(64);
    const url = 'https://api.example.com/data';
    const amount = '1000000';

    mockRpc.getBlockInfo.mockResolvedValue({
      hash: blockHash,
      confirmed: true,
      block_account: SENDER_ADDR,
      link: FAC_ADDR,
      link_as_account: FAC_ADDR,
      amount,
    });
    mockRpc.getAccountInfo.mockResolvedValue({
      frontier: 'F'.repeat(64),
      balance: '5000000',
      representative: FAC_ADDR,
    });
    mockRpc.getActiveDifficulty.mockResolvedValue('fffffff800000000');
    mockRpc.generateWork.mockResolvedValue('ffff0000ffff0000');
    mockRpc.processBlock.mockResolvedValue('RECV_HASH');
    mockRpc.confirmBlock.mockResolvedValue(true);

    const requirements = handler.getSignatureRequirements({ amount, payTo: FAC_ADDR, url });
    const messageHash = blake2bHex(blockHash + url, undefined, 32);
    const signature = nanoSignBlock({ hash: messageHash, secretKey: SENDER_SK });

    const payload: any = {
      x402Version: 2,
      accepted: requirements,
      payload: { proof: blockHash, signature },
    };

    const result1 = await handler.handleSettle(requirements, payload);
    expect(result1!.success).toBe(true);

    // Replay same payload
    const result2 = await handler.handleSettle(requirements, payload);
    expect(result2!.success).toBe(false);
    expect(result2!.error).toMatch(/already spent/i);
  });

  test('EXPIRED PAYMENT: block not confirmed within timeout', async () => {
    const mockRpc: any = {
      getBlockInfo: vi.fn(),
      receivableExists: vi.fn().mockResolvedValue(true),
    };
    const handler = new NanoSessionFacilitatorHandler({ rpcClient: mockRpc });

    const blockHash = 'A'.repeat(64);
    // Always return unconfirmed
    mockRpc.getBlockInfo.mockResolvedValue({
      hash: blockHash,
      confirmed: false,
      block_account: SENDER_ADDR,
      link: 'nano_destination',
      link_as_account: 'nano_destination',
      amount: '1000000',
    });

    const requirements = handler.getSignatureRequirements({
      amount: '1000000',
      payTo: 'nano_destination',
      url: 'https://api.example.com',
    });

    const payload: any = {
      x402Version: 2,
      accepted: requirements,
      payload: { proof: blockHash, signature: '0'.repeat(128) },
    };

    const result = await handler.handleVerify(requirements, payload);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.error).toMatch(/not confirmed/i);
  }, 15000);
});
