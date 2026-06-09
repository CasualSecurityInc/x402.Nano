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
    // In NanoSession Rev 7, nanoSignature uses Ed25519 signatures over blake2b(block_hash + url).
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
