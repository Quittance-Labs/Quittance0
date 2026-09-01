'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  checkWalletConnection, 
  requestWalletAccess, 
  getUserPublicKey,
  getAccountBalance,
  describeStellarNetworkError,
  getFreighterNetwork,
  isWrongNetwork as checkIsWrongNetwork,
  NETWORK_DISPLAY_NAME,
} from '@/lib/stellar';
import { useWalletStore } from '@/lib/store';
import { paymentMonitor } from '@/lib/payment-monitor';
import { Wallet, LogOut, Loader2, ExternalLink, Bell, BellOff, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { formatAddress } from '@/lib/utils';
import { showFreighterInstallPrompt, showFreighterWrongNetworkPrompt } from '@/components/FreighterInstallPrompt';

interface WalletConnectProps {
  onConnect?: (publicKey: string) => void;
}

export default function WalletConnect({ onConnect }: WalletConnectProps = {}) {
  const [loading, setLoading] = useState(false);
  const [monitoringActive, setMonitoringActive] = useState(false);
  const {
    publicKey,
    balance,
    connected,
    isWrongNetwork,
    network,
    networkPassphrase,
    setWallet,
    setNetwork,
    setIsWrongNetwork,
    disconnect,
  } = useWalletStore();

  const loadBalance = useCallback(async (key: string, netName?: string | null, netPass?: string | null) => {
    try {
      const balances = await getAccountBalance(key);
      const xlmBalance = balances.find(b => b.assetCode === 'XLM');
      const balanceStr = xlmBalance ? parseFloat(xlmBalance.balance).toFixed(2) : '0.00';
      setWallet(key, balanceStr, netName, netPass);
    } catch (error: any) {
      if (error.message?.includes('Not Found') || error.response?.status === 404) {
        setWallet(key, '0.00', netName, netPass);
        toast.warning('Account needs funding');
      } else {
        // Wallet identity is still usable even if Horizon balance lookup is down.
        setWallet(key, '—', netName, netPass);
        toast.warning('Wallet connected; balance unavailable', {
          description: describeStellarNetworkError(error),
        });
      }
    }
  }, [setWallet]);

  useEffect(() => {
    if (connected && publicKey && !paymentMonitor.isMonitoring(publicKey)) {
      paymentMonitor.startMonitoring(publicKey, () => loadBalance(publicKey, network, networkPassphrase));
      setMonitoringActive(true);
    }

    return () => {
      if (publicKey) {
        paymentMonitor.stopMonitoring(publicKey);
      }
    };
  }, [connected, publicKey, network, networkPassphrase, loadBalance]);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const freighterInstalled = await checkWalletConnection();
      if (!freighterInstalled) {
        showFreighterInstallPrompt();
        return;
      }

      const allowed = await requestWalletAccess();
      if (allowed) {
        const key = await getUserPublicKey();
        if (key) {
          const netDetails = await getFreighterNetwork();
          const netName = netDetails?.network || null;
          const netPass = netDetails?.networkPassphrase || null;
          const wrong = checkIsWrongNetwork(netPass || netName);

          setNetwork(netName, netPass);
          setIsWrongNetwork(wrong);

          await loadBalance(key, netName, netPass);

          if (wrong) {
            showFreighterWrongNetworkPrompt(NETWORK_DISPLAY_NAME);
          } else {
            toast.success('Wallet connected');
          }
          onConnect?.(key);
        } else {
          toast.error('Could not read your Freighter account');
        }
      } else {
        toast.error('Freighter access was denied');
      }
    } catch {
      toast.error('Failed to connect to Freighter. Try again.');
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
      toast.info('Monitoring paused');
    } else {
      paymentMonitor.startMonitoring(publicKey, () => loadBalance(publicKey, network, networkPassphrase));
      setMonitoringActive(true);
    }
  };

  const openExplorer = () => {
    const net = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET' ? 'testnet' : 'public';
    window.open(`https://stellar.expert/explorer/${net}/account/${publicKey}`, '_blank');
  };

  if (connected && publicKey) {
    /*
     * Every control in this cluster is an icon, and the two that carry a label
     * hide it below the `sm` breakpoint. `title` is not an accessible name on a
     * touch device and is unreliable everywhere else, so each one gets an
     * explicit `aria-label` that survives the responsive class.
     */
    const explorerLabel = `View wallet ${formatAddress(publicKey, 4)} on Stellar Explorer (opens in a new tab)`;

    return (
      <div className="flex items-center gap-2" role="group" aria-label="Connected wallet">
        {/* Wrong Network Indicator */}
        {isWrongNetwork ? (
          <button
            onClick={() => showFreighterWrongNetworkPrompt(NETWORK_DISPLAY_NAME)}
            type="button"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-full transition-colors"
            aria-label={`Warning: Wrong Stellar network connected. Please switch to ${NETWORK_DISPLAY_NAME} in Freighter`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
            <span>Wrong Network</span>
          </button>
        ) : (
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 text-[11px] font-medium text-[var(--teal)] bg-[var(--teal)]/10 rounded-full">
            {NETWORK_DISPLAY_NAME}
          </span>
        )}

        {/* Balance */}
        <div className="hidden md:flex flex-col items-end mr-2">
          <span className="text-xs text-gray-600 font-medium" aria-hidden="true">
            Balance
          </span>
          <span className="text-sm font-semibold text-gray-900">
            <span className="sr-only">Balance: </span>
            {balance} XLM
          </span>
        </div>

        {/* Address */}
        <button
          onClick={openExplorer}
          aria-label={explorerLabel}
          className="hidden sm:flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <Wallet className="w-4 h-4 text-cyan-700" aria-hidden="true" />
          <span className="text-sm font-mono text-gray-900" aria-hidden="true">
            {formatAddress(publicKey, 4)}
          </span>
          <ExternalLink className="w-3 h-3 text-gray-600" aria-hidden="true" />
        </button>

        {/* Mobile view */}
        <button
          onClick={openExplorer}
          aria-label={explorerLabel}
          className="sm:hidden p-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
        >
          <Wallet className="w-5 h-5 text-cyan-700" aria-hidden="true" />
        </button>

        {/* Monitoring Toggle */}
        <button
          onClick={toggleMonitoring}
          // A toggle, so its state belongs in aria-pressed rather than in a
          // label that changes out from under the user.
          aria-pressed={monitoringActive}
          aria-label="Monitor this wallet for incoming payments"
          className={`p-2 rounded-lg transition-colors ${
            monitoringActive
              ? 'text-green-700 bg-green-50 hover:bg-green-100'
              : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
          }`}
        >
          {monitoringActive ? (
            <Bell className="w-5 h-5" aria-hidden="true" />
          ) : (
            <BellOff className="w-5 h-5" aria-hidden="true" />
          )}
        </button>

        {/* Disconnect */}
        <button
          onClick={handleDisconnect}
          aria-label="Disconnect wallet"
          className="p-2 text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
        >
          <LogOut className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={loading}
      aria-busy={loading}
      // The text label is hidden below `sm`, so the name comes from aria-label
      // and does not vanish on a phone.
      aria-label={loading ? 'Connecting to Freighter wallet' : 'Connect Freighter wallet'}
      className="btn btn-primary flex items-center gap-2"
    >
      {loading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span className="hidden sm:inline">Connecting...</span>
        </>
      ) : (
        <>
          <Wallet className="w-5 h-5" aria-hidden="true" />
          <span className="hidden sm:inline">Connect Wallet</span>
        </>
      )}
    </button>
  );
}
