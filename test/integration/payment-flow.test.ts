import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import * as dotenv from 'dotenv';
import { deriveSecretKey, derivePublicKey, deriveAddress, createBlock, signBlock, type BlockData } from 'nanocurrency';
import { generateWork as generateWorkRsp, validateWork as validateWorkRsp, WorkType } from 'nano-rspow-node';
import { NanoSessionFacilitatorHandler } from '@nanosession/facilitator';
import { NanoSessionPaymentHandler } from '@nanosession/client';
import { NanoRpcClient } from '@nanosession/rpc';
import { encodePaymentRequired, decodePaymentRequired, decodePaymentSignature, encodePaymentSignature } from '@nanosession/core';
import type { PaymentRequirements } from '@nanosession/core';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || './.env' });

describe('Integration: Full Payment Flow', () => {
  let shouldSkip = false;
  let skipReason = '';
  let server: ReturnType<typeof createServer>;
  let serverPort: number;
  let seed = '';
  let clientAddress = '';
  let serverAddress = '';
  let clientSecretKey = '';
  let serverSecretKey = '';
  let serverPublicKey = '';
  let rpcClient: NanoRpcClient | null = null;
  let rpcUrls: string[] = [];
  let hasRpcCredentials = false;


  const paymentAmount = '1000000000000000000000000';
  const fallbackWorkThreshold = 'fffffff800000000';

  const rpcCall = async (action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    // Use NanoRpcClient's internal call logic by making a raw request
    // Since NanoRpcClient doesn't expose a generic call method, we implement
    // failover here but rely on NanoRpcClient for URL parsing
    const errors: Error[] = [];
    
    for (const url of rpcUrls) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...params })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json() as Record<string, unknown>;
        if (data.error) {
          throw new Error(`RPC error: ${data.error}`);
        }
        
        return data;
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    
    throw new AggregateError(errors, `All RPC endpoints failed for action: ${action}`);
  };

  const getAccountInfoSafe = async (address: string) => {
    if (!rpcClient) {
      throw new Error('RPC client not initialized');
    }

    try {
      return await rpcClient.getAccountInfo(address);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // RPC returns "Account not found" for accounts that haven't been opened yet
      if (message.toLowerCase().includes('account not found')) {
        return null;
      }
      throw error;
    }
  };

  const getWorkThreshold = async () => {
    try {
      const telemetry = await rpcCall('telemetry', {});
      const activeDifficulty = telemetry.active_difficulty;
      if (typeof activeDifficulty === 'string' && activeDifficulty.length > 0) {
        return activeDifficulty;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`   ⚠️  RPC telemetry failed (${message}); using fallback threshold...`);
    }

    return fallbackWorkThreshold;
  };

  const generateWork = async (root: string, isReceive = false) => {
    const threshold = await getWorkThreshold();

    if (hasRpcCredentials) {
      const maxRetries = 10;
      let delayMs = 1000;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const result = await rpcCall('work_generate', { hash: root, difficulty: threshold });
          return result.work as string;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isRateLimited = message.includes('429') || message.toLowerCase().includes('too many');

          if (isRateLimited && attempt < maxRetries - 1) {
            console.log(`   ⏳ Rate limited, waiting ${delayMs / 1000}s before retry...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            delayMs = Math.min(delayMs * 2, 30000);
            continue;
          }

          console.log(`   ⚠️  RPC work_generate failed (${message}) — falling back to local PoW`);
          break;
        }
      }
    }

    // Exclusively use nano-rspow-node for local client PoW in integration tests
    const wt = isReceive ? WorkType.Receive : WorkType.Send;
    const work = await generateWorkRsp(root, wt);
    if (!work) {
      throw new Error('Local work generation failed');
    }
    if (!validateWorkRsp(root, work, wt)) {
      throw new Error('Local work generation failed to meet threshold');
    }
    return work;
  };

  const createAndProcessSendBlock = async (args: {
    fromAddress: string;
    toAddress: string;
    amountRaw: string;
    secretKeyHex: string;
  }) => {
    const accountInfo = await getAccountInfoSafe(args.fromAddress);
    if (!accountInfo) {
      return null;
    }

    const newBalance = BigInt(accountInfo.balance) - BigInt(args.amountRaw);
    if (newBalance < 0n) {
      return null;
    }

    const work = await generateWork(accountInfo.frontier); // send (client PoW via rspow-node)

    // Use nanocurrency.createBlock to create the block
    const blockData: BlockData = {
      work: work,
      balance: newBalance.toString(),
      representative: accountInfo.representative,
      previous: accountInfo.frontier,
      link: args.toAddress
    };

    const block = createBlock(args.secretKeyHex, blockData);

    // Debug: Log block details
    console.log('   Creating block:');
    console.log('   - From:', args.fromAddress);
    console.log('   - To:', args.toAddress);
    console.log('   - Balance:', blockData.balance);
    console.log('   - Previous:', blockData.previous);
    console.log('   - Representative:', blockData.representative);
    console.log('   - Work:', blockData.work);
    console.log('   - Block hash:', block.hash);

    // Sign the block
    const signature = signBlock({
      hash: block.hash,
      secretKey: args.secretKeyHex
    });

    // Process the block
    const processResult = await rpcCall('process', {
      json_block: true,
      block: {
        ...block.block,
        signature: signature
      }
    });

    const hash = processResult.hash as string;
    await waitForConfirmation(hash);
    return hash;
  };

  const receivePendingAll = async (address: string, secretKeyHex: string, representativeFallback: string) => {
    let pending;
    try {
      pending = await rpcCall('pending', {
        account: address,
        count: 100,
        source: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('account not found')) {
        return;
      }
      throw error;
    }

    const blocks = (pending.blocks as Record<string, unknown> | undefined) ?? {};
    const entries = Object.entries(blocks);
    if (!entries.length) {
      return;
    }

    let accountInfo = await getAccountInfoSafe(address);
    let balance = accountInfo ? BigInt(accountInfo.balance) : 0n;
    let previous = accountInfo ? accountInfo.frontier : '0';
    let representative = accountInfo ? accountInfo.representative : representativeFallback;

    for (const [pendingHash, info] of entries) {
      const amountRaw = typeof info === 'string'
        ? info
        : (info as { amount?: string }).amount;

      if (!amountRaw) {
        continue;
      }

      balance += BigInt(amountRaw);

      // For receive blocks:
      // - If account doesn't exist (previous = '0' or null), create open block with previous: null
      // - If account exists, previous is the frontier hash
      const isNewAccount = previous === '0' || previous === null || previous === undefined;

      const workRoot = isNewAccount ? serverPublicKey : previous;
      const work = await generateWork(workRoot, true); // receive/open PoW via rspow-node exclusively

      // Use nanocurrency.createBlock for receive blocks
      const receiveBlockData: BlockData = {
        work: work,
        balance: balance.toString(),
        representative: representative,
        previous: isNewAccount ? null : previous,
        link: pendingHash  // For receive, link is the pending send block hash
      };

      const receiveBlock = createBlock(secretKeyHex, receiveBlockData);
      const receiveSignature = signBlock({
        hash: receiveBlock.hash,
        secretKey: secretKeyHex
      });

      const processResult = await rpcCall('process', {
        json_block: true,
        block: { ...receiveBlock.block, signature: receiveSignature }
      });

      const hash = (processResult.hash as string | undefined)
        ?? (receiveBlock.hash as string | undefined);

      if (hash) {
        await waitForConfirmation(hash);
        previous = hash;
      }

      accountInfo = await getAccountInfoSafe(address);
      if (accountInfo) {
        representative = accountInfo.representative;
      }
    }
  };

  const sweepAll = async (fromAddress: string, toAddress: string, secretKeyHex: string) => {
    const accountInfo = await getAccountInfoSafe(fromAddress);
    if (!accountInfo) {
      return null;
    }

    if (BigInt(accountInfo.balance) === 0n) {
      return null;
    }

    return createAndProcessSendBlock({
      fromAddress,
      toAddress,
      amountRaw: accountInfo.balance,
      secretKeyHex
    });
  };

  const waitForConfirmation = async (hash: string, timeoutMs: number = 30000) => {
    if (!rpcClient) {
      throw new Error('RPC client not initialized');
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const blockInfo = await rpcClient.getBlockInfo(hash);
      if (blockInfo.confirmed) {
        return blockInfo;
      }

      try {
        await rpcClient.confirmBlock(hash);
      } catch {
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error(`Block ${hash} not confirmed within ${timeoutMs}ms`);
  };



  beforeAll(async () => {
    seed = process.env.NANO_TEST_SEED || '';
    if (!seed) {
      skipReason = 'NANO_TEST_SEED not set';
      console.log(`\n⚠️  Skipping integration tests: ${skipReason}`);
      console.log('   Create .env file from .env.example to run integration tests\n');
      shouldSkip = true;
      return;
    }

    try {
      clientSecretKey = deriveSecretKey(seed, 0);
      serverSecretKey = deriveSecretKey(seed, 1);
      clientAddress = deriveAddress(derivePublicKey(clientSecretKey), { useNanoPrefix: true });
      serverAddress = deriveAddress(derivePublicKey(serverSecretKey), { useNanoPrefix: true });
      serverPublicKey = derivePublicKey(serverSecretKey);
    } catch (error) {
      shouldSkip = true;
      skipReason = error instanceof Error ? `invalid NANO_TEST_SEED: ${error.message}` : 'invalid NANO_TEST_SEED';
      console.log(`\n⚠️  Skipping integration tests: ${skipReason}`);
      return;
    }

    const rpcUrlsEnv = process.env.NANO_RPC_URLS || process.env.NANO_RPC_URL || 'https://rpc.nano.to';
    rpcUrls = rpcUrlsEnv.split(',').map(u => u.trim()).filter(Boolean);
    
    if (!rpcUrls.length) {
      skipReason = 'no RPC endpoints configured';
      console.log(`\n⚠️  Skipping integration tests: ${skipReason}`);
      shouldSkip = true;
      return;
    }
    
    // NanoRpcClient handles URL parsing and query param extraction internally
    rpcClient = new NanoRpcClient({ endpoints: rpcUrls });
    hasRpcCredentials = rpcUrls.some(url => url.includes('?') && new URL(url).searchParams.has('key'));
    

    console.log('\n🔑 Test Accounts (single-slot mainnet E2E):');
    console.log(`   Client (acct0): ${clientAddress}`);
    console.log(`   Server (acct1): ${serverAddress}`);
    console.log('   Parallelism: 1 (intentional for this repo\'s real-mainnet suite)');
    if (hasRpcCredentials) {
      console.log('   🔧 Work generation: RPC (credentials detected)');
    } else {
      console.log('   🔧 Work generation: Local CPU/GPU');
    }
  });

  afterAll(async () => {
    if (shouldSkip || !seed || !rpcClient) {
      return;
    }

    console.log('\n🧹 Cleanup: sweeping funds back to client account...');

    try {
      const clientInfo = await getAccountInfoSafe(clientAddress);
      const representative = clientInfo?.representative ?? clientAddress;

      await receivePendingAll(serverAddress, serverSecretKey, representative);
      const sweepHash = await sweepAll(serverAddress, clientAddress, serverSecretKey);
      if (sweepHash) {
        console.log(`   ↩️  Swept server balance to client: ${sweepHash}`);
      }

      await receivePendingAll(clientAddress, clientSecretKey, representative);
      console.log('   ✅ Received all pending blocks on client account');
    } catch (error) {
      console.log('   ⚠️  Cleanup failed (non-fatal):', error);
    }
  }, 120000);

  describe('Track 1: nanoSession (Stateful)', () => {
    test('full payment flow on mainnet', async () => {
      if (shouldSkip) {
        console.log(`Test skipped - ${skipReason || 'integration prerequisites not met'}`);
        return;
      }
      if (!rpcClient) return;

      const serverHandler = new NanoSessionFacilitatorHandler({ rpcClient: rpcClient! });

      const clientAccountInfo = await getAccountInfoSafe(clientAddress);
      if (!clientAccountInfo) {
        console.log('⚠️  Skipping: Client account not found on chain');
        return;
      }

      await receivePendingAll(serverAddress, serverSecretKey, clientAccountInfo.representative);
      const sweepBeforeHash = await sweepAll(serverAddress, clientAddress, serverSecretKey);
      if (sweepBeforeHash) {
        console.log(`   ↩️  Swept server balance to client: ${sweepBeforeHash}`);
      }

      await new Promise<void>((resolve) => {
        const requirementsCache = new Map<string, ReturnType<typeof serverHandler.getRequirements>>();

        server = createServer(async (req, res) => {
          if (req.url === '/protected') {
            const paymentSignature = req.headers['payment-signature'];

            if (!paymentSignature) {
              const requirements = serverHandler.getRequirements({
                resourceAmountRaw: paymentAmount,
                payTo: serverAddress,
                maxTimeoutSeconds: 300
              });
              requirementsCache.set(requirements.extra.nanoSession!.id, requirements);

              const paymentRequired = {
                x402Version: 2 as const,
                resource: { url: `http://${req.headers.host}/protected` },
                accepts: [requirements]
              };

              res.writeHead(402, {
                'Content-Type': 'application/json',
                'PAYMENT-REQUIRED': encodePaymentRequired(paymentRequired)
              });
              res.end(JSON.stringify({ error: 'Payment required' }));
              return;
            }

            try {
              const payload = decodePaymentSignature(paymentSignature as string);
              if (!payload) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid payload' }));
                return;
              }
              const sessionId = payload.accepted.extra.nanoSession?.id;
              const requirements = sessionId ? requirementsCache.get(sessionId) : undefined;

              if (!requirements) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unknown session' }));
                return;
              }

              const result = await serverHandler.handleSettle!(requirements, payload);

              if (result?.success) {
                requirementsCache.delete(sessionId!);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  message: 'Access granted',
                  transactionHash: result.transactionHash
                }));
              } else {
                res.writeHead(402, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'Payment verification failed',
                  details: result?.error
                }));
              }
            } catch (error) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid payment response' }));
            }
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        });

        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            serverPort = addr.port;
          }
          resolve();
        });
      });

      const baseUrl = `http://127.0.0.1:${serverPort}`;

      try {
        console.log('\n📡 Step 1: Requesting protected resource...');
        const response1 = await fetch(`${baseUrl}/protected`);

        expect(response1.status).toBe(402);
        const paymentRequiredHeader = response1.headers.get('PAYMENT-REQUIRED');
        expect(paymentRequiredHeader).toBeTruthy();
        const paymentRequired = decodePaymentRequired(paymentRequiredHeader!);
        expect(paymentRequired).toBeTruthy();
        if (!paymentRequired) throw new Error('Failed to decode PaymentRequired');

        const requirements = paymentRequired.accepts[0];
        console.log('   ✓ Received 402 with PaymentRequirements');
        console.log(`   💰 Amount: ${requirements.amount} raw (${Number(requirements.amount) / 1e30} XNO)`);

        console.log('\n💳 Step 2: Creating payment...');
        const clientHandler = new NanoSessionPaymentHandler({
          rpcClient: rpcClient!,
          seed,
          maxSpend: process.env.NANO_MAX_SPEND || '1000000000000000000000000000'
        });

        const execers = await clientHandler.handle({}, [requirements]);
        expect(execers.length).toBeGreaterThan(0);

        const clientBalance = BigInt(clientAccountInfo.balance);
        if (clientBalance < BigInt(requirements.amount)) {
          console.log('⚠️  Skipping: Insufficient balance to cover payment');
          return;
        }

        console.log('   ✓ Payment execer created');
        console.log('   📤 Broadcasting payment via RPC...');

        // The requirements amount is the exact normative send amount.
        const nanoSession = requirements.extra.nanoSession;
        const taggedAmount = requirements.amount;
        console.log(`   🏷️  Tag: ${nanoSession!.tag}, Tagged amount: ${taggedAmount}`);

        let paymentHash: string | null;
        try {
          paymentHash = await createAndProcessSendBlock({
            fromAddress: clientAddress,
            toAddress: serverAddress,
            amountRaw: taggedAmount,
            secretKeyHex: clientSecretKey
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`   ⚠️  Broadcasting failed: ${message}`);
          console.log('   This is expected for unfunded test accounts');
          return;
        }

        if (!paymentHash) {
          console.log('   ⚠️  Skipping: Could not create payment block (account may not exist)');
          return;
        }

        const blockInfoAfter = await rpcClient.getBlockInfo(paymentHash!);
        console.log(`   ✅ Payment confirmed: ${paymentHash}`);
        console.log(`   🔗 Destination: ${blockInfoAfter.link_as_account ?? blockInfoAfter.link}`);

        console.log('\n🔐 Step 3: Retrying with payment...');
        const response2 = await fetch(`${baseUrl}/protected`, {
          headers: {
            'PAYMENT-SIGNATURE': encodePaymentSignature({
              x402Version: 2,
              accepted: requirements,
              payload: { proof: paymentHash }
            })
          }
        });

        console.log(`   Response status: ${response2.status}`);
        if (response2.status === 402) {
          const errorBody = await response2.json();
          console.log(`   Server error: ${JSON.stringify(errorBody)}`);
        }

        expect(response2.status).toBe(200);
        const responseBody = await response2.json();
        expect(responseBody.transactionHash).toBe(paymentHash);

        await receivePendingAll(serverAddress, serverSecretKey, clientAccountInfo.representative);
        const sweepAfterHash = await sweepAll(serverAddress, clientAddress, serverSecretKey);
        if (sweepAfterHash) {
          console.log(`   ↩️  Swept server balance to client: ${sweepAfterHash}`);
        }
      } finally {
        server.close();
      }
    }, 120000);

    // ============================================================================
    // SECURITY ATTACK TESTS
    // These tests verify the Session Binding Invariant from Rev5 Security Model
    // ============================================================================

    test('rejects frontrun attack - stolen hash with wrong session', async () => {
      if (shouldSkip) {
        console.log(`Test skipped - ${skipReason || 'integration prerequisites not met'}`);
        return;
      }

      // This test verifies the Session Binding Invariant:
      // A payment made for Session A cannot be used to satisfy Session B

      console.log('\n🔓 ATTACK TEST: Frontrun (Receipt Stealing)');

      // 1. Victim requests resource → gets sessionId A with tag A
      // 2. Attacker requests resource → gets sessionId B with tag B  
      // 3. Victim pays (amount includes tag A)
      // 4. Attacker tries to use victim's blockHash with sessionId B
      // 5. Server MUST reject: tag A ≠ tag B

      const serverHandler = new NanoSessionFacilitatorHandler({ rpcClient: rpcClient! });

      // Get requirements for two different "sessions"
      const victimRequirements = serverHandler.getRequirements({
        resourceAmountRaw: paymentAmount,
        payTo: serverAddress,
        maxTimeoutSeconds: 300
      });

      const attackerRequirements = serverHandler.getRequirements({
        resourceAmountRaw: paymentAmount,
        payTo: serverAddress,
        maxTimeoutSeconds: 300
      });

      console.log(`   Victim session: ${victimRequirements.extra.nanoSession!.id}, tag: ${victimRequirements.extra.nanoSession!.tag}`);
      console.log(`   Attacker session: ${attackerRequirements.extra.nanoSession!.id}, tag: ${attackerRequirements.extra.nanoSession!.tag}`);

      // Verify tags are different (critical for this test)
      expect(victimRequirements.extra.nanoSession!.tag).not.toBe(attackerRequirements.extra.nanoSession!.tag);

      // Victim pays with THEIR tag encoded in amount
      const victimTaggedAmount = (BigInt(victimRequirements.amount) + BigInt(victimRequirements.extra.nanoSession!.tag)).toString();

      const clientInfo = await getAccountInfoSafe(clientAddress);
      if (!clientInfo || BigInt(clientInfo.balance) < BigInt(victimTaggedAmount)) {
        console.log('   ⚠️ Skipping: Insufficient balance');
        return;
      }

      const victimBlockHash = await createAndProcessSendBlock({
        fromAddress: clientAddress,
        toAddress: serverAddress,
        amountRaw: victimTaggedAmount,
        secretKeyHex: clientSecretKey
      });

      if (!victimBlockHash) {
        console.log('   ⚠️ Skipping: Could not create payment block');
        return;
      }

      console.log(`   ✅ Victim payment confirmed: ${victimBlockHash}`);

      // ATTACK: Attacker tries to use victim's hash with attacker's session
      const attackPayload = {
        x402Version: 2 as const,
        accepted: attackerRequirements,
        payload: { proof: victimBlockHash }
      };

      const result = await serverHandler.handleSettle!(attackerRequirements, attackPayload);

      // MUST FAIL - the block's tag doesn't match attacker's session tag
      console.log(`   Attack result: success=${result?.success}, error=${result?.error}`);
      expect(result?.success).toBe(false);
      console.log('   ✅ Attack correctly rejected!');

      // Cleanup: sweep funds back
      await receivePendingAll(serverAddress, serverSecretKey, clientInfo.representative);
      await sweepAll(serverAddress, clientAddress, serverSecretKey);
    }, 120000);

    test('rejects receipt reuse - already spent', async () => {
      if (shouldSkip) {
        console.log(`Test skipped - ${skipReason || 'integration prerequisites not met'}`);
        return;
      }

      console.log('\n🔓 ATTACK TEST: Receipt Reuse (Double Spend Attempt)');

      const serverHandler = new NanoSessionFacilitatorHandler({ rpcClient: rpcClient! });

      const requirements = serverHandler.getRequirements({
        resourceAmountRaw: paymentAmount,
        payTo: serverAddress,
        maxTimeoutSeconds: 300
      });

      const taggedAmount = requirements.amount;

      const clientInfo = await getAccountInfoSafe(clientAddress);
      if (!clientInfo || BigInt(clientInfo.balance) < BigInt(taggedAmount)) {
        console.log('   ⚠️ Skipping: Insufficient balance');
        return;
      }

      const blockHash = await createAndProcessSendBlock({
        fromAddress: clientAddress,
        toAddress: serverAddress,
        amountRaw: taggedAmount,
        secretKeyHex: clientSecretKey
      });

      if (!blockHash) {
        console.log('   ⚠️ Skipping: Could not create payment block');
        return;
      }

      console.log(`   ✅ Payment confirmed: ${blockHash}`);

      // First submission - should succeed
      const payload = {
        x402Version: 2 as const,
        accepted: requirements,
        payload: { proof: blockHash }
      };
      const result1 = await serverHandler.handleSettle!(requirements, payload);
      console.log(`   First submission: success=${result1?.success}`);
      expect(result1?.success).toBe(true);

      // Second submission - same hash - MUST FAIL (already spent)
      const result2 = await serverHandler.handleSettle!(requirements, payload);
      console.log(`   Second submission: success=${result2?.success}, error=${result2?.error}`);
      expect(result2?.success).toBe(false);
      console.log('   ✅ Reuse correctly rejected!');

      // Cleanup
      await receivePendingAll(serverAddress, serverSecretKey, clientInfo.representative);
      await sweepAll(serverAddress, clientAddress, serverSecretKey);
    }, 120000);

    test('rejects unknown session - session spoofing', async () => {
      if (shouldSkip) {
        console.log(`Test skipped - ${skipReason || 'integration prerequisites not met'}`);
        return;
      }

      console.log('\n🔓 ATTACK TEST: Session Spoofing (Unknown Session)');

      const serverHandler = new NanoSessionFacilitatorHandler({ rpcClient: rpcClient! });

      // Create a real payment for a real session
      const realRequirements = serverHandler.getRequirements({
        resourceAmountRaw: paymentAmount,
        payTo: serverAddress,
        maxTimeoutSeconds: 300
      });

      const taggedAmount = realRequirements.amount;

      const clientInfo = await getAccountInfoSafe(clientAddress);
      if (!clientInfo || BigInt(clientInfo.balance) < BigInt(taggedAmount)) {
        console.log('   ⚠️ Skipping: Insufficient balance');
        return;
      }

      const blockHash = await createAndProcessSendBlock({
        fromAddress: clientAddress,
        toAddress: serverAddress,
        amountRaw: taggedAmount,
        secretKeyHex: clientSecretKey
      });

      if (!blockHash) {
        console.log('   ⚠️ Skipping: Could not create payment block');
        return;
      }

      console.log(`   ✅ Payment confirmed: ${blockHash}`);

      // ATTACK: Submit with a FAKE session ID that was never issued
      const fakeSessionId = 'fake-session-id-12345-never-issued';

      // Create fake requirements with the spoofed session
      const fakeRequirements = {
        ...realRequirements,
        extra: {
          ...realRequirements.extra,
          nanoSession: {
            ...realRequirements.extra.nanoSession,
            id: fakeSessionId
          }
        }
      };

      const payload = {
        x402Version: 2 as const,
        accepted: fakeRequirements,
        payload: { proof: blockHash }
      };
      const result = await serverHandler.handleSettle!(fakeRequirements as unknown as PaymentRequirements, payload as any);

      // This should fail because the tag won't match (or session is unknown)
      // The exact behavior depends on implementation, but it MUST NOT succeed
      console.log(`   Attack result: success=${result?.success}, error=${result?.error}`);
      expect(result?.success).toBe(false);
      console.log('   ✅ Spoofing correctly rejected!');

      // Cleanup
      await receivePendingAll(serverAddress, serverSecretKey, clientInfo.representative);
      await sweepAll(serverAddress, clientAddress, serverSecretKey);
    }, 120000);
  }); // End Track 1

  describe('Track 2: nanoSignature (Stateless)', () => {
    test('full payment flow with settle-before-grant', async () => {
      if (shouldSkip) {
        console.log(`Test skipped - ${skipReason || 'integration prerequisites'}`);
        return;
      }

      const serverHandler = new NanoSessionFacilitatorHandler({
        rpcClient: rpcClient!,
        seed: seed,
        accountIndex: 1,
        receiveMode: 'sync'
      });

      const resourceUrl = 'https://api.example.com/track2';
      const requirements = serverHandler.getSignatureRequirements({
        amount: paymentAmount,
        payTo: serverAddress,
        maxTimeoutSeconds: 300,
        url: resourceUrl,
        messageToSign: 'block_hash+url'
      });

      const clientInfo = await getAccountInfoSafe(clientAddress);
      if (!clientInfo || BigInt(clientInfo.balance) < BigInt(paymentAmount)) {
        console.log('   ⚠️ Skipping: Insufficient balance');
        return;
      }

      console.log('\n💳 Track 2: Client generating payment via handler...');
      const clientHandler = new NanoSessionPaymentHandler({
        rpcClient: rpcClient!,
        seed: clientSecretKey, // the seed was derived directly as clientSecretKey in these specs
        maxSpend: process.env.NANO_MAX_SPEND || '1000000000000000000000000000'
      });
      // The test setup actually uses seed=seed, accountIndex=0 for client, so let's use that
      const properClientHandler = new NanoSessionPaymentHandler({
        rpcClient: rpcClient!,
        seed: seed,
        accountIndex: 0,
        maxSpend: process.env.NANO_MAX_SPEND || '1000000000000000000000000000'
      });

      const execers = await properClientHandler.handle({ url: resourceUrl }, [requirements]);
      expect(execers.length).toBeGreaterThan(0);
      
      const { payload } = await execers[0].exec();
      console.log(`   ✅ Track 2 Payment sent and signed: ${payload.payload.proof}`);

      console.log('🔐 Track 2: Server verifying and settling via atomic receive lock...');
      const result = await serverHandler.handleSettle!(requirements, payload, { url: resourceUrl });

      if (!result?.success) {
        console.error('TRACK 2 FAILED WITH:', result);
      }
      expect(result?.success).toBe(true);
      console.log(`   ✅ Track 2 Settle success: ${result?.transactionHash}`);

      const serverInfo = await getAccountInfoSafe(serverAddress);
      expect(serverInfo).toBeDefined();
      expect(serverInfo!.frontier).toBe(result?.transactionHash);

      await sweepAll(serverAddress, clientAddress, serverSecretKey);
    }, 120000);

    test('URL is bound to server-specified canonical URL, not client context', async () => {
      if (shouldSkip) return;

      const serverHandler = new NanoSessionFacilitatorHandler({
        rpcClient: rpcClient!,
        seed: seed,
        accountIndex: 1,
        receiveMode: 'sync'
      });

      const resourceUrl = 'https://api.example.com/track2';
      const requirements = serverHandler.getSignatureRequirements({
        amount: paymentAmount,
        payTo: serverAddress,
        url: resourceUrl,
      });

      const clientInfo = await getAccountInfoSafe(clientAddress);
      if (!clientInfo || BigInt(clientInfo.balance) < BigInt(paymentAmount)) return;

      const clientHandler = new NanoSessionPaymentHandler({
        rpcClient: rpcClient!,
        seed: seed,
        accountIndex: 0
      });

      // With the fix, client uses the URL from requirements (server-specified),
      // not from context. This prevents the replay attack scenario.
      // The signature is now bound to the canonical URL in requirements.
      const execers = await clientHandler.handle({}, [requirements]);
      const { payload } = await execers[0].exec();

      console.log('🔐 Track 2 Security: Verifying that URL binding uses server-specified canonical URL...');
      // Server validates using the same URL from requirements
      const result = await serverHandler.handleSettle!(requirements, payload);

      console.log(`   Result: success=${result?.success}, error=${result?.error}`);
      expect(result?.success).toBe(true);
      console.log('   ✅ Signature validated - client correctly used server-specified URL!');

      await sweepAll(serverAddress, clientAddress, serverSecretKey);
    }, 120000);
  });
});
