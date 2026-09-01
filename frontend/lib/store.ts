import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WalletState {
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
  disconnect: () => void;
}

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

