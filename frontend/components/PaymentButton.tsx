'use client';

import { useState } from 'react';
import {
  EXPECTED_WALLET_NETWORK,
  checkWalletConnection,
  requestWalletAccess,
  getFreighterNetwork,
  isWrongNetwork,
  readFreighterSession,
  preflightAssetTrustline,
  NETWORK_DISPLAY_NAME,
} from '@/lib/stellar';
import {
  buildInvoicePayment,
  submitBuiltPayment,
  makePaymentError,
  isTransportError,
  shortenAddress,
  type BuiltPayment,
  type InvoicePaymentError,
} from '@/lib/invoice-payment-builder';
import type { TrustlinePreflight } from '@/lib/trustline-preflight';
import { toast } from 'sonner';
import { Wallet, Loader2, CheckCircle, X } from 'lucide-react';
import { invoiceApi } from '@/lib/api';
import { showFreighterInstallPrompt, showFreighterWrongNetworkPrompt } from '@/components/FreighterInstallPrompt';
import { describeVerifyError, normalizePayerDetails } from '@/lib/payment-page-state';
import { resolveVerificationError } from '@/lib/verification';
import { HORIZON_OUTAGE_MESSAGE, isHorizonOutageError } from '@/lib/horizon-outage';
import { useWalletStore } from '@/lib/store';
import { walletSessionGate } from '@/lib/wallet-session';

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

// ---------------------------------------------------------------------------
// Payment review dialog
// ---------------------------------------------------------------------------

