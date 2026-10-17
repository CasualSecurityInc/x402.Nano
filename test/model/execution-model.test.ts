import { describe, expect, it } from 'vitest';

import type { Intent } from './model.js';
import { AccountWriter, compare, digest, fixture, invoiceDigest, Seller, Store, Wallet } from './model.js';

describe('one logical wallet, ten concurrent HTTP purchases', () => {
  it('exposes frontier collisions in both uncoordinated tracks and completes both coordinated variants', async () => {
    expect((await compare()).map(row => row.completed)).toEqual([1, 1, 10, 10]);
  });

  it('per-hash facilitator locks do not serialize distinct sends from the same account', async () => {
    const { ledger, invoices } = fixture();
    const blocks = invoices.map(invoice => ledger.prepare(invoice));
    const locks = new Map(blocks.map(block => [block.hash, new AccountWriter()]));
    const outcomes = await Promise.allSettled(blocks.map(block => locks.get(block.hash)!.run(async () => {
      ledger.verify(block);
      await Promise.resolve();
      return ledger.process(block);
    })));
    expect(locks.size).toBe(10);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
  });

  it('rejects a prepared block after an intervening receive', () => {
    const { ledger, invoices } = fixture(1);
    const block = ledger.prepare(invoices[0]);
    ledger.verify(block);
    ledger.receive();
    expect(() => ledger.process(block)).toThrow('STALE_FRONTIER');
  });

  it('releases the account while all ten seller requests are still awaiting fulfillment', async () => {
    const { wallet, store, invoices, sellers, ledger } = fixture();
    let release!: () => void;
    const fulfillmentGate = new Promise<void>(resolve => { release = resolve; });
    const paid: Promise<void>[] = [];
    const requests = invoices.map((invoice, index) => {
      const payment = wallet.send(invoice).then(async hash => {
        await sellers[index].settle(wallet.proof(invoice, hash));
      });
      paid.push(payment);
      return payment.then(async () => {
        await fulfillmentGate;
        return store.fulfill(invoice);
      });
    });
    await Promise.all(paid);
    expect(ledger.blocks.size).toBe(10);
    expect(store.fulfillmentStarts).toBe(0);
    release();
    expect(new Set(await Promise.all(requests)).size).toBe(10);
    expect(store.fulfillmentStarts).toBe(10);
  });

  it('requires separate wallet instances to share a writer and intent journal', async () => {
    const { ledger, wallet, invoices } = fixture();
    const writer = new AccountWriter();
    const journal = new Map<string, Intent>();
    const processes = Array.from({ length: 10 }, () => new Wallet(ledger, wallet.identities, writer, journal));
    await Promise.all(invoices.map((invoice, index) => processes[index].send(invoice)));
    expect(ledger.blocks.size).toBe(10);
  });

  it('sharing keys without a shared writer still collides', async () => {
    const { ledger, wallet, invoices } = fixture();
    const processes = invoices.map(() => new Wallet(ledger, wallet.identities));
    const outcomes = await Promise.allSettled(invoices.map((invoice, index) => processes[index].send(invoice)));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
  });

  it('orders a receive with sends through the same writer', async () => {
    const { wallet, ledger, invoices } = fixture();
    await Promise.all([
      wallet.send(invoices[0]),
      wallet.writer.run(async () => { ledger.receive(); }),
      ...invoices.slice(1).map(invoice => wallet.send(invoice)),
    ]);
    expect(ledger.blocks.size).toBe(10);
    expect(ledger.balance).toBe(91n);
  });

  it('resolves a lost process reply after wallet restart without another payment', async () => {
    const { wallet, ledger, invoices } = fixture(1);
    await expect(wallet.send(invoices[0], true)).rejects.toThrow('LOST_PROCESS_REPLY');
    const restoredJournal = structuredClone(wallet.journal);
    const restarted = new Wallet(ledger, wallet.identities, new AccountWriter(), restoredJournal);
    const hash = await restarted.send(invoices[0]);
    expect(ledger.blocks.has(hash)).toBe(true);
    expect(ledger.processCalls).toBe(1);
  });

  it('makes concurrent retries of one wallet operation return the same block', async () => {
    const { wallet, ledger, invoices } = fixture(1);
    const hashes = await Promise.all(Array.from({ length: 10 }, () => wallet.send(invoices[0])));
    expect(new Set(hashes).size).toBe(1);
    expect(ledger.processCalls).toBe(1);
    await expect(wallet.send({ ...invoices[0], amount: 2n })).rejects.toThrow('OPERATION_CHANGED');
  });
});

