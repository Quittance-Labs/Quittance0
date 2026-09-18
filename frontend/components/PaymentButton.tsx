'use client';

import { useState } from 'react';
import {
  EXPECTED_WALLET_NETWORK,
  NETWORK_DISPLAY_NAME,
} from '@/lib/stellar';
import { toast } from 'sonner';
import { Wallet, Loader2 } from 'lucide-react';
import { invoiceApi } from '@/lib/api';
import {
  showFreighterInstallPrompt,
  showFreighterWrongNetworkPrompt,
} from '@/components/FreighterInstallPrompt';
import { normalizePayerDetails } from '@/lib/payment-page-state';
import { resolveVerificationError } from '@/lib/verification';
import { useWalletStore } from '@/lib/store';
import { walletSessionGate } from '@/lib/wallet-session';
import {
  validatePaymentInvoice,
  buildPaymentSummary,
  buildAndSubmitFreighterPayment,
  classifyPaymentError,
  type PaymentSummary,
} from '@/lib/payment-builder';
import PaymentReviewDialog from '@/components/PaymentReviewDialog';

/**
 * Properties for PaymentButton component.
 */
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
  onStart?: () => void;
  onSuccess?: (txHash: string) => void;
  onError?: (error: string) => void;
}

const PAY_TOAST_ID = 'freighter-payment';

/**
 * Button component managing the Freighter payment lifecycle, including pre-flight
 * parameter validation, human review confirmation, and direct verification submission.
 *
 * @param props - Component properties defining destination, amount, memo, asset, and callbacks.
 * @returns Rendered button and payment review dialog.
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
  const [showReview, setShowReview] = useState(false);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null);
  const { publicKey, connected, network, freighterAvailable } = useWalletStore();

  const gate = walletSessionGate(
    { freighterAvailable, connected, publicKey, network },
    EXPECTED_WALLET_NETWORK
  );

  const handlePayment = () => {
    if (!gate.ready) {
      showFreighterInstallPrompt(gate);
      onError?.(gate.message);
      return;
    }

    if (invoiceStatus !== 'PENDING') {
      const message =
        invoiceStatus === 'EXPIRED'
          ? 'This invoice has expired and cannot be paid'
          : invoiceStatus === 'CANCELLED'
          ? 'This invoice was cancelled by the seller and cannot be paid'
          : 'This invoice is not available for payment';
      toast.error(message);
      onError?.(message);
      return;
    }

    const payer = normalizePayerDetails({ payerName, payerEmail });
    if (!payer.ok) {
      toast.error(payer.error);
      onError?.(payer.error);
      return;
    }

    const validation = validatePaymentInvoice({
      destination,
      amount,
      memo,
      assetCode,
      assetIssuer,
    });
    if (!validation.valid) {
      const msg = validation.error || 'Invalid payment parameters';
      toast.error(msg);
      onError?.(msg);
      return;
    }

    try {
      const summary = buildPaymentSummary(
        { destination, amount, memo, assetCode, assetIssuer },
        network
      );
      setPaymentSummary(summary);
      setShowReview(true);
    } catch (err: any) {
      const errorMsg = err.message || 'Could not prepare payment review';
      toast.error(errorMsg);
      onError?.(errorMsg);
    }
  };

  const confirmPayment = async () => {
    const payer = normalizePayerDetails({ payerName, payerEmail });
    setLoading(true);
    onStart?.();

    try {
      const txHash = await buildAndSubmitFreighterPayment(
        { destination, amount, memo, assetCode, assetIssuer },
        { freighterAvailable, connected, publicKey, network }
      );

      if (invoiceId) {
        toast.loading('Verifying payment...', { id: PAY_TOAST_ID });
        try {
          await invoiceApi.verify(invoiceId, txHash, payer.ok ? payer.value : undefined);
          toast.success('Payment verified', {
            id: PAY_TOAST_ID,
            description: `TX: ${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
          });
        } catch (error) {
          console.error('Verification failed:', error);
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

      setShowReview(false);
      onSuccess?.(txHash);
    } catch (error: any) {
      const classified = classifyPaymentError(error);

      if (classified.type === 'NETWORK_MISMATCH') {
        showFreighterWrongNetworkPrompt(NETWORK_DISPLAY_NAME);
      } else if (classified.type === 'WALLET_REQUIRED') {
        showFreighterInstallPrompt();
      }

      const isTrustline = classified.type === 'TRUSTLINE_REQUIRED';
      const title = isTrustline ? `${assetCode} trustline required` : 'Payment failed';

      toast.error(title, {
        id: PAY_TOAST_ID,
        description: isTrustline
          ? `Please add a trustline for ${assetCode} in your wallet before paying.`
          : classified.message,
        duration: isTrustline ? 10000 : undefined,
      });

      onError?.(classified.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
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

      <PaymentReviewDialog
        isOpen={showReview}
        onClose={() => setShowReview(false)}
        onConfirm={confirmPayment}
        summary={paymentSummary}
        loading={loading}
      />
    </>
  );
}
