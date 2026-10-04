import type { WalletGateResult } from './freighter-availability';

export interface WalletSession {
  publicKey: string | null;
  network: string | null;
  networkPassphrase: string | null;
  balance: string;
  connected: boolean;
  freighterAvailable?: boolean;
  lastError: string | null;
}

export interface WalletSessionChange {
  changed: boolean;
  accountChanged: boolean;
  networkChanged: boolean;
  connectionChanged: boolean;
}

export interface SellerSessionContext extends WalletSession {
  readonly generation: number;
}

export interface SellerSessionToken {
  token: string;
  expiresAt: number;
  sellerPublicKey: string;
  network: string;
}

export interface SellerSessionManager {
  sync(): WalletSession;
  contextFor(expectedPublicKey?: string | null): SellerSessionContext;
  isCurrent(context: SellerSessionContext): boolean;
  assertCurrent(context: SellerSessionContext): void;
  getToken(context: SellerSessionContext): Promise<string>;
  cachedToken(context: SellerSessionContext): string | null;
  invalidate(context: SellerSessionContext, rejectedToken: string): void;
  clear(): void;
}

export function createSellerSessionManager(options: {
  getWalletSession: () => Partial<WalletSession>;
  authenticate: (context: SellerSessionContext, assertCurrent: () => void) => Promise<SellerSessionToken>;
  expectedNetwork: string;
  now?: () => number;
}): SellerSessionManager;

export function normalizeWalletSession(source?: Partial<WalletSession> | null): WalletSession;
export function walletSessionGate(
  session?: Partial<WalletSession> | null,
  expectedNetwork?: string
): WalletGateResult;
export function walletSessionKey(session?: Partial<WalletSession> | null): string | null;
export function walletSessionChanged(
  previous?: Partial<WalletSession> | null,
  next?: Partial<WalletSession> | null
): WalletSessionChange;
export function shouldClearSellerState(
  previous?: Partial<WalletSession> | null,
  next?: Partial<WalletSession> | null
): boolean;
