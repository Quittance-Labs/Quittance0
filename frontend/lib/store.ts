import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WalletState {
  publicKey: string | null;
  balance: string;
  connected: boolean;
  network: string | null;
  networkPassphrase: string | null;
  freighterAvailable: boolean | null;
  lastSyncedAt: number | null;
  expectedNetwork: string;
  setWallet: (publicKey: string, balance: string, network?: string | null, networkPassphrase?: string | null) => void;
  updateBalance: (balance: string) => void;
  syncSession: (session: Partial<Pick<WalletState, 'publicKey' | 'balance' | 'connected' | 'network' | 'networkPassphrase' | 'freighterAvailable'>>) => void;
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
      setWallet: (publicKey, balance, network = null, networkPassphrase = null) =>
        set({
          publicKey,
          balance,
          network,
          networkPassphrase,
          freighterAvailable: true,
          connected: true,
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
      disconnect: () =>
        set({
          publicKey: null,
          balance: '0',
          connected: false,
          network: null,
          networkPassphrase: null,
          lastSyncedAt: Date.now(),
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
