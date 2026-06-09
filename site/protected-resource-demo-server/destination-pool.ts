import { deriveAddress, derivePublicKey, deriveSecretKey } from 'nanocurrency';

const DEFAULT_POOL_SIZE = 8;
const DEFAULT_START_INDEX = 1;

// In-memory set of deposits currently reserved by an active demo checkout session.
// A deposit stays reserved until explicitly released (via Restart) or the session is settled
// and the caller decides to release it. This supports "stable until paid" + per-invoice semantics.
const reservedDeposits = new Set<string>();

// Legacy cycling offset (only used by the old getNextDemoDestination path).
let nextOffset = 0;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function deriveAddressFromSeed(seed: string, index: number): string {
  const secretKey = deriveSecretKey(seed, index);
  const publicKey = derivePublicKey(secretKey);
  return deriveAddress(publicKey, { useNanoPrefix: true });
}

export function resetDemoDestinationPoolForTests() {
  reservedDeposits.clear();
  nextOffset = 0;
}

/**
 * Legacy helper – kept for the old /api/protected route and existing tests during transition.
 * New Rev 8 track flows should use allocatePerInvoiceDeposit + reserve/release.
 *
 * This preserves the original small cycling pool behavior so the legacy demo and its tests
 * continue to work unchanged while we build out the new per-track stable flows.
 */
export function getNextDemoDestination(): string {
  const seed = process.env.NANO_TEST_SEED;
  if (!seed) {
    if (!process.env.NANO_SERVER_ADDRESS) {
      throw new Error('NANO_SERVER_ADDRESS environment variable is not set');
    }
    return process.env.NANO_SERVER_ADDRESS;
  }

  const poolSize = parsePositiveInt(process.env.NANO_DEMO_ADDRESS_POOL_SIZE, DEFAULT_POOL_SIZE);
  const startIndex = parsePositiveInt(process.env.NANO_DEMO_ADDRESS_START_INDEX, DEFAULT_START_INDEX);
  const index = startIndex + (nextOffset % poolSize);
  nextOffset += 1;
  const addr = deriveAddressFromSeed(seed, index);
  reservedDeposits.add(addr); // also mark it reserved so the new allocator sees it
  return addr;
}

/**
 * Allocate a fresh per-invoice deposit address that is not currently reserved by an active
 * demo session. Uses deterministic derivation from NANO_TEST_SEED when present.
 *
 * The returned address is immediately marked as reserved.
 */
export function allocatePerInvoiceDeposit(): string {
  const seed = process.env.NANO_TEST_SEED;
  if (!seed) {
    if (!process.env.NANO_SERVER_ADDRESS) {
      throw new Error('NANO_SERVER_ADDRESS environment variable is not set');
    }
    // When no seed, we have only one address; still "reserve" it conceptually.
    const fixed = process.env.NANO_SERVER_ADDRESS;
    reservedDeposits.add(fixed);
    return fixed;
  }

  const poolSize = parsePositiveInt(process.env.NANO_DEMO_ADDRESS_POOL_SIZE, DEFAULT_POOL_SIZE);
  const startIndex = parsePositiveInt(process.env.NANO_DEMO_ADDRESS_START_INDEX, DEFAULT_START_INDEX);

  // Search for an unused index (simple linear probe; fine for demo scale).
  for (let probe = 0; probe < poolSize * 4; probe++) { // generous bound
    const index = startIndex + (probe % (poolSize * 4));
    const candidate = deriveAddressFromSeed(seed, index);
    if (!reservedDeposits.has(candidate)) {
      reservedDeposits.add(candidate);
      return candidate;
    }
  }

  // Fallback (extremely unlikely): return a derived one even if it was "reserved"
  // (the caller can still use it; the set is best-effort for the demo).
  const fallbackIndex = startIndex + (Date.now() % (poolSize * 10));
  const fallback = deriveAddressFromSeed(seed, fallbackIndex);
  reservedDeposits.add(fallback);
  return fallback;
}

/**
 * Reserve a specific deposit (e.g. when resuming a stable session from ?deposit=... in the URL).
 * Returns true if it was successfully reserved (or already reserved by this session).
 */
export function reserveDeposit(deposit: string): boolean {
  // For the fixed-address fallback we allow "reserving" the same one.
  reservedDeposits.add(deposit);
  return true;
}

/**
 * Release a deposit so it can be reused by a future checkout session.
 * Called on explicit "Restart session" (big red button).
 */
export function releaseDeposit(deposit: string) {
  reservedDeposits.delete(deposit);
}

/** Test helper to inspect current reservations. */
export function __getReservedDepositsForTests(): Set<string> {
  return new Set(reservedDeposits);
}
