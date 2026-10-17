/** Deterministic protocol model. No real Nano/NOMS cryptography, RPC, or funds. */
import { createHash } from 'node:crypto';

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface Invoice {
  id: string;
  profile: 'nanoTxn/1' | 'nanoSignature/2';
  audience: string;
  payer: string;
  destination: string;
  amount: bigint;
  requestDigest: string;
  issuedAt: number;
  validBefore: number;
}

export function invoiceDigest(invoice: Invoice): string {
  return digest([
    'x402.Nano/invoice/1', invoice.profile, invoice.id, invoice.audience,
    'nano:mainnet', 'XNO', invoice.payer, invoice.destination, invoice.amount.toString(),
    invoice.requestDigest, invoice.issuedAt, invoice.validBefore,
  ]);
}

export interface Block {
  hash: string;
  account: string;
  previous: string;
  balance: bigint;
  destination: string;
  amount: bigint;
  signature: string;
}

export interface Proof {
  invoice: Invoice;
  blockHash: string;
  account: string;
  signature: string;
}

/** Simulated identity oracle, deliberately not Nano signing or NOMS. */
export class Identities {
  private readonly keys = new Map<string, string>();

  register(account: string): void {
    this.keys.set(account, `model-secret:${account}`);
  }

  sign(account: string, message: string): string {
    const key = this.keys.get(account);
    if (!key) throw new Error('UNKNOWN_SIGNER');
    return digest([key, message]);
  }

  verify(account: string, message: string, signature: string): boolean {
    return this.keys.has(account) && this.sign(account, message) === signature;
  }
}

function blockDigest(block: Omit<Block, 'hash' | 'signature'>): string {
  return digest([block.account, block.previous, block.balance.toString(), block.destination, block.amount.toString()]);
}

export class Ledger {
  frontier = 'genesis';
  balance = 100n;
  readonly blocks = new Map<string, Block>();
  processCalls = 0;

  constructor(readonly payer: string, readonly identities: Identities) {}

  prepare(invoice: Invoice): Block {
    if (this.balance < invoice.amount) throw new Error('INSUFFICIENT_FUNDS');
    const fields = {
      account: this.payer, previous: this.frontier,
      balance: this.balance - invoice.amount, destination: invoice.destination, amount: invoice.amount,
    };
    const hash = blockDigest(fields);
    return { ...fields, hash, signature: this.identities.sign(this.payer, hash) };
  }

  verify(block: Block): void {
    if (block.hash !== blockDigest(block)
      || !this.identities.verify(block.account, block.hash, block.signature)) throw new Error('INVALID_SIGNATURE');
    if (block.account !== this.payer) throw new Error('WRONG_PAYER');
    if (block.previous !== this.frontier) throw new Error('STALE_FRONTIER');
    if (this.balance - block.balance !== block.amount || block.amount <= 0n) throw new Error('INVALID_AMOUNT');
  }

  process(block: Block): string {
    this.processCalls++;
    this.verify(block);
    this.blocks.set(block.hash, { ...block });
    this.frontier = block.hash;
    this.balance = block.balance;
    // Acceptance and confirmation coincide in this model, not in real Nano RPC.
    return block.hash;
  }

  receive(): void {
    this.frontier = digest([this.frontier, 'receive']);
    this.balance += 1n;
  }
}

/** All simulated processes must share this account writer, not merely signing keys. */
export class AccountWriter {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export interface Intent {
  invoiceDigest: string;
  block: Block;
}

export class Wallet {
  constructor(
    readonly ledger: Ledger,
    readonly identities: Identities,
    readonly writer = new AccountWriter(),
    readonly journal = new Map<string, Intent>(),
  ) {}

  send(invoice: Invoice, crashAfterBroadcast = false): Promise<string> {
    return this.writer.run(async () => {
      let intent = this.journal.get(invoice.id);
      if (intent && intent.invoiceDigest !== invoiceDigest(invoice)) throw new Error('OPERATION_CHANGED');
      if (!intent) {
        intent = { invoiceDigest: invoiceDigest(invoice), block: this.ledger.prepare(invoice) };
        this.journal.set(invoice.id, intent); // Model of durable intent before broadcast.
      }
      if (this.ledger.blocks.has(intent.block.hash)) return intent.block.hash;
      await Promise.resolve(); // Another HTTP caller can enter while the writer is held.
      const hash = this.ledger.process(intent.block);
      if (crashAfterBroadcast) throw new Error('LOST_PROCESS_REPLY');
      return hash;
    });
  }

