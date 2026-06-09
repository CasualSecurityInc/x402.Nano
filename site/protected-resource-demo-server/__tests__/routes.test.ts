import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { testApp } from './app';
import { __setProtectedMockRpcForTests, resetSpentHashesForTests } from '../routes/protected';
import { __setPollRpcClientForTests } from '../routes/poll';
import { getNextDemoDestination, resetDemoDestinationPoolForTests } from '../destination-pool';

const SEND_HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PAYER_ACCOUNT = 'nano_1111111111111111111111111111111111111111111111111111hifc8npp';

process.env.NANO_RPC_URL = 'http://localhost:7076';
process.env.NANO_SERVER_ADDRESS = 'nano_3arg3asgtigae3xckabaaewkx3bzsh7nwz7jkmjos79ihyaxwphhm6qgjps4';

function decodeBase64Json(b64: string): any {
  return JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8'));
}

describe('Protected demo routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    delete process.env.NANO_TEST_SEED;
    delete process.env.NANO_DEMO_ADDRESS_POOL_SIZE;
    delete process.env.NANO_DEMO_ADDRESS_START_INDEX;
    resetDemoDestinationPoolForTests();
    resetSpentHashesForTests();
    __setPollRpcClientForTests({
      async getAccountHistory() {
        return [
          {
            type: 'send',
            account: PAYER_ACCOUNT,
            amount: '10000000000000000000000000000',
            hash: SEND_HASH,
            local_timestamp: '0',
            height: '1',
            confirmed: 'true',
          }
        ];
      },
      async getBlockInfo() {
        return {
          hash: SEND_HASH,
          type: 'state',
          block_account: PAYER_ACCOUNT,
          amount: '10000000000000000000000000000',
          confirmed: true,
          link_as_account: process.env.NANO_SERVER_ADDRESS,
        };
      },
    } as any);

    __setProtectedMockRpcForTests(null);
  });

  it('returns PAYMENT-REQUIRED on the first request', async () => {
    const response = await request(testApp).get('/api/protected');

    expect(response.status).toBe(402);
    expect(response.headers['payment-required']).toBeDefined();

    const paymentRequired = decodeBase64Json(response.headers['payment-required']);
    expect(paymentRequired).not.toBeNull();
    expect(paymentRequired.accepts[0].scheme).toBe('exact');
    expect(paymentRequired.accepts[0].network).toBe('nano:mainnet');
    expect(paymentRequired.accepts[0].payTo).toBe(process.env.NANO_SERVER_ADDRESS);

    const challenge = paymentRequired.accepts[0].extra.challenge;
    expect(challenge.mechanism).toBe('nano-nym-exact');
    expect(challenge.version).toBe('ns8');
    expect(challenge.payToKind).toBe('address');
    expect(challenge.settlementPolicy).toBe('send_confirmed');
  });

  it('allocates unique payTo addresses from a bounded derived pool when NANO_TEST_SEED is configured', async () => {
    process.env.NANO_TEST_SEED = '809BA38BC4301B0170E972161C384ADFE2D19702031762EFEA78637BAE6AC045';
    process.env.NANO_DEMO_ADDRESS_POOL_SIZE = '2';
    process.env.NANO_DEMO_ADDRESS_START_INDEX = '1';
    resetDemoDestinationPoolForTests();

    const expectedA = getNextDemoDestination();
    const expectedB = getNextDemoDestination();
    resetDemoDestinationPoolForTests();

    const responseA = await request(testApp).get('/api/protected');
    const responseB = await request(testApp).get('/api/protected');

    const paymentRequiredA = decodeBase64Json(responseA.headers['payment-required']);
    const paymentRequiredB = decodeBase64Json(responseB.headers['payment-required']);

    expect(paymentRequiredA.accepts[0].payTo).toBe(expectedA);
    expect(paymentRequiredB.accepts[0].payTo).toBe(expectedB);
    expect(paymentRequiredA.accepts[0].payTo).not.toBe(paymentRequiredB.accepts[0].payTo);
  });

  it('returns 200 on successful settlement proof retry', async () => {
    const challengeResponse = await request(testApp).get('/api/protected');
    const paymentRequired = decodeBase64Json(challengeResponse.headers['payment-required']);
    const challenge = paymentRequired.accepts[0].extra.challenge;

    __setProtectedMockRpcForTests((hash: string) => {
      if (hash !== SEND_HASH) return null;
      return {
        hash,
        block_account: PAYER_ACCOUNT,
        amount: challenge.amount,
        confirmed: true,
        link_as_account: process.env.NANO_SERVER_ADDRESS,
      };
    });

    const signaturePayload = {
      x402Version: 2,
      accepted: paymentRequired.accepts[0],
      payload: {
        challengeId: challenge.challengeId,
        sendHash: SEND_HASH,
        payerAccount: PAYER_ACCOUNT,
      },
    };

    const encodedSignature = Buffer.from(JSON.stringify(signaturePayload)).toString('base64url');
    const response = await request(testApp)
      .get('/api/protected')
      .set('PAYMENT-SIGNATURE', encodedSignature);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.headers['payment-response']).toBeDefined();

    const paymentResponse = decodeBase64Json(response.headers['payment-response']);
    expect(paymentResponse.result.mode).toBe('settled');
    expect(paymentResponse.result.version).toBe('ns8');
    expect(paymentResponse.result.mechanism).toBe('nano-nym-exact');
  });

  it('rejects duplicate challenge replay and rejects replayed block hash', async () => {
    const challengeResponse = await request(testApp).get('/api/protected');
    const paymentRequired = decodeBase64Json(challengeResponse.headers['payment-required']);
    const challenge = paymentRequired.accepts[0].extra.challenge;

    __setProtectedMockRpcForTests((hash: string) => {
      if (hash !== SEND_HASH) return null;
      return {
        hash,
        block_account: PAYER_ACCOUNT,
        amount: challenge.amount,
        confirmed: true,
        link_as_account: process.env.NANO_SERVER_ADDRESS,
      };
    });

    // First retry: succeeds
    const sig1 = Buffer.from(JSON.stringify({
      x402Version: 2,
      accepted: paymentRequired.accepts[0],
      payload: { challengeId: challenge.challengeId, sendHash: SEND_HASH, payerAccount: PAYER_ACCOUNT },
    })).toString('base64url');

    const first = await request(testApp).get('/api/protected').set('PAYMENT-SIGNATURE', sig1);
    expect(first.status).toBe(200);

    // Second retry with same challengeId: challenge now deleted
    const second = await request(testApp).get('/api/protected').set('PAYMENT-SIGNATURE', sig1);
    expect(second.status).toBe(402);
    expect(second.body.error).toMatch(/Challenge not found/);

    // Fresh challenge, same send hash: spent-hash check should reject
    const challengeResponse2 = await request(testApp).get('/api/protected');
    const paymentRequired2 = decodeBase64Json(challengeResponse2.headers['payment-required']);
    const challenge2 = paymentRequired2.accepts[0].extra.challenge;

    __setProtectedMockRpcForTests((hash: string) => {
      if (hash !== SEND_HASH) return null;
      return {
        hash,
        block_account: PAYER_ACCOUNT,
        amount: challenge2.amount,
        confirmed: true,
        link_as_account: process.env.NANO_SERVER_ADDRESS,
      };
    });

    const sig2 = Buffer.from(JSON.stringify({
      x402Version: 2,
      accepted: paymentRequired2.accepts[0],
      payload: { challengeId: challenge2.challengeId, sendHash: SEND_HASH, payerAccount: PAYER_ACCOUNT },
    })).toString('base64url');

    const third = await request(testApp).get('/api/protected').set('PAYMENT-SIGNATURE', sig2);
    expect(third.status).toBe(402);
    expect(third.body.error).toMatch(/already spent/);
  });

  it('finds a matching send via the demo polling endpoint', async () => {
    const response = await request(testApp)
      .get('/api/poll-for-demo')
      .query({
        payerAccount: PAYER_ACCOUNT,
        payTo: process.env.NANO_SERVER_ADDRESS,
        amount: '10000000000000000000000000000',
      });

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(true);
    expect(response.body.sendHash).toBe(SEND_HASH);
  });
});
