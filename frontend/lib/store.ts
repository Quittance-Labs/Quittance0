import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { walletStorageKey } from './wallet-storage-key';
import { networkMatches } from './freighter-availability';

export interface WalletState {
  /** True only after Freighter has been checked in this browser session. */
  sessionVerified: boolean;
  freighterAvailable: boolean | null;
  publicKey: string | null;
  balance: string;
  connected: boolean;
  network: string | null;
  networkPassphrase: string | null;
  isWrongNetwork: boolean;
  setWallet: (
    publicKey: string,
    balance: string,
    network?: string | null,
    networkPassphrase?: string | null
  ) => void;
  updateBalance: (balance: string) => void;
  setNetwork: (network: string | null, networkPassphrase?: string | null) => void;
  setIsWrongNetwork: (isWrong: boolean) => void;
  syncSession: (session: {
    freighterAvailable: boolean;
    connected: boolean;
    publicKey: string | null;
    network: string | null;
    networkPassphrase: string | null;
    balance?: string;
  }) => void;
  disconnect: () => void;
}

const EXPECTED_NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'TESTNET').toUpperCase();

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      sessionVerified: false,
      publicKey: null,
      freighterAvailable: null,
      balance: '0',
      connected: false,
      network: null,
      networkPassphrase: null,
      isWrongNetwork: false,
      setWallet: (publicKey, balance, network = null, networkPassphrase = null) =>
        set({
          sessionVerified: true,
          freighterAvailable: true,
          publicKey,
          balance,
          connected: true,
          network,
          networkPassphrase,
        }),
      updateBalance: (balance) => set({ balance }),
      setNetwork: (network, networkPassphrase = null) =>
        set({ network, networkPassphrase }),
      setIsWrongNetwork: (isWrongNetwork) => set({ isWrongNetwork }),
      syncSession: (session) =>
        set((state) => ({
          sessionVerified: true,
          freighterAvailable: session.freighterAvailable,
          connected: session.connected,
          publicKey: session.connected ? session.publicKey : null,
          network: session.network,
          networkPassphrase: session.networkPassphrase,
          balance: session.balance ?? (session.connected ? state.balance : '0'),
          isWrongNetwork:
            session.connected && Boolean(session.network)
              ? !networkMatches(session.network, EXPECTED_NETWORK)
              : false,
        })),
      disconnect: () =>
        set({
          freighterAvailable: null,
          publicKey: null,
          balance: '0',
          connected: false,
          network: null,
          networkPassphrase: null,
          isWrongNetwork: false,
        }),
    }),
    {
      name: 'wallet-storage', // localStorage key
      partialize: (state) => ({ 
        publicKey: state.publicKey, 
        balance: state.balance, 
        connected: state.connected,
        network: state.network,
        networkPassphrase: state.networkPassphrase,
        freighterAvailable: state.freighterAvailable,
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