interface PaymentReviewProps {
  review: BuiltPayment['review'];
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function PaymentReview({ review, onConfirm, onCancel, loading }: PaymentReviewProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
    >
      <div className="card w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 id="review-title" className="text-lg font-semibold text-[var(--ink)]">
            Review payment
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel payment"
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <dl className="space-y-3 mb-6 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--muted)] font-medium">Destination</dt>
            <dd
              className="font-mono text-[var(--ink)] text-right"
              title={review.destination}
              aria-label={`Destination: ${review.destination}`}
            >
              {review.displayDestination}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--muted)] font-medium">Amount</dt>
            <dd className="font-semibold text-[var(--ink)]">
              {review.amount} {review.assetCode}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--muted)] font-medium">Memo</dt>
            <dd className="font-mono text-[var(--ink)] text-right break-all">
              {review.memo}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-[var(--muted)] mb-4">
          These are the exact values that will be signed in Freighter.
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn flex-1 border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            aria-busy={loading}
            className="btn btn-primary flex-1 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Signing…
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" aria-hidden="true" />
                Confirm & sign
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaymentButton
// ---------------------------------------------------------------------------

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
  const [preflight, setPreflight] = useState<TrustlinePreflight | null>(null);
  const [pendingBuilt, setPendingBuilt] = useState<BuiltPayment | null>(null);
  const [signing, setSigning] = useState(false);

  const { publicKey, connected, network, freighterAvailable } = useWalletStore();
  // Same session, same gate as the create form and the dashboard: a mismatch
  // blocks all three from one place (issue #442).
  const gate = walletSessionGate(
    { freighterAvailable, connected, publicKey, network },
    EXPECTED_WALLET_NETWORK
  );

  // ── Freighter prereq check ────────────────────────────────────────────────
  // Run before build: surface wallet problems immediately without touching the
  // builder.

  const checkFreighterPrerequisites = async (): Promise<InvoicePaymentError | null> => {
    const freighterInstalled = await checkWalletConnection();
    if (!freighterInstalled) {
      showFreighterInstallPrompt();
      return makePaymentError(
        'wallet',
        'FREIGHTER_NOT_INSTALLED',
        'Freighter is not installed. Please install the extension and try again.'
      );
    }

    const allowed = await requestWalletAccess();
    if (!allowed) {
      return makePaymentError(
        'wallet',
        'FREIGHTER_ACCESS_DENIED',
        'Wallet connection failed. Please reconnect Freighter and try again.'
      );
    }

    const netDetails = await getFreighterNetwork();
    const wrong = isWrongNetwork(netDetails?.networkPassphrase || netDetails?.network);
    if (wrong) {
      showFreighterWrongNetworkPrompt(NETWORK_DISPLAY_NAME);
      return makePaymentError(
        'network',
        'NETWORK_MISMATCH',
        `Your wallet is connected to the wrong network. Please switch to ${NETWORK_DISPLAY_NAME} in Freighter.`
      );
    }

    return null;
  };

  // ── Build phase ───────────────────────────────────────────────────────────

  // The whole attempt is bound to the key that started it (issue #508). If
  // the wallet underneath changes while Freighter is open or the verify
  // request is in flight, the result belongs to the previous session and
  // must not be attributed to the new one. Both the build and the confirm
  // handlers read this, so it lives on the component rather than inside one
  // callback.
  const sessionPublicKey = publicKey;
  const sessionLost = () => useWalletStore.getState().publicKey !== sessionPublicKey;
  const reportSessionLost = () => {
    // No onError dispatch: the page already reset the session for the new
    // key, and an error written into it would belong to the previous one.
    toast.warning('Wallet changed during payment', {
      id: PAY_TOAST_ID,
      description: 'The previous wallet submitted the transaction. Reconnect it to verify here.',
    });
  };

  const handlePayment = async () => {
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
      // Credit assets need a payer trustline; check it before Freighter opens
      // so a missing one blocks submit with its own state (issue #506). A
      // Horizon outage is retryable — never a silent pass.
      if (assetCode && assetCode.toUpperCase() !== 'XLM' && publicKey) {
        const check = await preflightAssetTrustline(publicKey, assetCode, assetIssuer);
        if (!check.ok) {
          setPreflight(check);
          toast.error(
            check.code === 'MISSING_TRUSTLINE'
              ? `${assetCode} trustline required`
              : 'Balance check failed',
            {
              id: PAY_TOAST_ID,
              description: check.message,
              duration: check.code === 'MISSING_TRUSTLINE' ? 10000 : undefined,
            }
          );
          onError?.(check.message || 'Payment preflight failed');
          return;
        }
      }
      setPreflight(null);

      // Check Freighter prerequisites before invoking the builder.
      const prereqError = await checkFreighterPrerequisites();
      if (prereqError) {
        toast.error(prereqError.message, { id: PAY_TOAST_ID });
        onError?.(prereqError.message);
        return;
      }

      // Build transaction with full validation. Network mismatch and memo
      // safety are enforced inside the builder — not here.
      const buildResult = await buildInvoicePayment(
        {
          sellerPublicKey: destination,
          amount,
          assetCode,
          assetIssuer,
          memo,
        },
        {
          publicKey: publicKey!,
          network,
          networkPassphrase: null,
        }
      );

      if ('category' in buildResult) {
        // Builder rejected the payment — surface the specific reason.
        const errMsg = buildResult.message;
        toast.error(errMsg, { id: PAY_TOAST_ID });
        onError?.(errMsg);
        return;
      }

      // Show review dialog before Freighter prompt.
      setPendingBuilt(buildResult);
    } finally {
      setLoading(false);
    }
  };

  // ── Sign + submit phase (called after user confirms review) ───────────────

  const handleConfirmReview = async () => {
    if (!pendingBuilt) return;

    const payer = normalizePayerDetails({ payerName, payerEmail });
    if (!payer.ok) {
      toast.error(payer.error);
      return;
    }

    setSigning(true);
    const built = pendingBuilt;
    setPendingBuilt(null);

    try {
      toast.loading('Confirm in wallet…', { id: PAY_TOAST_ID });

      const submitResult = await submitBuiltPayment(built);

      if ('category' in submitResult) {
        const errMsg = submitResult.message;
        const isUserRejection = submitResult.code === 'USER_REJECTED';
        if (isUserRejection) {
          toast.dismiss(PAY_TOAST_ID);
        } else {
          toast.error(
            isTransportError(submitResult)
              ? 'The transaction could not be submitted.'
              : 'Payment failed.',
            { id: PAY_TOAST_ID, description: errMsg }
          );
        }
        onError?.(errMsg);
        return;
      }

      const { txHash } = submitResult;

      // A switch while the Freighter prompt was open means the signing key is
      // no longer the connected session: the hash belongs to the previous
      // wallet's session, so stop instead of reporting success — or pushing
      // the previous session's payer details — under the new key. The live
      // Freighter key is checked as well because the store can lag a switch
      // the user made inside the wallet itself.
      const liveSession = await readFreighterSession().catch(() => null);
      const signerChanged = Boolean(
        liveSession?.publicKey && liveSession.publicKey !== sessionPublicKey
      );
      if (sessionLost() || signerChanged) {
        reportSessionLost();
        return;
      }

      // ── Automatic verify handoff ──────────────────────────────────────────
      // The exact hash returned by submitBuiltPayment is passed directly into
      // invoice verification. The user never needs to paste it.
      if (invoiceId) {
        toast.loading('Verifying payment…', { id: PAY_TOAST_ID });
        try {
          await invoiceApi.verify(invoiceId, txHash, payer.value);
          toast.success('Payment verified', {
            id: PAY_TOAST_ID,
            description: `TX: ${txHash.slice(0, 8)}…${txHash.slice(-8)}`,
          });
        } catch (error) {
          console.error('Verification failed:', error);
          if (isHorizonOutageError(error)) {
            toast.warning(HORIZON_OUTAGE_MESSAGE, {
              id: PAY_TOAST_ID,
            });
          } else {
            toast.warning('Payment sent but verification failed', {
              id: PAY_TOAST_ID,
              description: resolveVerificationError(
                error,
                'Refresh the page or wait for status to update'
              ),
            });
          }
        }
      } else {
        toast.success('Payment successful', {
          id: PAY_TOAST_ID,
          description: `TX: ${txHash.slice(0, 8)}…${txHash.slice(-8)}`,
        });
      }

      // A switch during the in-flight verify belongs to the old session as
      // well — the page must not record the hash under the new key.
      if (sessionLost()) {
        reportSessionLost();
        return;
      }

      onSuccess?.(txHash);
    } catch (error: unknown) {
      // A failure thrown while the wallet underneath changed belongs to the
      // old session — report the switch instead of an error the new key owns.
      if (sessionLost()) {
        reportSessionLost();
        return;
      }
      const err = error as { message?: string };
      const missingTrustline =
        assetCode !== 'XLM' && (
          err.message?.toLowerCase().includes('trustline') ||
          err.message?.toLowerCase().includes('op_no_trust')
        );
      const title = missingTrustline ? `${assetCode} trustline required` : 'Payment failed';
      toast.error(title, {
        id: PAY_TOAST_ID,
        description: missingTrustline
          ? `Please add a trustline for ${assetCode} in your wallet before paying.`
          : (err.message || 'Try again'),
        duration: missingTrustline ? 10000 : undefined,
      });
      onError?.(title);
    } finally {
      setSigning(false);
    }
  };

  const handleCancelReview = () => {
    setPendingBuilt(null);
    toast.dismiss(PAY_TOAST_ID);
  };

  const isProcessing = loading || signing;

  return (
    <>
      {pendingBuilt && (
        <PaymentReview
          review={pendingBuilt.review}
          onConfirm={handleConfirmReview}
          onCancel={handleCancelReview}
          loading={signing}
        />
      )}

      {/*
       * The accessible name spells out the amount and asset (issue #289). "Pay
       * with Freighter" on its own does not say what is about to leave the
       * payer's wallet, and the amount lives in a separate panel rendered with
       * `bg-clip-text`, so a screen-reader user confirming a payment had no way
       * to hear the figure from the control itself.
       *
       * `aria-busy` reports the in-flight attempt; the label change to
       * "Processing..." covers the visual side.
       */}
      <button
        type="button"
        onClick={handlePayment}
        disabled={isProcessing || !destination || !amount || invoiceStatus !== 'PENDING'}
        aria-disabled={!gate.ready}
        aria-busy={isProcessing}
        data-payment-state={isProcessing ? 'processing' : gate.status}
        aria-label={
          isProcessing
            ? `Processing payment of ${amount} ${assetCode}`
            : gate.ready
              ? `Pay ${amount} ${assetCode} with Freighter`
              : gate.message
        }
        className="btn btn-primary w-full flex items-center justify-center gap-2 text-lg py-4"
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
            Processing…
          </>
        ) : (
          <>
            <Wallet className="w-6 h-6" aria-hidden="true" />
            Pay with Freighter
          </>
        )}
      </button>
      {preflight && !preflight.ok && (
        <div
          role="alert"
          data-preflight={preflight.code}
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <span className="font-semibold block mb-0.5">
            {preflight.code === 'MISSING_TRUSTLINE'
              ? `${assetCode} trustline required`
              : preflight.code === 'ACCOUNT_NOT_FOUND'
                ? 'Wallet account not funded'
                : 'Balance check failed'}
          </span>
          <span>{preflight.message}</span>
          {preflight.retryable && (
            <button
              type="button"
              onClick={handlePayment}
              className="mt-2 block text-xs font-medium underline"
            >
              Retry the balance check
            </button>
          )}
        </div>
      )}
    </>
  );
}
