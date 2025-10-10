'use client';

import { useState, useEffect } from 'react';
import { 
  checkWalletConnection, 
  requestWalletAccess, 
  getUserPublicKey,
  getAccountBalance 
} from '@/lib/stellar';
import { Wallet, LogOut, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { formatAddress } from '@/lib/utils';

export default function WalletConnect() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>('0');

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    const isConnected = await checkWalletConnection();
    if (isConnected) {
      const key = await getUserPublicKey();
      if (key) {
        setPublicKey(key);
        setConnected(true);
        loadBalance(key);
      }
    }
  };

  const loadBalance = async (key: string) => {
    try {
      const balances = await getAccountBalance(key);
      const xlmBalance = balances.find(b => b.assetCode === 'XLM');
      if (xlmBalance) {
        setBalance(parseFloat(xlmBalance.balance).toFixed(2));
      }
    } catch (error) {
      console.error('Balance error:', error);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      const allowed = await requestWalletAccess();
      
      if (allowed) {
        const key = await getUserPublicKey();
        if (key) {
          setPublicKey(key);
          setConnected(true);
          await loadBalance(key);
          toast.success('Wallet connected!');
        }
      } else {
        toast.error('Wallet access denied');
      }
    } catch (error: any) {
      console.error('Connect error:', error);
      toast.error('Failed to connect wallet. Is Freighter installed?', {
        description: 'Install Freighter from freighter.app',
        action: {
          label: 'Get Freighter',
          onClick: () => window.open('https://www.freighter.app/', '_blank'),
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    setConnected(false);
    setPublicKey(null);
    setBalance('0');
    toast.info('Wallet disconnected');
  };

  const openExplorer = () => {
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET' ? 'testnet' : 'public';
    window.open(`https://stellar.expert/explorer/${network}/account/${publicKey}`, '_blank');
  };

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-3">
        {/* Balance */}
        <div className="hidden md:flex flex-col items-end">
          <span className="text-xs text-gray-500">Balance</span>
          <span className="text-sm font-semibold text-gray-900">
            {balance} XLM
          </span>
        </div>

        {/* Address */}
        <button
          onClick={openExplorer}
          className="hidden sm:flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <Wallet className="w-4 h-4 text-stellar-600" />
          <span className="text-sm font-mono text-gray-900">
            {formatAddress(publicKey, 4)}
          </span>
          <ExternalLink className="w-3 h-3 text-gray-500" />
        </button>

        {/* Mobile view */}
        <button
          onClick={openExplorer}
          className="sm:hidden p-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
        >
          <Wallet className="w-5 h-5 text-stellar-600" />
        </button>

        {/* Disconnect */}
        <button
          onClick={handleDisconnect}
          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          title="Disconnect wallet"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={loading}
      className="btn btn-primary flex items-center gap-2"
    >
      {loading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="hidden sm:inline">Connecting...</span>
        </>
      ) : (
        <>
          <Wallet className="w-5 h-5" />
          <span className="hidden sm:inline">Connect Wallet</span>
        </>
      )}
    </button>
  );
}

