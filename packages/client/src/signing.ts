import { deriveSecretKey, derivePublicKey, hashBlock, signBlock as nanoSignBlock } from 'nanocurrency';
import { deriveAddressFromSeed } from '@nanosession/core';
import { NOMS } from '@openrai/nano-core';

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * Derive a keypair from a Nano seed and account index.
 * Uses Nano's seed+index model.
 *
 * @param seed - 64-character hex seed
 * @param index - Account index (0 = first account, 1 = second, etc.)
 * @returns KeyPair with publicKey and secretKey as Uint8Arrays
 */
export function deriveKeyPair(seed: string, index: number = 0): KeyPair {
  const secretKeyHex = deriveSecretKey(seed, index);
  const publicKeyHex = derivePublicKey(secretKeyHex);

  return {
    secretKey: Buffer.from(secretKeyHex, 'hex'),
    publicKey: Buffer.from(publicKeyHex, 'hex')
  };
}

export { deriveAddressFromSeed } from '@nanosession/core';

/**
 * Parameters for creating a Nano state block (Send subtype)
 */
export interface SendBlockParams {
  /** The Nano account address creating the block */
  account: string;
  /** The hash of the previous block in the account chain */
  previous: string;
  /** The representative address for the account */
  representative: string;
  /** The remaining balance after the transaction (in raw) */
  balance: string;
  /** The destination account address (link field) */
  link: string;
}

/**
 * A block that has been signed and is ready for broadcast
 */
export interface SignedBlock extends SendBlockParams {
  /** The cryptographic signature of the block hash */
  signature: string;
  /** The proof-of-work for the block */
  work: string;
}

/**
 * Creates a Send block object from parameters.
 */
export function createSendBlock(params: SendBlockParams): SendBlockParams {
  return params;
}

/**
 * Signs a Nano block using the provided secret key.
 * Uses the canonical Nano block hashing + Ed25519.
 */
export function signBlock(block: SendBlockParams, secretKey: Uint8Array): string {
  const blockHash = hashBlock({
    account: block.account,
    previous: block.previous,
    representative: block.representative,
    balance: block.balance,
    link: block.link,
  });
  return nanoSignBlock({
    hash: blockHash,
    secretKey: Buffer.from(secretKey).toString('hex'),
  });
}

/**
 * Signs an off-chain message using canonical NOMS (ORIS-001) from @openrai/nano-core.
 *
 * This is the correct implementation for Track B (nanoSignature).
 * The message (e.g. "<blockHash>:<nonce>:<validBefore>") is wrapped with the
 * NOMS payload format before hashing and signing.
 *
 * @param message The UTF-8 string message to sign.
 * @param secretKeyHex The 64-character hex secret key (32 bytes).
 * @returns The 128-character hex signature.
 */
export function signMessage(message: string, secretKeyHex: string): string {
  return NOMS.signMessage(message, secretKeyHex);
}

/**
 * Verifies a NOMS signature using the canonical implementation.
 * Useful for tests and client-side validation.
 */
export function verifyMessage(message: string, signature: string, publicKeyHex: string): boolean {
  return NOMS.verifyMessage(message, signature, publicKeyHex);
}
