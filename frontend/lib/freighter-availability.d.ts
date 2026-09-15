export const FREIGHTER_INSTALL_URL: string;
export const FREIGHTER_REQUIRED_MESSAGE: string;
export const FREIGHTER_CONNECT_REQUIRED_MESSAGE: string;
export const FREIGHTER_READY_MESSAGE: string;
export const FREIGHTER_CHECKING_MESSAGE: string;
export const NETWORK_LABELS: Record<string, string>;

export function FREIGHTER_WRONG_NETWORK_MESSAGE(targetNetwork?: string): string;

export type WalletGateStatus = 'checking' | 'missing' | 'disconnected' | 'wrong_network' | 'ready';

export interface WalletGateSession {
  sessionVerified?: boolean;
  freighterAvailable?: boolean | null;
  connected?: boolean;
  publicKey?: string | null;
  network?: string | null;
}

export interface WalletGateResult {
  status: WalletGateStatus;
  ready: boolean;
  title: string;
  message: string;
  action: 'install' | 'connect' | 'switch_network' | 'continue';
}

export function detectFreighter(
  checkConnection: () => Promise<boolean | { isConnected?: boolean; error?: unknown }>
): Promise<boolean>;

export function normalizeFreighterBoolean(value: unknown, key: string): boolean;
export function normalizeNetworkName(network?: string | null): string | null;
export function networkLabel(network?: string | null): string;
export function networkMatches(actual?: string | null, expected?: string | null): boolean;
export function walletGate(session?: WalletGateSession, expectedNetwork?: string): WalletGateResult;
export function wrongNetworkMessage(expectedNetwork?: string, actualNetwork?: string | null): string;

export function isNetworkMatching(
  networkOrPassphrase?: string | null,
  expected?: string
): boolean;
