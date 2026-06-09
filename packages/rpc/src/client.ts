import type { BlockInfo, AccountInfo, AccountHistoryEntry } from './types.js';
import debug from 'debug';

const log = debug('nanosession:rpc');
const logCalls = debug('nanosession:rpc:calls');

export interface NanoRpcClientOptions {
  /** RPC endpoint URLs to try in order (query params will be merged into each RPC request body) */
  endpoints: string[];
  /** Maximum retries per endpoint */
  maxRetries?: number;
  /** Initial retry delay in ms (doubles each retry) */
  retryDelayMs?: number;
  /** Request timeout in ms */
  timeoutMs?: number;
}

/**
 * Parsed RPC endpoint with extracted query parameters.
 * URL query params are merged into each RPC request body as a convention.
 */
interface ParsedEndpoint {
  /** Base URL without query string */
  baseUrl: string;
  /** Query parameters extracted from URL to merge into RPC body */
  extraParams: Record<string, string>;
}

/**
 * A highly resilient Nano RPC client with multi-endpoint failover and exponential backoff retry.
 * Implements a subset of the Nano RPC protocol required for x402 support.
 */
export class NanoRpcClient {
  private endpoints: ParsedEndpoint[];
  private maxRetries: number;
  private retryDelayMs: number;
  private timeoutMs: number;

