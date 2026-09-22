'use client';

import { useState } from 'react';
import {
  EXPECTED_WALLET_NETWORK,
  sendPayment,
  loadAccount,
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
import { describeVerifyError, normalizePayerDetails } from '@/lib/payment-page-state';
import { resolveVerificationError } from '@/lib/verification';
import { useWalletStore } from '@/lib/store';
import { walletSessionGate } from '@/lib/wallet-session';
import { checkPayerTrustline, type TrustlinePreflightResult } from '@/lib/trustline-preflight';

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
  trustlineGate?: TrustlinePreflightResult;
  /** Fired when the payer commits to paying, before the wallet is opened. */
  onStart?: () => void;
  onSuccess?: (txHash: string) => void;
  /** Fired when the attempt ends without a confirmed payment. */
  onError?: (message: string) => void;
}

const PAY_TOAST_ID = 'payment-flow';

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
  trustlineGate,
  onStart,
  onSuccess,
  onError,
}: PaymentButtonProps) {
  const [loading, setLoading] = useState(false);
  const { publicKey, connected, network, freighterAvailable } = useWalletStore();
  // Same session, same gate as the create form and the dashboard: a mismatch
  // blocks all three from one place (issue #442).
  const gate = walletSessionGate(
    { freighterAvailable, connected, publicKey, network },
    EXPECTED_WALLET_NETWORK
  );

  const handlePayment = async () => {
    if (trustlineGate && !trustlineGate.canPay) {
      toast.error(trustlineGate.title, {
        id: PAY_TOAST_ID,
        description: trustlineGate.message || undefined,
      });
      onError?.(trustlineGate.message || trustlineGate.title);
      return;
    }

    if (!gate.ready) {
      showFreighterInstallPrompt(gate);
      onError?.(gate.message);
      return;
    }

    if (invoiceStatus !== 'PENDING') {
      const message = invoiceStatus === 'EXPIRED'
        ? 'This invoice has expired and cannot be paid'
        : invoiceStatus === 'CANCELLED'
        ? 'This invoice was cancelled by the seller and cannot be paid'
        : 'This invoice is not available for payment';
      toast.error(message);
      onError?.(message);
      return;
    }

    // Payer details are validated by the shared state module, so the button,
    // the page and the tests all agree on what a valid email is.
    const payer = normalizePayerDetails({ payerName, payerEmail });
    if (!payer.ok) {
      toast.error(payer.error);
      onError?.(payer.error);
      return;
    }

    setLoading(true);
    onStart?.();

    try {
      const freighterInstalled = await checkWalletConnection();
      if (!freighterInstalled) {
        showFreighterInstallPrompt();
        onError?.('Freighter is not installed');
        return;
      }

      const allowed = await requestWalletAccess();
      if (!allowed) {
        toast.error('Freighter access was denied');
        onError?.('Freighter access was denied');
        return;
      }

      const netDetails = await getFreighterNetwork();
      const wrong = isWrongNetwork(netDetails?.networkPassphrase || netDetails?.network);
      if (wrong) {
        showFreighterWrongNetworkPrompt(NETWORK_DISPLAY_NAME);
        const wrongMsg = `Wallet is connected to the wrong network. Please switch to ${NETWORK_DISPLAY_NAME} in Freighter.`;
        toast.error(wrongMsg);
        onError?.(wrongMsg);
        return;
      }

      if (assetCode && assetCode !== 'XLM') {
        const preflight = await checkPayerTrustline({
          loadAccountFn: loadAccount,
          publicKey,
          assetCode,
          assetIssuer,
        });

        if (!preflight.canPay) {
          setLoading(false);
          toast.error(preflight.title, {
            id: PAY_TOAST_ID,
            description: preflight.message || undefined,
          });
          onError?.(preflight.message || preflight.title);
          return;
        }
      }

      toast.loading('Confirm in wallet...', { id: PAY_TOAST_ID });
      const txHash = await sendPayment(destination, amount, memo, assetCode, assetIssuer);

      if (invoiceId) {
        toast.loading('Verifying payment...', { id: PAY_TOAST_ID });
        try {
          await invoiceApi.verify(invoiceId, txHash, payer.value);
          toast.success('Payment verified', {
            id: PAY_TOAST_ID,
            description: `TX: ${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
          });
        } catch (error) {
          // The payment is on the ledger even though verification did not
          // complete, so this is a warning and the flow still reports success.
          console.error('Verification failed:', error);
          // Surface the shared rejection message rather than a generic warning.
          toast.warning('Payment sent but verification failed', {
            id: PAY_TOAST_ID,
            description: resolveVerificationError(
              error,
              'Refresh the page or wait for status to update'
            ),
          });
        }
      } else {
        toast.success('Payment successful', {
          id: PAY_TOAST_ID,
          description: `TX: ${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
        });
      }

      onSuccess?.(txHash);
    } catch (error: any) {
      const missingTrustline =
        assetCode !== 'XLM' && (
          error.message?.toLowerCase().includes('trustline') ||
          error.message?.toLowerCase().includes('op_no_trust')
        );
      const title = missingTrustline ? `${assetCode} trustline required` : 'Payment failed';
      toast.error(title, {
        id: PAY_TOAST_ID,
        description: missingTrustline
          ? `Please add a trustline for ${assetCode} in your wallet before paying.`
          : (error.message || 'Try again'),
        duration: missingTrustline ? 10000 : undefined,
      });
      onError?.(title);
    } finally {
      setLoading(false);
    }
  };

  return (
    /*
     * The accessible name spells out the amount and asset (issue #289). "Pay
     * with Freighter" on its own does not say what is about to leave the
     * payer's wallet, and the amount lives in a separate panel rendered with
     * `bg-clip-text`, so a screen-reader user confirming a payment had no way
     * to hear the figure from the control itself.
     *
     * `aria-busy` reports the in-flight attempt; the label change to
     * "Processing..." covers the visual side.
     */
    <button
      type="button"
      onClick={handlePayment}
      disabled={
        loading ||
        !destination ||
        !amount ||
        invoiceStatus !== 'PENDING' ||
        Boolean(trustlineGate && !trustlineGate.canPay)
      }
      aria-disabled={!gate.ready || Boolean(trustlineGate && !trustlineGate.canPay)}
      aria-busy={loading}
      data-payment-state={
        loading
          ? 'processing'
          : trustlineGate && !trustlineGate.canPay
          ? trustlineGate.status
          : gate.status
      }
      aria-label={
        loading
          ? `Processing payment of ${amount} ${assetCode}`
          : trustlineGate && !trustlineGate.canPay
          ? trustlineGate.message || `${assetCode} trustline required`
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
