/**
 * Minimalist HTTP CLI for x402.Nano
 * 
 * Demonstrates basic interaction with x402 protected resources supporting 
 * Track 1 (nanoSession) and Track 2 (nanoSignature) mechanisms.
 */

import 'dotenv/config';
import { NanoSessionPaymentHandler } from '@nanosession/client';
import { NanoRpcClient } from '@nanosession/rpc';
import { 
  decodePaymentRequired, 
  encodePaymentSignature 
} from '@nanosession/core';
import type { PaymentRequirements, PaymentPayload } from '@nanosession/core';
import debug from 'debug';

const logDebug = debug('nanosession:http-cli');
const logVerbose = debug('nanosession:http-cli:verbose');

// 1. Configuration from Environment
const SEED = process.env.NANO_SEED;
const ACCOUNT_INDEX = parseInt(process.env.NANO_ACCOUNT_INDEX || '0', 10);
const MAX_SPEND = process.env.NANO_MAX_SPEND || '100000000000000000000000000000'; // 0.1 XNO default
const RPC_ENDPOINTS = (process.env.NANO_RPC_URL || 'https://rpc.nano.to')
  .split(',')
  .map(u => u.trim());

// 2. Parse CLI Arguments
const args = process.argv.slice(2);
let verbose = false;
let type: 'session' | 'signature' | undefined;
let url: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-v' || args[i] === '--verbose') {
    verbose = true;
    debug.enable('nanosession:*');
  } else if (args[i] === '-t' || args[i] === '--type') {
    const val = args[++i];
    if (val === 'session' || val === 'signature') {
      type = val;
    } else {
      console.error(`❌ Error: Invalid type "${val}". Must be "session" or "signature".`);
      process.exit(1);
    }
  } else if (!args[i].startsWith('-')) {
    url = args[i];
  }
}

if (!url) {
  console.log('Usage: http-cli [-v] [-t session|signature] <url>');
  process.exit(1);
}

if (!SEED) {
  console.error('❌ Error: NANO_SEED environment variable is required');
  process.exit(1);
}

const log = (msg: string, isVerboseOnly = false) => {
  if (!isVerboseOnly || verbose) {
    console.log(msg);
  }
};

/**
 * Decodes a base64 string to UTF-8 text
 */
function decodeBase64(base64: string): string {
  try {
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return '<invalid base64>';
  }
}

/**
 * Logs request/response headers in verbose mode
 */
function logHeaders(type: 'request' | 'response', headers: Record<string, string>) {
  if (!verbose) return;
  console.log(`\n📡 ${type === 'request' ? 'Request' : 'Response'} Headers:`);
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase().includes('payment')) {
      const decoded = decodeBase64(value);
      console.log(`  ${key}: ${value.slice(0, 40)}...`);
      console.log(`  └─ decoded: ${decoded.slice(0, 200)}${decoded.length > 200 ? '...' : ''}`);
    } else {
      console.log(`  ${key}: ${value}`);
    }
  }
}

// 3. Initialize
const rpcClient = new NanoRpcClient({ endpoints: RPC_ENDPOINTS });
const paymentHandler = new NanoSessionPaymentHandler({
  rpcClient,
  seed: SEED,
  maxSpend: MAX_SPEND,
  accountIndex: ACCOUNT_INDEX
});

