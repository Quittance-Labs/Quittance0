'use client';

import { useState } from 'react';
import { sendPayment, checkWalletConnection, requestWalletAccess } from '@/lib/stellar';
import { toast } from 'sonner';
import { Wallet, Loader2 } from 'lucide-react';
import { invoiceApi } from '@/lib/api';
import { showFreighterInstallPrompt } from '@/components/FreighterInstallPrompt';
import { normalizePayerDetails } from '@/lib/payment-page-state';
import { resolveVerificationError } from '@/lib/verification';

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

  const handlePayment = async () => {
    if (invoiceStatus !== 'PENDING') {
      const message = invoiceStatus === 'EXPIRED'
        ? 'This invoice has expired and cannot be paid'
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
        assetCode !== 'XLM' && error.message?.toLowerCase().includes('trustline');
      const title = missingTrustline ? `${assetCode} trustline required` : 'Payment failed';
      toast.error(title, {
        id: PAY_TOAST_ID,
        description: error.message || 'Try again',
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
      disabled={loading || !destination || !amount || invoiceStatus !== 'PENDING'}
      aria-busy={loading}
      data-payment-state={loading ? 'processing' : 'ready'}
      aria-label={
        loading
          ? `Processing payment of ${amount} ${assetCode}`
          : `Pay ${amount} ${assetCode} with Freighter`
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
