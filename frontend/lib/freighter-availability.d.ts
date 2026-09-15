export interface WalletGateResult {
  status: 'missing' | 'disconnected' | 'wrong_network' | 'ready';
  ready: boolean;
  title: string;
  message: string;
  action: 'install' | 'connect' | 'switch_network' | 'continue';
}

export interface WalletSession {
  freighterAvailable?: boolean;
  connected?: boolean;
  publicKey?: string | null;
  network?: string | null;
  [key: string]: any;
}

export const FREIGHTER_INSTALL_URL: string;
export const FREIGHTER_REQUIRED_MESSAGE: string;
export const FREIGHTER_CONNECT_REQUIRED_MESSAGE: string;
export const FREIGHTER_READY_MESSAGE: string;
export const FREIGHTER_WRONG_NETWORK_MESSAGE: (targetNetwork?: string) => string;
export const NETWORK_LABELS: Readonly<Record<string, string>>;

export function detectFreighter(checkConnection: () => Promise<any>): Promise<boolean>;
export function isNetworkMatching(networkOrPassphrase?: string, expected?: string): boolean;
export function normalizeFreighterBoolean(value: any, key: string): boolean;
export function normalizeNetworkName(network?: string | null): string | null;
export function networkLabel(network?: string | null): string;
export function networkMatches(actual?: string | null, expected?: string | null): boolean;
export function walletGate(session?: WalletSession, expectedNetwork?: string): WalletGateResult;
export function wrongNetworkMessage(expectedNetwork?: string | null, actualNetwork?: string | null): string;
