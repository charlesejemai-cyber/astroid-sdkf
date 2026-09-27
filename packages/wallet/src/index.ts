/**
 * `@astroid/wallet` — wallet lifecycle and on-chain balance resource.
 *
 * Covers creating/importing wallets, listing and reading them, updating status
 * (freeze/pause/archive), reading live Stellar balances, and initiating
 * transfers. Secret material (`ImportWalletInput.secretKey`) is passed straight
 * to the API and is never logged, cached, or returned.
 *
 * @packageDocumentation
 */

import { Resource } from '@astroid/core';
import type {
  CreateWalletInput,
  ImportWalletInput,
  Paginated,
  PaginationParams,
  Transaction,
  TransferInput,
  UpdateWalletInput,
  Wallet,
  WalletBalance,
  WalletStatus,
} from '@astroid/types';

export {
  signTransactionOffline,
  StellarNetworkPassphrase,
  type OfflineSigningResult,
  type SignerLike,
  type TransactionLike,
} from './signing.js';

export { SecureKeystore, type EncryptedPayload } from './keystore.js';

// Wallet key management & Ed25519 message signing utilities (issue #235).
export {
  isValidPublicKey,
  isValidSecretKey,
  assertValidPublicKey,
  assertValidSecretKey,
  derivePublicKey,
  signMessage,
  verifyMessage,
  zeroize,
} from './crypto.js';

/** Filters accepted by {@link WalletResource.list}. */
export interface WalletListParams extends PaginationParams {
  status?: WalletStatus;
  walletType?: string;
  agentId?: string;
  network?: string;
  /** Filter by the wallet's Stellar public address (G…). */
  stellarAddress?: string;
}

/**
 * The `wallets` namespace on the Astroid client.
 *
 * A wallet is a managed Stellar account bound to an organization (and optionally
 * an agent). This resource never exposes private keys: creation returns only the
 * public {@link Wallet}, and imports accept a secret that the backend stores
 * encrypted and never echoes back.
 */
export class WalletResource extends Resource {
  /** Provision a brand-new managed wallet (the backend generates the keypair). */
  async create(input: CreateWalletInput): Promise<Wallet> {
    const res = await this.client.post<Wallet>('/wallets', input);
    return res.data;
  }

  /**
   * Import an existing Stellar account. The optional `secretKey` is transmitted
   * once for encrypted custody and is never logged or returned.
   */
  async import(input: ImportWalletInput): Promise<Wallet> {
    const res = await this.client.post<Wallet>('/wallets/import', input);
    return res.data;
  }

  /** Fetch a single wallet by id. */
  async get(walletId: string): Promise<Wallet> {
    return this.getData<Wallet>(`/wallets/${encodeURIComponent(walletId)}`);
  }

  /**
   * Look up a single wallet by its Stellar public address (`G…`).
   *
   * Uses the list endpoint's `stellarAddress` filter and returns the first
   * match, or `undefined` when no wallet is bound to the address.
   */
  async getByAddress(stellarAddress: string): Promise<Wallet | undefined> {
    const res = await this.list({ stellarAddress, limit: 1 });
    return res.data[0];
  }

  /** List wallets, with optional status/type/agent filters and pagination. */
  async list(params: WalletListParams = {}): Promise<Paginated<Wallet>> {
    return this.listData<Wallet>('/wallets', { ...params });
  }

  /** Iterate every wallet across all pages (page-number pagination). */
  iterate(params: WalletListParams = {}): AsyncGenerator<Wallet, void, void> {
    return this.iterateData<Wallet>('/wallets', { ...params });
  }

  /**
   * Lazily iterate every wallet across all pages using cursor (keyset)
   * pagination.
   *
   * Where {@link WalletResource.iterate} walks 1-based page numbers, this follows
   * the opaque `meta.nextCursor` each response returns, which is the standard
   * pagination contract for Astroid list endpoints. Only one page is held in
   * memory at a time and the next page is requested lazily as the consumer
   * advances the generator.
   *
   * @param params Optional status/type/agent/network filters, page size (`limit`)
   *               and sort `order`. Pass a previously captured `cursor` to resume.
   * @returns An async generator yielding every matching wallet in order.
   *
   * @example
   * ```ts
   * for await (const wallet of astroid.wallets.iterateByCursor({ status: 'ACTIVE', limit: 100 })) {
   *   console.log(wallet.id);
   * }
   *
   * // Resume later from a cursor captured on a previous run:
   * for await (const wallet of astroid.wallets.iterateByCursor({ cursor: savedCursor })) {
   *   // ...
   * }
   * ```
   */
  iterateByCursor(params: WalletListParams = {}): AsyncGenerator<Wallet, void, void> {
    return this.iterateCursorData<Wallet>('/wallets', { ...params });
  }

  /** Update a wallet's mutable fields (label, status, metadata). */
  async update(walletId: string, input: UpdateWalletInput): Promise<Wallet> {
    const res = await this.client.patch<Wallet>(`/wallets/${encodeURIComponent(walletId)}`, input);
    return res.data;
  }

  /** Freeze a wallet: block all outgoing transactions immediately. */
  async freeze(walletId: string): Promise<Wallet> {
    const res = await this.client.post<Wallet>(`/wallets/${encodeURIComponent(walletId)}/freeze`);
    return res.data;
  }

  /** Reverse a freeze, returning the wallet to `ACTIVE`. */
  async unfreeze(walletId: string): Promise<Wallet> {
    const res = await this.client.post<Wallet>(`/wallets/${encodeURIComponent(walletId)}/unfreeze`);
    return res.data;
  }

  /** Archive a wallet (soft-delete; it can no longer transact). */
  async archive(walletId: string): Promise<Wallet> {
    const res = await this.client.post<Wallet>(`/wallets/${encodeURIComponent(walletId)}/archive`);
    return res.data;
  }

  /** Read live on-chain balances for a wallet. */
  async balance(walletId: string): Promise<WalletBalance> {
    return this.getData<WalletBalance>(`/wallets/${encodeURIComponent(walletId)}/balance`);
  }

  /**
   * Initiate a transfer from a wallet. Returns the created {@link Transaction},
   * which may be `PENDING` if policy requires an approval before submission.
   */
  async transfer(walletId: string, input: TransferInput): Promise<Transaction> {
    const res = await this.client.post<Transaction>(
      `/wallets/${encodeURIComponent(walletId)}/transfer`,
      input,
    );
    return res.data;
  }
}

export * from './multisig.js';