describe('purchase attribution, durable consumption, and recovery', () => {
  it('does not consume payment during verification and settles across ten workers once', async () => {
    const { wallet, ledger, store, invoices } = fixture(1);
    const invoice = invoices[0];
    const proof = wallet.proof(invoice, await wallet.send(invoice));
    const workers = Array.from({ length: 10 }, () => new Seller(invoice.audience, store, ledger));
    workers.forEach(worker => worker.verify(proof));
    expect(store.settlements.size).toBe(0);
    const results = await Promise.all(workers.map(worker => worker.settle(proof)));
    expect(new Set(results.map(result => result.blockHash)).size).toBe(1);
    expect(store.settlements.size).toBe(1);
    expect(new Set(results.map(() => store.fulfill(invoice))).size).toBe(1);
    expect(store.fulfillmentStarts).toBe(1);
  });

  it('preserves purchase/result attribution when sellers redeem in reverse payment order', async () => {
    const { wallet, store, invoices, sellers } = fixture();
    const hashes = await Promise.all(invoices.map(invoice => wallet.send(invoice)));
    for (let index = invoices.length - 1; index >= 0; index--) {
      const invoice = invoices[index];
      const result = await sellers[index].settle(wallet.proof(invoice, hashes[index]));
      expect(result.invoiceDigest).toBe(invoiceDigest(invoice));
      expect(store.fulfill(invoice)).toBe(digest(['result', invoiceDigest(invoice)]));
    }
    expect(store.fulfillmentStarts).toBe(10);
  });

  it('rejects a fresh sender signature assigning payment to another equal-price invoice', async () => {
    const { wallet, invoices, sellers } = fixture(2);
    const hash = await wallet.send(invoices[0]);
    await expect(sellers[1].settle(wallet.proof(invoices[1], hash))).rejects.toThrow('WRONG_PAYMENT');
  });

  it('rejects receipt theft by a different signer', async () => {
    const { wallet, invoices, sellers } = fixture(1);
    const hash = await wallet.send(invoices[0]);
    const stolen = wallet.proof(invoices[0], hash, 'attacker');
    await expect(sellers[0].settle(stolen)).rejects.toThrow('WRONG_PAYER');
    await expect(sellers[0].settle({ ...stolen, account: 'payer' })).rejects.toThrow('INVALID_SIGNATURE');
  });

  it('binds actual method, target, and body digest, even when price is unchanged', async () => {
    const { wallet, invoices, sellers } = fixture(1);
    const proof = wallet.proof(invoices[0], await wallet.send(invoices[0]));
    await expect(sellers[0].settle(proof, digest(['POST', '/different', 'different-body']))).rejects.toThrow('WRONG_RESOURCE');
    const forged = { ...invoices[0], requestDigest: 'forged' };
    await expect(sellers[0].settle(wallet.proof(forged, proof.blockHash))).rejects.toThrow('UNISSUED_INVOICE');
  });

  it('rejects caller-forged issuance, deadline extension, and audience changes', async () => {
    const { wallet, invoices, sellers } = fixture(1);
    const hash = await wallet.send(invoices[0]);
    for (const changed of [
      { ...invoices[0], id: 'unissued' },
      { ...invoices[0], validBefore: 999 },
      { ...invoices[0], audience: 'https://other.example' },
    ]) {
      await expect(sellers[0].settle(wallet.proof(changed, hash))).rejects.toThrow('UNISSUED_INVOICE');
    }
  });

  it('replays a recorded settlement after lost HTTP success, restart, and expiry without a second job', async () => {
    const { wallet, ledger, store, invoices, sellers } = fixture(1);
    const invoice = invoices[0];
    const proof = wallet.proof(invoice, await wallet.send(invoice));
    const original = await sellers[0].settle(proof);
    const result = store.fulfill(invoice); // Simulate completed work whose HTTP reply was lost.
    const restored = Store.restore(store.snapshot());
    restored.now = 999;
    const worker = new Seller(invoice.audience, restored, ledger);
    expect(await worker.settle(proof)).toEqual(original);
    expect(restored.fulfill(invoice)).toBe(result);
    expect(restored.fulfillmentStarts).toBe(0);
  });

  it('admits just before expiry, rejects at and after it, and rechecks time inside commit', async () => {
    for (const now of [199, 200, 201]) {
      const { wallet, store, invoices, sellers } = fixture(1);
      const proof = wallet.proof(invoices[0], await wallet.send(invoices[0]));
      store.now = now;
      if (now < 200) await expect(sellers[0].settle(proof)).resolves.toHaveProperty('blockHash');
      else {
        await expect(sellers[0].settle(proof)).rejects.toThrow('EXPIRED_RECOVERY_REQUIRED');
        expect(store.recoveries.has(invoiceDigest(invoices[0]))).toBe(true);
        expect(store.fulfillmentStarts).toBe(0);
      }
    }
    const { wallet, store, invoices, sellers } = fixture(1);
    const proof = wallet.proof(invoices[0], await wallet.send(invoices[0]));
    store.now = 199;
    await expect(sellers[0].settle(proof, undefined, () => { store.now = 200; })).rejects.toThrow('EXPIRED_RECOVERY_REQUIRED');
    expect(store.settlements.size).toBe(0);
  });

  it('a signature still verifies after expiry but cannot admit a new redemption', async () => {
    const { wallet, store, invoices, sellers } = fixture(1);
    const proof = wallet.proof(invoices[0], await wallet.send(invoices[0]));
    store.now = 201;
    const message = `x402.Nano/nanoSignature/2:${invoiceDigest(invoices[0])}:${proof.blockHash}`;
    expect(wallet.identities.verify(proof.account, message, proof.signature)).toBe(true);
    await expect(sellers[0].settle(proof)).rejects.toThrow('EXPIRED_RECOVERY_REQUIRED');
  });

  it('rejects old payment re-signing for a new invoice after restart and the old deadline', async () => {
    const { wallet, ledger, store, invoices, sellers } = fixture(1);
    const hash = await wallet.send(invoices[0]);
    await sellers[0].settle(wallet.proof(invoices[0], hash));
    const restored = Store.restore(store.snapshot());
    restored.now = 300;
    const fresh = { ...invoices[0], id: 'fresh', destination: 'new-invoice-address', issuedAt: 300, validBefore: 400 };
    restored.issue(fresh);
    const worker = new Seller(fresh.audience, restored, ledger);
    await expect(worker.settle(wallet.proof(fresh, hash))).rejects.toThrow('WRONG_PAYMENT');
    expect(() => restored.issue({ ...fresh, id: 'another', destination: invoices[0].destination })).toThrow('ISSUANCE_CONFLICT');
  });

  it('the transactional store independently rejects conflicting invoice/hash associations', () => {
    const { store, invoices } = fixture(2);
    store.commit(invoices[0], 'one-payment');
    expect(() => store.commit(invoices[1], 'one-payment')).toThrow('PAYMENT_ALREADY_CONSUMED');
    expect(() => store.commit(invoices[0], 'another-payment')).toThrow('INVOICE_ALREADY_PAID');
  });

  it('rejects an unknown send, incorrect amount, or damaged model signature', async () => {
    const { wallet, ledger, invoices, sellers } = fixture(1);
    await expect(sellers[0].settle(wallet.proof(invoices[0], 'not-confirmed'))).rejects.toThrow('UNCONFIRMED_PAYMENT');
    const damaged = ledger.prepare(invoices[0]);
    expect(() => ledger.process({ ...damaged, signature: 'invalid' })).toThrow('INVALID_SIGNATURE');
    const hash = await wallet.send(invoices[0]);
    ledger.blocks.get(hash)!.amount = 2n; // Simulate untrusted RPC evidence failing invoice checks.
    await expect(sellers[0].settle(wallet.proof(invoices[0], hash))).rejects.toThrow('WRONG_PAYMENT');
  });
});