async function run() {
  log(`🚀 Requesting ${url}...`);

  // Phase 1: Initial Request
  let response = await fetch(url!);
  
  if (response.status !== 402) {
    log(`✨ Success (No payment needed)! Status: ${response.status}`);
    log(await response.text(), true);
    return;
  }

  log('🔒 402 Payment Required');
  const reqHeader = response.headers.get('PAYMENT-REQUIRED');
  if (!reqHeader) {
    console.error('❌ Error: Server returned 402 but missing PAYMENT-REQUIRED header');
    process.exit(1);
  }

  logHeaders('response', { 'PAYMENT-REQUIRED': reqHeader });
  logDebug('PAYMENT-REQUIRED decoded:', decodeBase64(reqHeader));

  const paymentRequired = decodePaymentRequired(reqHeader);
  log(`📦 Resource: ${paymentRequired.resource.url} (${paymentRequired.resource.description || 'no desc'})`, true);

  // Filter based on -t preference
  let requirements: PaymentRequirements | undefined;
  if (type === 'session') {
    requirements = paymentRequired.accepts.find(r => r.extra.nanoSession);
  } else if (type === 'signature') {
    requirements = paymentRequired.accepts.find(r => r.extra.nanoSignature);
  } else {
    // Default to session if available, else signature
    requirements = paymentRequired.accepts.find(r => r.extra.nanoSession) || paymentRequired.accepts[0];
  }

  if (!requirements) {
    console.error(`❌ Error: No matching requirements found for type "${type || 'default'}"`);
    console.error('   Supported by server:', paymentRequired.accepts.map(r => r.extra.nanoSession ? 'session' : 'signature').join(', '));
    process.exit(1);
  }

  log(`💳 Payment Track: ${requirements.extra.nanoSignature ? 'nanoSignature' : 'nanoSession'}`);
  log(`   Amount: ${requirements.amount} raw`);
  log(`   Pay To: ${requirements.payTo}`, true);

  // Phase 2: Handle Payment
  log('💰 Creating and broadcasting payment...');
  const execers = await paymentHandler.handle({ url }, [requirements]);
  if (execers.length === 0) {
    console.error('❌ Error: Payment handler failed to produce executor');
    process.exit(1);
  }

  const { payload } = await execers[0].exec() as { payload: PaymentPayload };
  log(`✅ Payment successful! Block: ${payload.payload.proof}`);
  if (payload.payload.signature) {
    log(`🔏 Proof Signature: ${payload.payload.signature.slice(0, 16)}...`, true);
  }

  // Phase 3: Retry with Signature
  log('🔄 Retrying with payment proof...');
  const signatureHeader = encodePaymentSignature(payload);

  logHeaders('request', { 'PAYMENT-SIGNATURE': signatureHeader });
  logDebug('PAYMENT-SIGNATURE decoded:', decodeBase64(signatureHeader));

  const finalResponse = await fetch(url!, {
    headers: {
      'PAYMENT-SIGNATURE': signatureHeader
    }
  });

  if (finalResponse.ok) {
    log('✨ Request fulfilled!');
    const contentType = finalResponse.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      console.log(JSON.stringify(await finalResponse.json(), null, 2));
    } else {
      console.log(await finalResponse.text());
    }
  } else {
    console.error(`❌ Final request failed! Status: ${finalResponse.status}`);
    console.error(await finalResponse.text());
    process.exit(1);
  }
}

run().catch(err => {
  if (err instanceof Error && err.message.includes('Insufficient balance')) {
    console.error(`\n❌ Error: ${err.message}`);
    console.error('💡 Tip: Please fund the account shown above to proceed with the payment.');
  } else if (isConnectionRefused(err)) {
    console.error(`\n❌ Error: Connection refused`);
    console.error(`💡 Tip: Could not connect to ${url}. Is the server running?`);
  } else {
    console.error('💥 Unexpected Error:', err);
  }
  process.exit(1);
});

/**
 * Detects connection refused errors from fetch failures.
 * Node.js fetch throws TypeError with cause AggregateError containing ECONNREFUSED.
 */
function isConnectionRefused(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  if (err.message !== 'fetch failed') return false;
  // Check for ECONNREFUSED in the cause chain
  const cause = (err as any).cause;
  if (cause && typeof cause === 'object') {
    // Check code property on the cause or its errors array
    if (cause.code === 'ECONNREFUSED') return true;
    if (Array.isArray(cause.errors)) {
      return cause.errors.some((e: any) => e?.code === 'ECONNREFUSED');
    }
    // Fallback: check stringified cause for ECONNREFUSED
    const causeStr = String(cause);
    if (causeStr.includes('ECONNREFUSED')) return true;
    // Check stack trace if available
    const stack = cause.stack || '';
    if (stack.includes('ECONNREFUSED')) return true;
  }
  return false;
}
