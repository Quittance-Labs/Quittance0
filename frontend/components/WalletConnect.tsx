'use client';

import { useState, useEffect } from 'react';
import { 
  checkWalletConnection, 
  requestWalletAccess, 
  getUserPublicKey,
  getAccountBalance 
} from '@/lib/stellar';
import { useWalletStore } from '@/lib/store';
import { paymentMonitor } from '@/lib/payment-monitor';
import { Wallet, LogOut, Loader2, ExternalLink, Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { formatAddress } from '@/lib/utils';

interface WalletConnectProps {
  onConnect?: (publicKey: string) => void;
}

export default function WalletConnect({ onConnect }: WalletConnectProps = {}) {
  const [loading, setLoading] = useState(false);
  const [monitoringActive, setMonitoringActive] = useState(false);
  const { publicKey, balance, connected, setWallet, updateBalance, disconnect } = useWalletStore();

  // Don't auto-connect on mount - user must click Connect Wallet
  // useEffect(() => {
  //   checkConnection();
  // }, []);

  // Start payment monitoring when connected (but user must connect first)
  useEffect(() => {
    if (connected && publicKey && !paymentMonitor.isMonitoring(publicKey)) {
      paymentMonitor.startMonitoring(publicKey, (payment) => {
        // Reload balance on payment received
        loadBalance(publicKey);
      });
      setMonitoringActive(true);
    }

    return () => {
      // Cleanup on unmount
      if (publicKey) {
        paymentMonitor.stopMonitoring(publicKey);
      }
    };
  }, [connected, publicKey]);

  // Removed auto-connect check - user must manually connect

  const loadBalance = async (key: string) => {
    try {
      const balances = await getAccountBalance(key);
      const xlmBalance = balances.find(b => b.assetCode === 'XLM');
      const balanceStr = xlmBalance ? parseFloat(xlmBalance.balance).toFixed(2) : '0.00';
      setWallet(key, balanceStr);
    } catch (error: any) {
      console.error('Balance error:', error);
      // Account not funded yet
      if (error.message?.includes('Not Found') || error.response?.status === 404) {
        setWallet(key, '0.00');
        toast.warning('Account not funded', {
          description: 'Get test XLM from Stellar Laboratory',
          action: {
            label: 'Fund Account',
            onClick: () => window.open(`https://laboratory.stellar.org/#account-creator?network=test`, '_blank'),
          },
        });
      }
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      const allowed = await requestWalletAccess();
      
      if (allowed) {
        const key = await getUserPublicKey();
        if (key) {
          await loadBalance(key);
          toast.success('Wallet connected!');
          
          // Call the onConnect callback if provided
          if (onConnect) {
            onConnect(key);
          }
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
    if (publicKey) {
      paymentMonitor.stopMonitoring(publicKey);
    }
    setMonitoringActive(false);
    disconnect();
    toast.info('Wallet disconnected');
  };

  const toggleMonitoring = () => {
    if (!publicKey) return;

    if (monitoringActive) {
      paymentMonitor.stopMonitoring(publicKey);
      setMonitoringActive(false);
      toast.info('Payment monitoring paused');
    } else {
      paymentMonitor.startMonitoring(publicKey, (payment) => {
        loadBalance(publicKey);
      });
      setMonitoringActive(true);
    }
  };

  const openExplorer = () => {
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET' ? 'testnet' : 'public';
    window.open(`https://stellar.expert/explorer/${network}/account/${publicKey}`, '_blank');
  };

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-2">
        {/* Balance */}
        <div className="hidden md:flex flex-col items-end mr-2">
          <span className="text-xs text-gray-500 font-medium">Balance</span>
          <span className="text-sm font-semibold text-gray-900">
            {balance} XLM
          </span>
        </div>

        {/* Address */}
        <button
          onClick={openExplorer}
          className="hidden sm:flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <Wallet className="w-4 h-4 text-cyan-600" />
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
          <Wallet className="w-5 h-5 text-cyan-600" />
        </button>

        {/* Monitoring Toggle */}
        <button
          onClick={toggleMonitoring}
          className={`p-2 rounded-lg transition-colors ${
            monitoringActive
              ? 'text-green-600 bg-green-50 hover:bg-green-100'
              : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
          }`}
          title={monitoringActive ? 'Monitoring active' : 'Start monitoring'}
        >
          {monitoringActive ? (
            <Bell className="w-5 h-5" />
          ) : (
            <BellOff className="w-5 h-5" />
          )}
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

