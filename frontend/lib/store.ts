import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { walletStorageKey } from './wallet-storage-key';

interface WalletState {
  publicKey: string | null;
  balance: string;
  connected: boolean;
  setWallet: (publicKey: string, balance: string) => void;
  updateBalance: (balance: string) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      publicKey: null,
      balance: '0',
      connected: false,
      setWallet: (publicKey, balance) =>
        set({ publicKey, balance, connected: true }),
      updateBalance: (balance) => set({ balance }),
      disconnect: () =>
        set({ publicKey: null, balance: '0', connected: false }),
    }),
    {
      name: walletStorageKey(
        process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET' ? 'testnet' : 'public'
      ), // localStorage key
      partialize: (state) => ({ 
        publicKey: state.publicKey, 
        balance: state.balance, 
        connected: state.connected 
      }),
    }
  )
);

