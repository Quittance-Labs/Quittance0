import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { walletStorageKey } from './wallet-storage-key';
import { resolveStellarNetwork } from '../../shared/network.ts';

export interface WalletState {
  publicKey: string | null;
  balance: string;
  connected: boolean;
  network: string | null;
  networkPassphrase: string | null;
  isWrongNetwork: boolean;
  /** Whether the Freighter extension answered the last availability check. */
  freighterAvailable?: boolean;
  setWallet: (
    publicKey: string,
    balance: string,
    network?: string | null,
    networkPassphrase?: string | null
  ) => void;
  updateBalance: (balance: string) => void;
  setNetwork: (network: string | null, networkPassphrase?: string | null) => void;
  setIsWrongNetwork: (isWrong: boolean) => void;
  /**
   * Adopt a session read from Freighter. An undefined key leaves the current
   * value alone; an explicit null clears it, so a disconnect is never mistaken
   * for a reading that was merely absent.
   */
  syncSession: (session: {
    publicKey?: string | null;
    network?: string | null;
    networkPassphrase?: string | null;
    connected?: boolean;
    balance?: string;
    freighterAvailable?: boolean;
  }) => void;
  disconnect: () => void;
}

const EXPECTED_NETWORK = resolveStellarNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK);

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      publicKey: null,
      balance: '0',
      connected: false,
      network: null,
      networkPassphrase: null,
      isWrongNetwork: false,
      setWallet: (publicKey, balance, network = null, networkPassphrase = null) =>
        set({
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
          publicKey:
            session.publicKey === undefined ? state.publicKey : session.publicKey,
          network: session.network === undefined ? state.network : session.network,
          networkPassphrase:
            session.networkPassphrase === undefined
              ? state.networkPassphrase
              : session.networkPassphrase,
          connected:
            session.connected === undefined ? state.connected : session.connected,
          balance: session.balance === undefined ? state.balance : session.balance,
          freighterAvailable:
            session.freighterAvailable === undefined
              ? state.freighterAvailable
              : session.freighterAvailable,
        })),
      disconnect: () =>
        set({
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