  proof(invoice: Invoice, blockHash: string, account = this.ledger.payer): Proof {
    const message = `x402.Nano/nanoSignature/2:${invoiceDigest(invoice)}:${blockHash}`;
    return { invoice, blockHash, account, signature: this.identities.sign(account, message) };
  }
}

interface Settlement {
  invoiceDigest: string;
  blockHash: string;
}

export interface StoreSnapshot {
  invoices: Invoice[];
  destinations: string[];
  settlements: Settlement[];
  recoveries: string[];
  fulfilled: string[];
}

/** One atomic store authority shared by workers. Not a production database adapter. */
export class Store {
  readonly invoices = new Map<string, Invoice>();
  readonly destinations = new Set<string>();
  readonly settlements = new Map<string, Settlement>();
  readonly consumed = new Map<string, string>();
  readonly recoveries = new Set<string>();
  readonly fulfilled = new Set<string>();
  now = 100;
  fulfillmentStarts = 0;

  issue(invoice: Invoice): void {
    if (this.invoices.has(invoice.id) || this.destinations.has(invoice.destination)) throw new Error('ISSUANCE_CONFLICT');
    this.invoices.set(invoice.id, { ...invoice });
    this.destinations.add(invoice.destination);
  }

  commit(invoice: Invoice, blockHash: string): Settlement {
    // Synchronous critical section models a serializable store transaction.
    const key = invoiceDigest(invoice);
    const prior = this.settlements.get(key);
    if (prior) {
      if (prior.blockHash !== blockHash) throw new Error('INVOICE_ALREADY_PAID');
      return { ...prior };
    }
    if (this.consumed.has(blockHash)) throw new Error('PAYMENT_ALREADY_CONSUMED');
    if (this.now >= invoice.validBefore) {
      this.recoveries.add(key);
      throw new Error('EXPIRED_RECOVERY_REQUIRED');
    }
    const settlement = { invoiceDigest: key, blockHash };
    this.settlements.set(key, settlement);
    this.consumed.set(blockHash, key);
    return { ...settlement };
  }

  fulfill(invoice: Invoice): string {
    const key = invoiceDigest(invoice);
    if (!this.settlements.has(key)) throw new Error('NOT_SETTLED');
    if (!this.fulfilled.has(key)) {
      this.fulfilled.add(key);
      this.fulfillmentStarts++;
    }
    // Atomic, deterministic work in this model; not arbitrary external side effects.
    return digest(['result', key]);
  }

  snapshot(): StoreSnapshot {
    return structuredClone({
      invoices: [...this.invoices.values()], destinations: [...this.destinations],
      settlements: [...this.settlements.values()], recoveries: [...this.recoveries], fulfilled: [...this.fulfilled],
    });
  }

  static restore(snapshot: StoreSnapshot): Store {
    const store = new Store();
    for (const invoice of snapshot.invoices) store.invoices.set(invoice.id, { ...invoice });
    for (const destination of snapshot.destinations) store.destinations.add(destination);
    for (const settlement of snapshot.settlements) {
      store.settlements.set(settlement.invoiceDigest, { ...settlement });
      store.consumed.set(settlement.blockHash, settlement.invoiceDigest);
    }
    for (const recovery of snapshot.recoveries) store.recoveries.add(recovery);
    for (const key of snapshot.fulfilled) store.fulfilled.add(key);
    return store;
  }
}

export class Seller {
  constructor(readonly audience: string, readonly store: Store, readonly ledger: Ledger) {}

