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
export function shouldResetPaySession(
  previous?: Partial<WalletSession> | null,
  next?: Partial<WalletSession> | null
): boolean;
