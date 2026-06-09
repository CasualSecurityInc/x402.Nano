import * as dotenv from 'dotenv';
import { deriveAddressFromSeed } from '@nanosession/client';
import { deriveSecretKey, createBlock, signBlock, type BlockData } from 'nanocurrency';
import { generateWork as generateWorkRsp, WorkType } from 'nano-rspow-node';
import { NanoRpcClient } from '@nanosession/rpc';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '../.env' });

const seed = process.env.NANO_SEED;
const rpcUrlStr = process.env.NANO_RPC_URL || 'https://rpc.nano-gpt.com';
const toAddress = process.argv[2];
const amountRaw = process.argv[3];

if (!seed || !toAddress || !amountRaw) {
    console.error('Usage: NANO_SEED=<seed> tsx test-payment.ts <toAddress> <amountRaw>');
    process.exit(1);
}

const rpcClient = new NanoRpcClient({ endpoints: [rpcUrlStr] });

async function run() {
    console.log(`📡 Connecting to RPC: ${rpcUrlStr}`);
    const clientAddress = deriveAddressFromSeed(seed!, 0);
    const clientSecretKey = deriveSecretKey(seed!, 0);

    console.log(`🏦 Sender address: ${clientAddress}`);
    console.log(`🎯 Target address: ${toAddress}`);
    console.log(`💰 Amount (RAW):   ${amountRaw}`);

    const accountInfo = await rpcClient.getAccountInfo(clientAddress);

    if (!accountInfo) {
        console.error('❌ Sender account not found on network or has 0 balance.');
        process.exit(1);
    }

    const newBalance = BigInt(accountInfo.balance) - BigInt(amountRaw);
    if (newBalance < 0n) {
        console.error('❌ Insufficient balance.');
        process.exit(1);
    }

    console.log(`⚙️  Generating PoW for frontier ${accountInfo.frontier}... (via nano-rspow-node exclusively)`);
    const work = await generateWorkRsp(accountInfo.frontier, WorkType.Send);

    if (!work) {
        console.error('❌ Work generation failed');
        process.exit(1);
    }

    const blockData: BlockData = {
        work: work,
        balance: newBalance.toString(),
        representative: accountInfo.representative,
        previous: accountInfo.frontier,
        link: toAddress
    };

    console.log(`✍️  Signing block...`);
    const block = createBlock(clientSecretKey, blockData);
    const signature = signBlock({ hash: block.hash, secretKey: clientSecretKey });

    console.log(`🚀 Broadcasting to network...`);

    const processResponse = await fetch(rpcUrlStr, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'process',
            json_block: true,
            block: {
                ...block.block,
                signature: signature
            }
        })
    });

    const result = await processResponse.json();
    if (result.hash) {
        console.log(`✅ Success! Block Hash: ${result.hash}`);
    } else {
        console.error(`❌ Failed to process block:`, result);
    }
}

run().catch(console.error);
