import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
      name: 'wallet-storage', // localStorage key
      partialize: (state) => ({ 
        publicKey: state.publicKey, 
        balance: state.balance, 
        connected: state.connected 
      }),
    }
  )
);