  verify(proof: Proof, requestDigest = proof.invoice.requestDigest): void {
    const { invoice, blockHash, account, signature } = proof;
    const issued = this.store.invoices.get(invoice.id);
    if (!issued || invoiceDigest(issued) !== invoiceDigest(invoice)) throw new Error('UNISSUED_INVOICE');
    if (invoice.audience !== this.audience || invoice.requestDigest !== requestDigest) throw new Error('WRONG_RESOURCE');
    if (invoice.profile !== 'nanoSignature/2') throw new Error('UNSUPPORTED_PROFILE');
    if (account !== invoice.payer) throw new Error('WRONG_PAYER');
    const message = `x402.Nano/nanoSignature/2:${invoiceDigest(invoice)}:${blockHash}`;
    if (!this.ledger.identities.verify(account, message, signature)) throw new Error('INVALID_SIGNATURE');
    const block = this.ledger.blocks.get(blockHash);
    if (!block) throw new Error('UNCONFIRMED_PAYMENT');
    if (block.account !== account || block.destination !== invoice.destination || block.amount !== invoice.amount) {
      throw new Error('WRONG_PAYMENT');
    }
    if (!this.store.settlements.has(invoiceDigest(invoice)) && this.store.now >= invoice.validBefore) {
      this.store.recoveries.add(invoiceDigest(invoice));
      throw new Error('EXPIRED_RECOVERY_REQUIRED');
    }
  }

  async settle(proof: Proof, requestDigest = proof.invoice.requestDigest, beforeCommit?: () => void): Promise<Settlement> {
    this.verify(proof, requestDigest);
    await Promise.resolve(); // All workers can pass verify before any commit.
    beforeCommit?.();
    return this.store.commit(proof.invoice, proof.blockHash);
  }
}

export function fixture(count = 10, profile: Invoice['profile'] = 'nanoSignature/2'): {
  ledger: Ledger; wallet: Wallet; store: Store; invoices: Invoice[]; sellers: Seller[];
} {
  const identities = new Identities();
  identities.register('payer');
  identities.register('attacker');
  const ledger = new Ledger('payer', identities);
  const wallet = new Wallet(ledger, identities);
  const store = new Store();
  const invoices = Array.from({ length: count }, (_, index): Invoice => ({
    id: digest(['invoice', index]), profile, audience: `https://seller-${index}.example`,
    payer: 'payer', destination: `invoice-address-${index}`, amount: 1n,
    requestDigest: digest(['GET', `https://seller-${index}.example/research`, digest('')]),
    issuedAt: 100, validBefore: 200,
  }));
  for (const invoice of invoices) store.issue(invoice);
  return { ledger, wallet, store, invoices, sellers: invoices.map(invoice => new Seller(invoice.audience, store, ledger)) };
}

export async function compare(): Promise<Array<{ scenario: string; completed: number; requests: number }>> {
  const rows = [];
  for (const scenario of ['Track A without coordination', 'Track B without coordination']) {
    const { ledger, invoices } = fixture();
    const blocks = invoices.map(invoice => ledger.prepare(invoice));
    blocks.forEach(block => ledger.verify(block)); // Every verify succeeds at the same frontier.
    const outcomes = await Promise.allSettled(blocks.map(async block => ledger.process(block)));
    rows.push({ scenario, completed: outcomes.filter(outcome => outcome.status === 'fulfilled').length, requests: blocks.length });
  }
  for (const scenario of ['Track A with wallet coordination', 'Track B with wallet coordination']) {
    const { wallet, invoices, sellers, store } = fixture(10, scenario.startsWith('Track A') ? 'nanoTxn/1' : 'nanoSignature/2');
    const outcomes = await Promise.allSettled(invoices.map(async (invoice, index) => {
      if (scenario.startsWith('Track A')) {
        // Wallet holds its writer across simulated remote submission and confirmation.
        await wallet.writer.run(async () => {
          const block = wallet.ledger.prepare(invoice);
          wallet.ledger.verify(block);
          await Promise.resolve();
          wallet.ledger.process(block);
          store.commit(invoice, block.hash);
        });
      } else {
        const hash = await wallet.send(invoice);
        await sellers[index].settle(wallet.proof(invoice, hash));
      }
      return store.fulfill(invoice);
    }));
    rows.push({ scenario, completed: outcomes.filter(outcome => outcome.status === 'fulfilled').length, requests: invoices.length });
  }
  return rows;
}
