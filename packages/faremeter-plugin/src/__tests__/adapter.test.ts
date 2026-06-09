/**
 * TDD tests for Faremeter adapter
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { x402, client } from '@faremeter/types';
import { SCHEME, NETWORK, ASSET } from '@nanosession/core';
import { createFacilitatorHandler, createPaymentHandler } from '../index.js';

type x402PaymentRequirements = x402.x402PaymentRequirements;
type x402PaymentPayload = x402.x402PaymentPayload;
type RequestContext = client.RequestContext;

interface NanoSessionExtra {
  tag: number;
  id: string;
  resourceAmountRaw: string;
  tagAmountRaw: string;
  expiresAt: string;
}

interface EnrichedExtra {
  nanoSession: NanoSessionExtra;
}

const createMockRpcClient = () => ({
  getBlockInfo: vi.fn(),
  getAccountInfo: vi.fn(),
  getActiveDifficulty: vi.fn(),
  generateWork: vi.fn(),
  processBlock: vi.fn(),
  confirmBlock: vi.fn(),
});

describe('createFacilitatorHandler', () => {
  let mockRpcClient: ReturnType<typeof createMockRpcClient>;

  beforeEach(() => {
    mockRpcClient = createMockRpcClient();
  });

  test('returns object satisfying FacilitatorHandler shape', () => {
    const handler = createFacilitatorHandler({
      rpcClient: mockRpcClient as any,
      payTo: 'nano_test_address',
    });

    expect(typeof handler.getRequirements).toBe('function');
    expect(typeof handler.handleSettle).toBe('function');
    expect(typeof handler.getSupported).toBe('function');
    expect(typeof handler.handleVerify).toBe('function');
  });

  test('getRequirements enriches requirements with transparent amount parts', async () => {
    const handler = createFacilitatorHandler({
      rpcClient: mockRpcClient as any,
      payTo: 'nano_test_address',
      defaultResourceAmountRaw: '1000000000000000000000000',
    });

    const result = await handler.getRequirements([{
      scheme: SCHEME,
      network: NETWORK,
      asset: ASSET,
      maxAmountRequired: '1000000000000000000000000',
      resource: '/api/test',
      description: 'Test resource',
      mimeType: 'application/json',
      payTo: 'nano_test_address',
      maxTimeoutSeconds: 300,
    }]);

    expect(result).toHaveLength(1);
    const extra = (result[0].extra as EnrichedExtra).nanoSession;
    expect(extra.tag).toBeDefined();
    expect(extra.id).toBeDefined();
    expect(extra.resourceAmountRaw).toBeDefined();
    expect(extra.tagAmountRaw).toBeDefined();
    expect(extra.expiresAt).toBeDefined();
    expect(
      (
        BigInt(extra.resourceAmountRaw) +
        BigInt(extra.tagAmountRaw)
      ).toString()
    ).toBe(result[0].maxAmountRequired);
  });

  test('handleVerify returns valid for matching amount and destination', async () => {
    const handler = createFacilitatorHandler({
      rpcClient: mockRpcClient as any,
      payTo: 'nano_destination',
    });

    const requirementsRaw: x402PaymentRequirements = {
      scheme: SCHEME,
      network: NETWORK,
      asset: ASSET,
      maxAmountRequired: '1000000000000000000000000',
      resource: '/api/test',
      description: 'Test resource',
      mimeType: 'application/json',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300,
    };

    const requirements = (await handler.getRequirements([requirementsRaw]))[0];

    mockRpcClient.getBlockInfo.mockResolvedValueOnce({
      hash: 'VALID_BLOCK_HASH',
      confirmed: true,
      link_as_account: 'nano_destination',
      amount: requirements.maxAmountRequired,
    });

    const payment: x402PaymentPayload = {
      x402Version: 2,
      scheme: SCHEME,
      network: NETWORK,
      payload: { blockHash: 'VALID_BLOCK_HASH' },
    };

    const result = await handler.handleVerify!(requirements, payment);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(true);
    expect(result!.invalidReason).toBeFalsy();
  });

  test('handleSettle rejects replayed block hash', async () => {
    const handler = createFacilitatorHandler({
      rpcClient: mockRpcClient as any,
      payTo: 'nano_destination',
      defaultResourceAmountRaw: '1000000000000000000000000',
    });

    const enriched = await handler.getRequirements([{
      scheme: SCHEME,
      network: NETWORK,
      asset: ASSET,
      maxAmountRequired: '1000000000000000000000000',
      resource: '/api/test',
      description: 'Test resource',
      mimeType: 'application/json',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300,
    }]);

    const requirements = enriched[0];
    mockRpcClient.getBlockInfo.mockResolvedValue({
      hash: 'ONCE_VALID_BLOCK_HASH',
      confirmed: true,
      link_as_account: 'nano_destination',
      amount: requirements.maxAmountRequired,
    });

    const payment: x402PaymentPayload = {
      x402Version: 2,
      scheme: SCHEME,
      network: NETWORK,
      payload: { blockHash: 'ONCE_VALID_BLOCK_HASH' },
    };

    const result1 = await handler.handleSettle(requirements, payment);
    expect(result1?.success).toBe(true);

    const result2 = await handler.handleSettle(requirements, payment);
    expect(result2?.success).toBe(false);
    expect(result2?.error).toMatch(/spent|already|session not found/i);
  });

  test('handleVerify accepts standard x402 payload.proof field', async () => {
    const handler = createFacilitatorHandler({
      rpcClient: mockRpcClient as any,
      payTo: 'nano_destination',
      defaultResourceAmountRaw: '1000000000000000000000000',
    });

    const requirements = (await handler.getRequirements([{
      scheme: SCHEME,
      network: NETWORK,
      asset: ASSET,
      maxAmountRequired: '1000000000000000000000000',
      resource: '/api/test',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300,
    }]))[0];

    mockRpcClient.getBlockInfo.mockResolvedValueOnce({
      hash: 'VALID_BLOCK_HASH_2',
      confirmed: true,
      link_as_account: 'nano_destination',
      amount: requirements.maxAmountRequired,
    });

    const payment = {
      x402Version: 2,
      scheme: SCHEME,
      network: NETWORK,
      payload: { proof: 'VALID_BLOCK_HASH_2' },
    } as x402PaymentPayload;

    const result = await handler.handleVerify!(requirements, payment);
    expect(result?.isValid).toBe(true);
    expect(result?.invalidReason).toBeFalsy();
  });
});

describe('createPaymentHandler', () => {
  let mockRpcClient: ReturnType<typeof createMockRpcClient>;

  beforeEach(() => {
    mockRpcClient = createMockRpcClient();
    mockRpcClient.getAccountInfo.mockResolvedValue({
      frontier: 'PREVIOUS_BLOCK_HASH',
      balance: '10000000000000000000000000000',
      representative: 'nano_rep_address',
    });
    mockRpcClient.getActiveDifficulty.mockResolvedValue('fffffff800000000');
    mockRpcClient.generateWork.mockResolvedValue('ffff0000ffff0000');
    mockRpcClient.processBlock.mockResolvedValue('BLOCK_HASH_1');
    mockRpcClient.getBlockInfo.mockResolvedValue({
      confirmed: true,
      hash: 'BLOCK_HASH_1',
      link_as_account: 'nano_destination',
      link: 'nano_destination',
      amount: '1000000000000000000000000',
    });
  });

  test('returns function satisfying PaymentHandler type', () => {
    const handler = createPaymentHandler({
      rpcClient: mockRpcClient as any,
      seed: '0'.repeat(64),
    });
    expect(typeof handler).toBe('function');
  });

  test('filters accepts by scheme/network and nanoSession shape', async () => {
    const handler = createPaymentHandler({
      rpcClient: mockRpcClient as any,
      seed: '0'.repeat(64),
    });

    const context: RequestContext = {
      request: new URL('https://example.com/api/test'),
    };

    const accepts: x402PaymentRequirements[] = [
      {
        scheme: SCHEME,
        network: NETWORK,
        asset: ASSET,
        maxAmountRequired: '1000000000000000000000000',
        resource: '/api/test',
        description: 'Test resource',
        mimeType: 'application/json',
        payTo: 'nano_destination',
        maxTimeoutSeconds: 300,
        extra: {
          nanoSession: {
            tag: 42,
            id: 'test-session',
            resourceAmountRaw: '999999999999999999999958',
            tagAmountRaw: '42',
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          }
        },
      },
      {
        scheme: 'exact',
        network: 'eip155:1',
        asset: 'USDC',
        maxAmountRequired: '1000000',
        resource: '/api/test',
        description: 'Test resource',
        mimeType: 'application/json',
        payTo: '0x123',
        maxTimeoutSeconds: 300,
      },
    ];

    const execers = await handler(context, accepts);
    expect(execers).toHaveLength(1);
    expect(execers[0].requirements.scheme).toBe(SCHEME);
  });

  test('accepts nanoSession extra without expiresAt for interoperability', async () => {
    const handler = createPaymentHandler({
      rpcClient: mockRpcClient as any,
      seed: '0'.repeat(64),
    });

    const context: RequestContext = {
      request: new URL('https://example.com/api/test'),
    };

    const accepts: x402PaymentRequirements[] = [{
      scheme: SCHEME,
      network: NETWORK,
      asset: ASSET,
      maxAmountRequired: '1000000000000000000000000',
      resource: '/api/test',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300,
      extra: {
        nanoSession: {
          tag: 42,
          id: 'test-session-2',
          resourceAmountRaw: '999999999999999999999958',
          tagAmountRaw: '42',
        }
      },
    }];

    const execers = await handler(context, accepts);
    expect(execers).toHaveLength(1);
  });
});

describe('createFacilitatorHandler — Track B (nanoSignature)', () => {
  let mockRpcClient: ReturnType<typeof createMockRpcClient>;

  beforeEach(() => {
    mockRpcClient = createMockRpcClient();
  });

  test('handleVerify returns invalid for nanoSignature requirements (gap: toNanoRequirements returns null)', async () => {
    const handler = createFacilitatorHandler({
      rpcClient: mockRpcClient as any,
      payTo: 'nano_destination',
    });

    const requirements: x402PaymentRequirements = {
      scheme: SCHEME,
      network: NETWORK,
      asset: ASSET,
      maxAmountRequired: '1000000',
      resource: '/api/test',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300,
      extra: {
        nanoSignature: {
          url: 'https://api.example.com/data',
        },
      },
    };

    const payment: x402PaymentPayload = {
      x402Version: 2,
      scheme: SCHEME,
      network: NETWORK,
      payload: { proof: 'BLOCK_HASH' },
    };

    // toNanoRequirements returns null for nanoSignature, so handleVerify returns invalid
    const result = await handler.handleVerify!(requirements, payment);
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.invalidReason).toMatch(/invalid requirements/i);
  });

  test('handleSettle returns error for nanoSignature requirements', async () => {
    const handler = createFacilitatorHandler({
      rpcClient: mockRpcClient as any,
      payTo: 'nano_destination',
    });

    const requirements: x402PaymentRequirements = {
      scheme: SCHEME,
      network: NETWORK,
      asset: ASSET,
      maxAmountRequired: '1000000',
      resource: '/api/test',
      payTo: 'nano_destination',
      maxTimeoutSeconds: 300,
      extra: {
        nanoSignature: {
          url: 'https://api.example.com/data',
        },
      },
    };

    const payment: x402PaymentPayload = {
      x402Version: 2,
      scheme: SCHEME,
      network: NETWORK,
      payload: { proof: 'BLOCK_HASH' },
    };

    const result = await handler.handleSettle(requirements, payment);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toMatch(/invalid requirements/i);
  });
});
