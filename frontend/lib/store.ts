import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { walletStorageKey } from './wallet-storage-key';

export interface WalletState {
  publicKey: string | null;
  balance: string;
  connected: boolean;
  network: string | null;
  networkPassphrase: string | null;
  freighterAvailable: boolean | null;
  lastSyncedAt: number | null;
  expectedNetwork: string;
  isWrongNetwork: boolean;
  setWallet: (
    publicKey: string,
    balance: string,
    network?: string | null,
    networkPassphrase?: string | null
  ) => void;
  updateBalance: (balance: string) => void;
  syncSession: (session: Partial<Pick<WalletState, 'publicKey' | 'balance' | 'connected' | 'network' | 'networkPassphrase' | 'freighterAvailable'>>) => void;
  setNetwork: (network: string | null, networkPassphrase?: string | null) => void;
  setIsWrongNetwork: (isWrong: boolean) => void;
  disconnect: () => void;
}

const EXPECTED_NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'TESTNET').toUpperCase();

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      publicKey: null,
      balance: '0',
      connected: false,
      network: null,
      networkPassphrase: null,
      freighterAvailable: null,
      lastSyncedAt: null,
      expectedNetwork: EXPECTED_NETWORK,
      isWrongNetwork: false,
      setWallet: (publicKey, balance, network = null, networkPassphrase = null) =>
        set({
          publicKey,
          balance,
          connected: true,
          network,
          networkPassphrase,
          freighterAvailable: true,
          lastSyncedAt: Date.now(),
        }),
      updateBalance: (balance) => set({ balance }),
      syncSession: (session) =>
        set((state) => ({
          ...state,
          ...session,
          balance: session.balance ?? (
            session.connected === false ? '0' : state.balance
          ),
          publicKey: session.publicKey !== undefined
            ? session.publicKey
            : session.connected === false
              ? null
              : state.publicKey,
          connected: session.connected ?? state.connected,
          lastSyncedAt: Date.now(),
        })),
      setNetwork: (network, networkPassphrase = null) =>
        set({ network, networkPassphrase }),
      setIsWrongNetwork: (isWrongNetwork) => set({ isWrongNetwork }),
      disconnect: () =>
        set({
          publicKey: null,
          balance: '0',
          connected: false,
          network: null,
          networkPassphrase: null,
          freighterAvailable: null,
          lastSyncedAt: Date.now(),
          isWrongNetwork: false,
        }),
    }),
    {
      name: 'wallet-storage',
      partialize: (state) => ({ 
        publicKey: state.publicKey, 
        balance: state.balance, 
        connected: state.connected,
        network: state.network,
        networkPassphrase: state.networkPassphrase,
        freighterAvailable: state.freighterAvailable,
        lastSyncedAt: state.lastSyncedAt,
      }),
    }
  )
);

/**
 * Checks whether the given connected wallet matches the invoice's seller public key.
 */
export function isWalletSeller(walletPublicKey?: string | null, sellerPublicKey?: string | null): boolean {
  if (!sellerPublicKey) return true;
  if (!walletPublicKey) return false;
  return walletPublicKey.trim() === sellerPublicKey.trim();
}