  constructor(options: NanoRpcClientOptions) {
    if (!options.endpoints.length) {
      throw new Error('At least one endpoint is required');
    }
    this.endpoints = options.endpoints.map(url => this.parseRpcUrl(url));
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  /**
   * Get block information by hash
   */
  async getBlockInfo(hash: string): Promise<BlockInfo> {
    const response = await this.callRpc('block_info', {
      json_block: true,
      hash
    });

    // Block data is nested in the contents object
    const contents = response.contents as Record<string, unknown>;

    return {
      hash: (response.hash as string | undefined) ?? hash,
      type: (contents.type as string | undefined) ?? 'state',
      subtype: response.subtype as string | undefined,
      block_account: response.block_account as string,
      previous: contents.previous as string,
      representative: contents.representative as string | undefined,
      balance: response.balance as string,
      link: contents.link as string,
      link_as_account: contents.link_as_account as string | undefined,
      signature: contents.signature as string,
      work: contents.work as string,
      amount: response.amount as string,
      confirmed: (response.confirmed === 'true' || response.confirmed === true),
      height: parseInt((response.height as string | undefined) ?? '0', 10)
    };
  }

  /**
   * Check if a block hash is receivable (i.e., the send block exists and its
   * funds have NOT yet been pocketed by a receive block).
   * Uses the `receivable_exists` RPC (V23+).
   *
   * @param hash The block hash of a send block
   * @returns true if the block is still receivable (unreceived)
   */
  async receivableExists(hash: string): Promise<boolean> {
    try {
      const response = await this.callRpc('receivable_exists', {
        hash,
        include_only_confirmed: true
      });
      return response.exists === '1' || response.exists === 1 || response.exists === true;
    } catch (e) {
      try {
        // Fallback for V23 and older nodes that still use pending_exists
        const response = await this.callRpc('pending_exists', {
          hash,
          include_only_confirmed: true
        });
        return response.exists === '1' || response.exists === 1 || response.exists === true;
      } catch (e2) {
        try {
          // Fallback using blocks_info (some nodes support this)
          const info = await this.callRpc('blocks_info', {
            hashes: [hash],
            receive_hash: true
          });
          
          const blocks = info.blocks as Record<string, any> | undefined;
          if (blocks && blocks[hash]) {
            const block = blocks[hash];
            const isConfirmed = block.confirmed === 'true' || block.confirmed === true;
            if (!isConfirmed) return false;

            const receiveHash = block.receive_hash;
            return !receiveHash || receiveHash === '0' || receiveHash === '0'.repeat(64);
          }
          throw new Error('Block not found in blocks_info');
        } catch (e3) {
          // Final fallback for restricted proxies like rpc.nano.to
          // Use block_info (singular) then verify via receivable
          const info = await this.callRpc('block_info', {
            hash,
            json_block: true
          });
          
          const isConfirmed = info.confirmed === 'true' || info.confirmed === true;
          if (!isConfirmed) return false;

          // Get the destination account from the block
          // For state blocks, it's either 'link_as_account' (send) or 'account' (destination of the block)
          // In x402, the block we are checking is the SEND block, so the destination is in 'link_as_account'
          const contents = info.contents as Record<string, any> | undefined;
          const destinationAccount = (info as any).block_account || (info as any).link_as_account || (contents?.link_as_account);
          
          if (!destinationAccount) return false;

          // Check if this hash is in the receivable list for the destination account
          try {
            const receivableResponse = await this.callRpc('receivable', {
              account: destinationAccount,
              count: 100,
              include_only_confirmed: true
            });
            
            const receivableBlocks = receivableResponse.blocks as Record<string, any> | string[] | undefined;
            if (!receivableBlocks) return false;
            
            // Handle both object and array formats of receivable
            if (Array.isArray(receivableBlocks)) {
              return receivableBlocks.includes(hash);
            }
            return hash in receivableBlocks;
          } catch (e4) {
            // If receivable also fails, we can't determine status
            return false;
          }
        }
      }
    }
  }

  /**
   * Confirm a block (trigger election if needed)
   * Silently succeeds if the RPC doesn't support block_confirm
   */
  async confirmBlock(hash: string): Promise<void> {
    try {
      await this.callRpc('block_confirm', { hash }, { silent: true });
    } catch (error) {
      const isUnsupported = (err: Error): boolean => {
        const msg = err.message.toLowerCase();
        return msg.includes('unsupported') && msg.includes('rpc');
      };

      if (error instanceof AggregateError) {
        const allUnsupported = error.errors.every(e =>
          e instanceof Error && isUnsupported(e)
        );
        if (allUnsupported) {
          return;
        }
      } else if (error instanceof Error && isUnsupported(error)) {
        return;
      }

      throw error;
    }
  }

  /**
   * Retrieves basic account information (frontier, balance, etc)
   * @param address The Nano account address
   * @throws {AggregateError} if all endpoints fail or return RPC error
   */
  async getAccountInfo(address: string): Promise<AccountInfo> {
    const response = await this.callRpc('account_info', {
      account: address,
      representative: true
    });

    return {
      frontier: response.frontier as string,
      representative: response.representative as string,
      balance: response.balance as string,
      block_count: typeof response.block_count === 'string'
        ? parseInt(response.block_count, 10)
        : response.block_count as number,
      confirmation_height: response.confirmation_height
        ? (typeof response.confirmation_height === 'string'
          ? parseInt(response.confirmation_height, 10)
          : response.confirmation_height as number)
        : undefined,
      account_version: response.account_version as number | undefined
    };
  }

  /**
   * Retrieves recent transaction history for an account
   * @param account The Nano account address
   * @param count Number of entries to retrieve (default: 10)
   */
  async getAccountHistory(account: string, count: number = 10): Promise<AccountHistoryEntry[]> {
    const response = await this.callRpc('account_history', {
      account,
      count: count.toString(),
      raw: true
    });

    const history = response.history as Record<string, unknown>[] | undefined;
    if (!Array.isArray(history)) return [];

    return history.map(entry => ({
      type: entry.type as string,
      account: entry.account as string,
      amount: entry.amount as string,
      hash: entry.hash as string,
      local_timestamp: entry.local_timestamp as string,
      height: entry.height as string,
      confirmed: entry.confirmed as string,
    }));
  }

  /**
   * Broadcasts a signed block to the Nano network.
   * @param block Signed state block representation
   * @returns Processed block hash
   */
  async processBlock(block: Record<string, unknown>): Promise<string> {
    const response = await this.callRpc('process', {
      json_block: true,
      block
    });

    const hash = response.hash as string | undefined;
    if (!hash) {
      throw new Error('RPC process response missing hash');
    }
    return hash;
  }

  /**
   * Gets current active network difficulty, if available.
   */
  async getActiveDifficulty(): Promise<string | undefined> {
    const response = await this.callRpc('telemetry', {}, { silent: true });
    const active = response.active_difficulty;
    return typeof active === 'string' ? active : undefined;
  }

  /**
   * Requests PoW generation from RPC.
   * @param hash Work root hash (usually account frontier)
   * @param difficulty Optional threshold override
   */
  async generateWork(hash: string, difficulty?: string): Promise<string> {
    const response = await this.callRpc('work_generate', {
      hash,
      ...(difficulty ? { difficulty } : {})
    });

    const work = response.work as string | undefined;
    if (!work) {
      throw new Error('RPC work_generate response missing work');
    }
    return work;
  }

  /**
   * Internal method to call RPC with failover and retry
   */
  private async callRpc(action: string, params: Record<string, unknown>, options?: { silent?: boolean }): Promise<Record<string, unknown>> {
    const silent = options?.silent ?? false;
    const errors: Error[] = [];

    for (const endpoint of this.endpoints) {
      try {
        return await this.callEndpointWithRetry(endpoint, action, params);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (!silent) {
          log('%s failed for %s: %s', action, endpoint.baseUrl, err.message);
        }
        // Propagate "Account not found" directly — it's a normal response, not a transient failure
        if (action === 'account_info' && /account not found/i.test(err.message)) {
          throw err;
        }
        errors.push(err);
      }
    }

    if (!silent) {
      log('All endpoints failed for action: %s (%s)', action, errors.map(e => e.message).join(', '));
    }
    throw new AggregateError(errors, `All RPC endpoints failed for action: ${action}`);
  }

  private async callEndpointWithRetry(
    endpoint: ParsedEndpoint,
    action: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    let lastError: Error | undefined;
    let delay = this.retryDelayMs;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const body = { action, ...params, ...endpoint.extraParams };
        logCalls('>>> [%s] %s %j', action, endpoint.baseUrl, body);

        const response = await fetch(endpoint.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          // Merge URL query params into RPC body (convention: ?key=API_KEY -> { ..., key: "API_KEY" })
          body: JSON.stringify(body),
          signal: controller.signal
        });

        if (!response.ok) {
          const bodyText = await response.text().catch(() => '');
          const error = new Error(`HTTP ${response.status}: ${response.statusText}${bodyText ? ` - ${bodyText.slice(0, 200)}` : ''}`);
          logCalls('<<< [%s] %s Error: %s', action, endpoint.baseUrl, error.message);
          throw error;
        }

        const data = await response.json() as Record<string, unknown>;

        if (data.error) {
          logCalls('<<< [%s] %s RPC Error: %s', action, endpoint.baseUrl, data.error);
          const errorMsg = String(data.error);
          const err = new Error(`RPC error: ${errorMsg}`);
          // Fast-fail on account-not-found — it's a normal response, not a transient failure
          if (action === 'account_info' && /account not found/i.test(errorMsg)) {
            throw err;
          }
          throw err;
        }

        logCalls('<<< [%s] %s %j', action, endpoint.baseUrl, data);
        return data;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        
        if (err.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${this.timeoutMs}ms`);
        } else if (err instanceof TypeError && err.message === 'fetch failed') {
          const cause = (err as any).cause;
          const code = cause?.code || cause?.errno;
          lastError = this.formatNetworkError(code, endpoint.baseUrl);
        } else {
          lastError = err;
        }

        const errorMsg = lastError.message;
        const isUnsupported = /unsupported|not supported|unknown action/i.test(errorMsg);
        const isAccountNotFound = action === 'account_info' && /account not found/i.test(errorMsg);

        if (!(errorMsg.toLowerCase().startsWith('rpc error') || errorMsg.toLowerCase().startsWith('http '))) {
          logCalls('<<< [%s] %s Exception: %s', action, endpoint.baseUrl, errorMsg);
        }

        if (isUnsupported || isAccountNotFound) {
          logCalls('<<< [%s] %s Fast-failing %s', action, endpoint.baseUrl, isAccountNotFound ? 'account not found' : 'unsupported action');
          break;
        }

        if (attempt < this.maxRetries - 1) {
          await this.sleep(delay);
          delay *= 2;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError ?? new Error('Unknown error');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Formats network-level errors into user-friendly messages.
   */
  private formatNetworkError(code: string | number | undefined, endpoint: string): Error {
    const host = (() => {
      try { return new URL(endpoint).host; } catch { return endpoint; }
    })();

    switch (code) {
      case 'ECONNREFUSED':
        return new Error(`Connection refused by ${host}`);
      case 'ENOTFOUND':
        return new Error(`Host not found: ${host}`);
      case 'ETIMEDOUT':
        return new Error(`Connection timed out to ${host}`);
      case 'ECONNRESET':
        return new Error(`Connection reset by ${host}`);
      case 'ENETUNREACH':
        return new Error(`Network unreachable`);
      case 'EHOSTUNREACH':
        return new Error(`Host unreachable: ${host}`);
      case 'EAI_AGAIN':
        return new Error(`DNS lookup failed for ${host} (temporary)`);
      default:
        return new Error(`Network error connecting to ${host}${code ? ` (${code})` : ''}`);
    }
  }

  /**
   * Parses an RPC URL to extract query parameters.
   * Query params are merged into each RPC request body.
   *
   * Convention: URLs like `https://rpc.nano.to?key=ABC` will include `{ key: "ABC" }`
   * in every RPC request body, enabling API key authentication.
   *
   * @param url The RPC endpoint URL (may contain query params)
   * @returns Parsed endpoint with base URL and extracted params
   */
  private parseRpcUrl(url: string): ParsedEndpoint {
    const parsed = new URL(url);
    const extraParams: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      extraParams[key] = value;
    });
    parsed.search = '';
    return {
      baseUrl: parsed.toString().replace(/\/$/, ''),
      extraParams
    };
  }
}
