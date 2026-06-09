import { Request, Response, Router } from 'express';
import { randomBytes } from 'crypto';
import { NanoRpcClient } from '@nanosession/rpc';
import { getNextDemoDestination } from '../destination-pool';

const SCHEME = 'exact';
const NETWORK = 'nano:mainnet';
const ASSET = 'XNO';

interface StoredChallenge {
  challengeId: string;
  mechanism: 'nano-nym-exact';
  version: 'ns8';
  payToKind: 'address';
  destination: string;
  amount: string;
  resourceAmountRaw: string;
  tagAmountRaw: string;
  expiresAt: string;
  expiresInSeconds: number;
  resourceUrl?: string;
  settlementPolicy: 'send_confirmed';
}

let rpcClient: NanoRpcClient | null = null;
let mockRpcBlockInfo: ((hash: string) => any) | null = null;

const spentHashes = new Set<string>();

export function __setProtectedMockRpcForTests(mock: ((hash: string) => any) | null) {
  mockRpcBlockInfo = mock;
}

export function resetSpentHashesForTests() {
  spentHashes.clear();
}

function getRpcClient(): NanoRpcClient {
  if (!rpcClient) {
    if (!process.env.NANO_RPC_URL) {
      throw new Error('NANO_RPC_URL environment variable is not set');
    }
    rpcClient = new NanoRpcClient({
      endpoints: [process.env.NANO_RPC_URL],
      timeoutMs: 15000,
    });
  }
  return rpcClient;
}

function getResourceUrl(req: Request): string {
  const proto = req.header('X-Forwarded-Proto') || req.protocol;
  const host = req.header('X-Forwarded-Host') || req.header('Host') || 'localhost:3001';
  return `${proto}://${host}${req.baseUrl || '/api/protected'}`;
}

const activeChallenges = new Map<string, StoredChallenge>();

function createChallenge(destination: string, resourceAmountRaw: string, opts: { resourceUrl?: string; expiresInSeconds?: number } = {}): StoredChallenge {
  const challengeId = randomBytes(16).toString('hex');
  const tagAmountRaw = (randomBytes(4).readUInt32BE(0) % 1000000).toString();
  const amount = (BigInt(resourceAmountRaw) + BigInt(tagAmountRaw)).toString();
  const expiresInSeconds = opts.expiresInSeconds ?? 180;
  const challenge: StoredChallenge = {
    challengeId,
    mechanism: 'nano-nym-exact',
    version: 'ns8',
    payToKind: 'address',
    destination,
    amount,
    resourceAmountRaw,
    tagAmountRaw,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    expiresInSeconds,
    resourceUrl: opts.resourceUrl,
    settlementPolicy: 'send_confirmed',
  };
  activeChallenges.set(challengeId, challenge);
  return challenge;
}

async function verifyBlock(sendHash: string, challenge: StoredChallenge): Promise<{ valid: boolean; error?: string; blockInfo?: any }> {
  if (spentHashes.has(sendHash)) {
    return { valid: false, error: 'Block hash already spent' };
  }

  let blockInfo: any;
  if (mockRpcBlockInfo) {
    blockInfo = await mockRpcBlockInfo(sendHash);
    if (!blockInfo) return { valid: false, error: 'Block not found' };
  } else {
    try {
      blockInfo = await getRpcClient().getBlockInfo(sendHash);
    } catch {
      return { valid: false, error: 'Block not found' };
    }
    if (!blockInfo) return { valid: false, error: 'Block not found' };
  }

  if (!blockInfo.confirmed) {
    return { valid: false, error: 'Block not confirmed' };
  }

  const destination = blockInfo.link_as_account ?? blockInfo.link;
  if (destination !== challenge.destination) {
    return { valid: false, error: `Destination mismatch: expected ${challenge.destination}, got ${destination}` };
  }

  if (BigInt(blockInfo.amount) !== BigInt(challenge.amount)) {
    return { valid: false, error: `Amount mismatch: expected ${challenge.amount}, got ${blockInfo.amount}` };
  }

  return { valid: true, blockInfo };
}

const EXCLUSIVE_CONTENT_HTML = `
  <div class="exclusive-content">
    <iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/TAT35tflCUM?si=TAzGQJ9jmgDuFgnw&amp;controls=0" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
    <p><em>Unlocked via NanoNym receipt settlement: the client paid first to a challenge-bound destination, then redeemed the confirmed send hash.</em></p>
  </div>
`;

export const protectedRoute = Router();

protectedRoute.get('/', async (req: Request, res: Response) => {
  const paymentSignature = req.header('PAYMENT-SIGNATURE');

  if (!paymentSignature) {
    const destination = getNextDemoDestination();
    const resourceAmountRaw = '10000000000000000000000000000';
    const challenge = createChallenge(destination, resourceAmountRaw, {
      resourceUrl: getResourceUrl(req),
      expiresInSeconds: 180,
    });

    const paymentRequired = {
      x402Version: 2,
      resource: {
        url: getResourceUrl(req),
        description: 'Access to protected demo content',
        mimeType: 'application/json',
      },
      accepts: [{
        scheme: SCHEME,
        network: NETWORK,
        asset: ASSET,
        amount: challenge.amount,
        payTo: challenge.destination,
        maxTimeoutSeconds: challenge.expiresInSeconds,
        extra: { challenge },
      }],
    };

    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString('base64url');
    res.status(402)
      .setHeader('PAYMENT-REQUIRED', encoded)
      .json({ x402Version: 2, error: 'Payment Required' });
    return;
  }

  let payload: any;
  try {
    const raw = Buffer.from(paymentSignature, 'base64url').toString('utf-8');
    payload = JSON.parse(raw);
  } catch {
    res.status(400).json({ error: 'Invalid PAYMENT-SIGNATURE encoding' });
    return;
  }

  const sendHash = payload.payload?.sendHash;
  const challengeId = payload.payload?.challengeId;
  const payerAccount = payload.payload?.payerAccount;

  if (!sendHash || !challengeId) {
    res.status(400).json({ error: 'PAYMENT-SIGNATURE missing sendHash or challengeId' });
    return;
  }

  const challenge = activeChallenges.get(challengeId);
  if (!challenge) {
    res.status(402).json({ error: 'Challenge not found or already redeemed' });
    return;
  }
  if (new Date(challenge.expiresAt) < new Date()) {
    activeChallenges.delete(challengeId);
    res.status(402).json({ error: 'Challenge expired' });
    return;
  }

  const result = await verifyBlock(sendHash, challenge);
  if (!result.valid) {
    const paymentResponse = {
      x402Version: 2,
      result: {
        version: 'ns8',
        mechanism: 'nano-nym-exact',
        mode: 'failed',
        challengeId,
        sendHash,
        error: result.error,
      },
    };
    res.status(402)
      .setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify(paymentResponse)).toString('base64url'))
      .json({ error: result.error });
    return;
  }

  spentHashes.add(sendHash);
  activeChallenges.delete(challengeId);

  const paymentResponse = {
    x402Version: 2,
    result: {
      version: 'ns8',
      mechanism: 'nano-nym-exact',
      mode: 'settled',
      challengeId,
      sendHash,
      destination: challenge.destination,
      amount: challenge.amount,
      payerAccount: payerAccount ?? result.blockInfo?.block_account,
      settledAt: new Date().toISOString(),
    },
    success: true,
  };

  res.status(200)
    .setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify(paymentResponse)).toString('base64url'))
    .json({
      success: true,
      html: EXCLUSIVE_CONTENT_HTML,
    });
});

protectedRoute.post('/', async (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Use GET /api/protected with PAYMENT-SIGNATURE' });
});
