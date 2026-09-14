export const FREIGHTER_INSTALL_URL: string;
export const FREIGHTER_REQUIRED_MESSAGE: string;
export const FREIGHTER_CONNECT_REQUIRED_MESSAGE: string;

export type WalletGateStatus = 'missing' | 'disconnected' | 'wrong_network' | 'ready';
export type WalletGateAction = 'install' | 'connect' | 'switch_network' | 'none';

export interface WalletGateResult {
  status: WalletGateStatus;
  ready: boolean;
  title: string;
  message: string;
  action: WalletGateAction;
}

export interface WalletGateSession {
  freighterAvailable?: boolean;
  connected?: boolean;
  publicKey?: string | null;
  network?: string | null;
}

export function walletGate(
  session?: WalletGateSession | null,
  expectedNetwork?: string
): WalletGateResult;

export function networkLabel(network?: string | null): string;

export function networkMatches(
  networkOrPassphrase?: string | null,
  expected?: string
): boolean;
export function FREIGHTER_WRONG_NETWORK_MESSAGE(targetNetwork?: string): string;

export function detectFreighter(
  checkConnection: () => Promise<boolean | { isConnected?: boolean; error?: unknown }>
): Promise<boolean>;

export function isNetworkMatching(
  networkOrPassphrase?: string | null,
  expected?: string
): boolean;
