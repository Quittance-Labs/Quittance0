'use client';

import { useState } from 'react';
import {
  EXPECTED_WALLET_NETWORK,
  sendPayment,
  checkWalletConnection,
  requestWalletAccess,
  getFreighterNetwork,
  isWrongNetwork,
  NETWORK_DISPLAY_NAME,
} from '@/lib/stellar';
import { toast } from 'sonner';
import { Wallet, Loader2 } from 'lucide-react';
import { invoiceApi } from '@/lib/api';
import { showFreighterInstallPrompt, showFreighterWrongNetworkPrompt } from '@/components/FreighterInstallPrompt';
import { useWalletStore } from '@/lib/store';
import { walletSessionGate } from '@/lib/wallet-session';
import { executeFreighterPayment } from '@/lib/pay-freighter-action';

interface PaymentButtonProps {
  destination: string;
  amount: string;
  memo: string;
  assetCode?: string;
  assetIssuer?: string;
  invoiceId?: string;
  payerName?: string;
  payerEmail?: string;
  invoiceStatus?: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  /** Fired when the payer commits to paying, before the wallet is opened. */
  onStart?: () => void;
  onSuccess?: (txHash: string) => void;
  /** Fired when the attempt ends without a confirmed payment. */
  onError?: (message: string) => void;
}

const PAY_TOAST_ID = 'payment-flow';

/**
 * Interactive button triggering the Freighter wallet payment flow.
 */
export default function PaymentButton({
  destination,
  amount,
  memo,
  assetCode = 'XLM',
  assetIssuer,
  invoiceId,
  payerName,
  payerEmail,
  invoiceStatus = 'PENDING',
  onStart,
  onSuccess,
  onError,
}: PaymentButtonProps) {
  const [loading, setLoading] = useState(false);
  const { publicKey, connected, network, freighterAvailable } = useWalletStore();
  const gate = walletSessionGate(
    { freighterAvailable, connected, publicKey, network },
    EXPECTED_WALLET_NETWORK
  );

  const handlePayment = async () => {
    setLoading(true);

    await executeFreighterPayment({
      destination,
      amount,
      memo,
      assetCode,
      assetIssuer,
      invoiceId,
      invoiceStatus,
      payerName,
      payerEmail,
      walletGate: gate,
      checkConnectionFn: checkWalletConnection,
      requestAccessFn: requestWalletAccess,
      getNetworkFn: getFreighterNetwork,
      isWrongNetworkFn: isWrongNetwork,
      sendPaymentFn: sendPayment,
      verifyFn: invoiceApi.verify,
      onStart: () => {
        onStart?.();
        toast.loading('Confirm in wallet...', { id: PAY_TOAST_ID });
      },
      onSent: () => {
        if (invoiceId) {
          toast.loading('Verifying payment...', { id: PAY_TOAST_ID });
        }
      },
      onSuccess: (txHash) => {
        if (invoiceId) {
          toast.success('Payment verified', {
            id: PAY_TOAST_ID,
            description: `TX: ${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
          });
        } else {
          toast.success('Payment successful', {
            id: PAY_TOAST_ID,
            description: `TX: ${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
          });
        }
        onSuccess?.(txHash);
      },
      onError: (title, description) => {
        if (title === gate.message) {
          showFreighterInstallPrompt(gate);
        } else if (title === 'Freighter is not installed') {
          showFreighterInstallPrompt();
        } else if (title === 'Wallet is connected to the wrong network') {
          showFreighterWrongNetworkPrompt(NETWORK_DISPLAY_NAME);
        }
        toast.error(title, {
          id: PAY_TOAST_ID,
          description,
          duration: description?.includes('trustline') ? 10000 : undefined,
        });
        onError?.(title);
      },
      onWarning: (warning) => {
        toast.warning('Payment sent but verification failed', {
          id: PAY_TOAST_ID,
          description: warning || 'Refresh the page or wait for status to update',
        });
      },
    });

    setLoading(false);
  };

  return (
    <button
      type="button"
      onClick={handlePayment}
      disabled={loading || !destination || !amount || invoiceStatus !== 'PENDING'}
      aria-disabled={!gate.ready}
      aria-busy={loading}
      data-payment-state={loading ? 'processing' : gate.status}
      aria-label={
        loading
          ? `Processing payment of ${amount} ${assetCode}`
          : gate.ready
            ? `Pay ${amount} ${assetCode} with Freighter`
            : gate.message
      }
      className="btn btn-primary w-full flex items-center justify-center gap-2 text-lg py-4"
    >
      {loading ? (
        <>
          <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
          Processing...
        </>
      ) : (
        <>
          <Wallet className="w-6 h-6" aria-hidden="true" />
          Pay with Freighter
        </>
      )}
    </button>
  );
}
