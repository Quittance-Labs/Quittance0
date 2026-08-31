export const WALLET_STORAGE_KEYS: Readonly<{
  publicKey: string;
  balance: string;
  connected: string;
  network: string;
}>;
export function walletStorageKey(
  name: 'publicKey' | 'balance' | 'connected' | 'network'
): string;
