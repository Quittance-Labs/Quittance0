'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { invoiceApi, describeApiError } from '@/lib/api';
import PaymentButton from '@/components/PaymentButton';
import PaymentResultPanel from '@/components/PaymentResultPanel';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import WalletConnect from '@/components/WalletConnect';
import UserProfile from '@/components/UserProfile';
import PaymentReceipt from '@/components/PaymentReceipt';
import AssetLogo from '@/components/AssetLogo';
import { formatAmount, formatDate, getTimeRemaining, copyToClipboard } from '@/lib/utils';
import { Copy, ExternalLink, Loader2, Check, FileText, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { openInvoicePDF, shareInvoiceByEmail } from '@/lib/export';
import {
  PAY_STATES,
  describeVerifyError,
  initialPaymentState,
  isExpiredInvoice,
  normalizePayerDetails,
  paymentReducer,
  shouldPoll,
  shouldShowPaymentControls,
} from '@/lib/payment-page-state';
import { checkTxHash } from '@/lib/verification';
import { MAIN_CONTENT_ID, describeAmount, statusText } from '@/lib/a11y';

export default function PaymentPage() {
  const params = useParams();
  const id = params.id as string;

  const [payment, dispatch] = useReducer(paymentReducer, undefined, () =>
    initialPaymentState(null)
  );
  const [loading, setLoading] = useState(true);
  const [paymentInfo, setPaymentInfo] = useState<any>(null);
  const [userWallet, setUserWallet] = useState<string | null>(null);
  const [verifyTxHash, setVerifyTxHash] = useState<string>('');
  const [payerName, setPayerName] = useState<string>('');
  const [payerEmail, setPayerEmail] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  // Rejected before the request goes out; shown under the field it belongs to
  // and referenced by aria-describedby, not only raised as a toast.
  const [verifyFieldError, setVerifyFieldError] = useState<string | null>(null);

  const invoice = payment.invoice as any;
  const verifying = payment.status === PAY_STATES.VERIFYING;

  // Every response carries the request generation that asked for it. A response
  // from a previous invoice id — or one that lands after the component is gone —
  // is discarded instead of overwriting current state.
  const requestGeneration = useRef(0);

  const loadInvoice = useCallback(async () => {
    const generation = requestGeneration.current;

    try {
      const [invoiceResult, paymentResult] = await Promise.all([
        invoiceApi.getById(id),
        invoiceApi.getPaymentInfo(id),
      ]);

      if (generation !== requestGeneration.current) return;

      dispatch({ type: 'INVOICE_LOADED', invoice: invoiceResult.data });
      setPaymentInfo(paymentResult.data);
      setLoadError(null);
    } catch (error: any) {
      if (generation !== requestGeneration.current) return;
      const message = describeApiError(error, 'This invoice could not be loaded.');
      setLoadError(message);
      toast.error('Failed to load invoice', { description: message });
    } finally {
      if (generation === requestGeneration.current) {
        setLoading(false);
      }
    }
  }, [id]);

  // A new invoice id invalidates everything in flight for the previous one.
  useEffect(() => {
    requestGeneration.current += 1;
    setLoading(true);
    setPaymentInfo(null);
    setVerifyTxHash('');
    setVerifyFieldError(null);
    setLoadError(null);
    dispatch({ type: 'INVOICE_LOADED', invoice: null });

    void loadInvoice();

    return () => {
      requestGeneration.current += 1;
    };
  }, [id, loadInvoice]);

  // Poll only while the answer is still unknown; `shouldPoll` owns that rule.
  useEffect(() => {
    if (!shouldPoll(payment)) return;

    const generation = requestGeneration.current;

    const intervalId = setInterval(async () => {
      try {
        const result = await invoiceApi.getById(id);
        if (generation !== requestGeneration.current) return;

        if (result.data.status !== 'PENDING') {
          dispatch({ type: 'POLL_RESULT', invoice: result.data });
          if (result.data.status === 'PAID') {
            toast.success('Payment confirmed!');
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, [payment, id]);

  const handlePaymentSuccess = async (txHash: string) => {
    toast.success('Payment sent! Verifying...');
    dispatch({ type: 'PAY_SENT', txHash });
    setTimeout(() => {
      void loadInvoice();
    }, 2000);
  };

  // Manual verification for payers who paid by QR or from another wallet.
  const handleVerify = async () => {
    // Shared contract (issue #224): reject the same input the server would,
    // with the same message, before spending a request.
    const hashCheck = checkTxHash(verifyTxHash);
    if (!hashCheck.ok) {
      // The message also lands under the field, where aria-invalid and
      // aria-describedby make it reachable from the input itself.
      setVerifyFieldError(hashCheck.error);
      toast.error(hashCheck.error);
      return;
    }
    const payer = normalizePayerDetails({ payerName, payerEmail });
    if (!payer.ok) {
      setVerifyFieldError(payer.error);
      toast.error(payer.error);
      return;
    }

    setVerifyFieldError(null);
    dispatch({ type: 'VERIFY_STARTED' });
    const generation = requestGeneration.current;

    try {
      toast.loading('Verifying transaction...', { id: 'verify-toast' });
      const result = await invoiceApi.verify(id, hashCheck.value, payer.value);
      if (generation !== requestGeneration.current) return;

      toast.success('Transaction verified!', { id: 'verify-toast' });
      dispatch({ type: 'VERIFY_SUCCEEDED', invoice: result?.data ?? null });
      void loadInvoice();
    } catch (error: any) {
      if (generation !== requestGeneration.current) return;

      console.error('Manual verification error:', error);
      const message = describeVerifyError(error);
      toast.error(message, { id: 'verify-toast' });
      dispatch({ type: 'VERIFY_FAILED', error: message });
    }
  };

  const copyInfo = async (text: string, label: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      toast.success(`${label} copied`);
    }
  };

  const handleDownloadPDF = () => {
    if (invoice) {
      openInvoicePDF(invoice as any);
      toast.success('Opening payment proof');
    }
  };

  const handleEmailShare = () => {
    if (!invoice) return;
    if (!invoice.customerEmail) {
      toast.error('No client email on this invoice');
      return;
    }
    shareInvoiceByEmail(invoice as any);
  };

  if (loading) {
    return (
      /*
       * A spinner is invisible to a screen reader. The status region gives the
       * wait a text equivalent, so the page is not simply silent while it
       * loads.
       */
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-screen bg-logo-pattern relative flex items-center justify-center"
      >
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
        <div className="relative" role="status" aria-live="polite">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full blur-2xl opacity-30"></div>
          <Loader2 className="w-16 h-16 animate-spin text-teal-800 relative z-10" aria-hidden="true" />
          <span className="sr-only">Loading this invoice.</span>
        </div>
      </main>
    );
  }

  if (!invoice) {
    return (
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-screen bg-logo-pattern relative flex items-center justify-center"
      >
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
        {/* role="alert" — the payer is blocked, and this replaced a spinner. */}
        <div className="card text-center max-w-md relative z-10" role="alert">
          <h1 className="text-2xl font-bold text-red-700 mb-2">Invoice Not Found</h1>
          <p className="text-gray-700">
            {loadError ?? 'The invoice you are looking for does not exist.'}
          </p>
        </div>
      </main>
    );
  }

  const horizonUrl =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET'
      ? 'https://stellar.expert/explorer/testnet'
      : 'https://stellar.expert/explorer/public';
  const isExpired = isExpiredInvoice(invoice.status);
  const showPaymentControls = shouldShowPaymentControls(
    invoice.status,
    invoice.paymentTxHash
  );

  const amountLabel = describeAmount(formatAmount(invoice.amount, 7), invoice.assetCode);

  return (
    <div className="min-h-screen bg-logo-pattern relative py-8 sm:py-12 px-4">
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>
      {/*
        The banner sits outside the page's content wrapper so it is a top-level
        landmark rather than a header nested inside a generic div.
      */}
      <header className="fixed top-0 left-0 right-0 z-50 premium-header border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="font-display text-2xl tracking-tight text-[var(--ink)]">
              Quittance
            </span>
          </Link>
          <nav className="flex items-center gap-3" aria-label="Main">
            {!userWallet ? (
              <WalletConnect onConnect={setUserWallet} />
            ) : (
              <UserProfile userWallet={userWallet} onDisconnect={() => setUserWallet(null)} />
            )}
          </nav>
        </div>
      </header>

      <div className="max-w-4xl mx-auto relative z-10">
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="pt-20">
        {/*
          These three lines were white text on `bg-logo-pattern`, which resolves
          to the near-white --paper colour — roughly 1.1:1, i.e. invisible to
          everyone, not only to users with low vision. They now use the ink and
          muted tokens like the rest of the app.
        */}
        <div className="text-center mb-10 sm:mb-12">
          <div className="inline-block mb-4 px-6 py-2 bg-white rounded-full border border-[var(--line)]">
            <span className="text-[var(--ink)] text-sm font-semibold tracking-wide">
              {isExpired ? 'Expired Invoice' : 'Secure Payment'}
            </span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-[var(--ink)] mb-3">
            {isExpired ? 'Invoice Expired' : 'Complete Payment'}
          </h1>
          <p className="text-xl text-[var(--muted)]">
            {isExpired ? 'Payment is no longer available' : 'Pay with your Stellar wallet'}
          </p>
        </div>

        {/*
          The pay page's async result region (issue #289). Verification and the
          three-second background poll both resolve without any keyboard event,
          so this panel announces the outcome and takes focus once it arrives.
        */}
        <div className="mb-6">
          <PaymentResultPanel state={payment} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
          <div className="card">
            <h2 className="text-3xl font-bold text-gray-900 mb-8">Payment Details</h2>

            <div className="space-y-5 mb-8">
              {/*
                The figure is rendered with `bg-clip-text text-transparent` and
                the asset code lives in a separate element, so this reads as a
                bare number followed by an unrelated word. One accessible name
                on the group replaces both.
              */}
              <div className="bg-gradient-to-br from-cyan-50 to-blue-50 border-2 border-cyan-200/50 rounded-2xl p-8 text-center shadow-lg">
                <p className="text-sm text-gray-600 mb-4 font-semibold uppercase tracking-wide" id="pay-amount-label">
                  {isExpired ? 'Invoice Amount' : 'Amount to Pay'}
                </p>
                {/*
                  One name carrying both the caption and the value: with
                  `aria-labelledby` as well, the reference would win and the
                  figure — which is aria-hidden below — would go unannounced.
                */}
                <div
                  className="flex items-center justify-center gap-4"
                  role="group"
                  aria-label={`${isExpired ? 'Invoice amount' : 'Amount to pay'}: ${amountLabel}`}
                >
                  <div className="relative" aria-hidden="true">
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full blur-lg opacity-40"></div>
                    <AssetLogo code={invoice.assetCode} size={50} showName={false} decorative />
                  </div>
                  <div aria-hidden="true">
                    <p className="text-5xl sm:text-6xl font-bold bg-gradient-to-r from-cyan-700 to-blue-700 bg-clip-text text-transparent">
                      {formatAmount(invoice.amount, 7)}
                    </p>
                    <p className="text-xl font-bold text-cyan-700 mt-2">
                      {invoice.assetCode}
                    </p>
                  </div>
                </div>
              </div>

              {invoice.description && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-1">Payment For</p>
                  <p className="text-gray-800 font-medium">{invoice.description}</p>
                </div>
              )}

              {(invoice.sellerName || invoice.sellerEmail) && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                  <p className="text-sm text-blue-700 font-semibold">Seller Information</p>
                  {invoice.sellerName && (
                    <div>
                      {/* blue-500 on blue-50 is 3.7:1 — under AA at this size. */}
                      <p className="text-xs text-blue-700">Name</p>
                      <p className="text-sm text-blue-800">{invoice.sellerName}</p>
                    </div>
                  )}
                  {invoice.sellerEmail && (
                    <div>
                      <p className="text-xs text-blue-700">Email</p>
                      <p className="text-sm text-blue-800">{invoice.sellerEmail}</p>
                    </div>
                  )}
                </div>
              )}

              {invoice.sellerName && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                  <p className="text-sm text-blue-700 font-semibold">Pay to</p>
                  <p className="text-lg font-bold text-blue-800">{invoice.sellerName}</p>
                  {invoice.sellerEmail && (
                    <p className="text-sm text-blue-700">{invoice.sellerEmail}</p>
                  )}
                </div>
              )}

              {/*
                The dot is the visual status cue and carries no text; it is
                hidden, and the wording comes from the shared `statusText` so
                the pay page, the dashboard badge and the detail page agree.
              */}
              <div className="border-b pb-4">
                <p className="text-sm text-gray-600 mb-1" id="pay-status-label">Status</p>
                <div
                  className="inline-flex items-center gap-2 mt-1"
                  role="status"
                  aria-live="polite"
                  aria-labelledby="pay-status-label"
                >
                  {invoice.status === 'PENDING' && (
                    <>
                      <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" aria-hidden="true"></span>
                      <span className="text-yellow-800 font-semibold">Waiting for Payment</span>
                    </>
                  )}
                  {invoice.status === 'PAID' && (
                    <>
                      <span className="w-2 h-2 bg-green-600 rounded-full" aria-hidden="true"></span>
                      <span className="text-green-700 font-semibold">Paid</span>
                    </>
                  )}
                  {isExpired && (
                    <>
                      <span className="w-2 h-2 bg-red-600 rounded-full" aria-hidden="true"></span>
                      <span className="text-red-700 font-semibold">Expired</span>
                    </>
                  )}
                  <span className="sr-only">{statusText(invoice.status).description}</span>
                </div>
              </div>

              {invoice.status === 'PENDING' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800 font-semibold mb-1" id="expires-in-label">Expires In</p>
                  <p className="text-blue-800 font-semibold text-lg" aria-labelledby="expires-in-label">
                    {getTimeRemaining(invoice.expiresAt)}
                  </p>
                </div>
              )}

              {invoice.status === 'PAID' && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-green-800 font-semibold mb-1" id="paid-at-label">Payment Completed</p>
                  <p className="text-green-800 font-semibold" aria-labelledby="paid-at-label">
                    {formatDate(invoice.paidAt)}
                  </p>
                </div>
              )}
            </div>

            {invoice.status === 'PAID' && (
              <div className="border-t pt-5 flex gap-2">
                <button
                  onClick={handleDownloadPDF}
                  className="btn btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" aria-hidden="true" />
                  Download Proof
                </button>
                {invoice.customerEmail && (
                  // Icon-only: `title` is not an accessible name, so this button
                  // was announced as just "button".
                  <button
                    onClick={handleEmailShare}
                    className="btn btn-outline flex items-center justify-center gap-2 px-4"
                    aria-label={`Email the payment proof to ${invoice.customerEmail}`}
                  >
                    <Mail className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            {invoice.status === 'PENDING' && (
              /*
                Three visually identical copy buttons. Each `aria-label` names
                what it copies, otherwise a screen reader reads "button, button,
                button" and the values themselves are `<code>` blocks with no
                programmatic tie to their headings.
              */
              <div className="bg-gray-50 p-4 rounded-lg space-y-3 border">
                <h3 className="font-semibold text-gray-900 mb-3">Payment Information</h3>

                <div>
                  <p className="text-xs text-gray-600 mb-1" id="destination-label">Destination Address</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white p-2 rounded border truncate" aria-labelledby="destination-label">
                      {invoice.sellerPublicKey}
                    </code>
                    <button
                      onClick={() => copyInfo(invoice.sellerPublicKey, 'Address')}
                      className="p-2 hover:bg-gray-200 rounded transition"
                      aria-label="Copy destination address"
                    >
                      <Copy className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-600 mb-1" id="memo-label">Memo (Required)</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white p-2 rounded border font-semibold" aria-labelledby="memo-label">
                      {invoice.memo}
                    </code>
                    <button
                      onClick={() => copyInfo(invoice.memo, 'Memo')}
                      className="p-2 hover:bg-gray-200 rounded transition"
                      aria-label="Copy payment memo"
                    >
                      <Copy className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-600 mb-1" id="exact-amount-label">Exact Amount</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white p-2 rounded border font-semibold" aria-labelledby="exact-amount-label">
                      {invoice.amount} {invoice.assetCode}
                    </code>
                    <button
                      onClick={() => copyInfo(invoice.amount.toString(), 'Amount')}
                      className="p-2 hover:bg-gray-200 rounded transition"
                      aria-label={`Copy exact amount, ${amountLabel}`}
                    >
                      <Copy className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isExpired && (
              <div className="bg-gray-50 p-4 rounded-lg border">
                <h3 className="font-semibold text-gray-900 mb-3">Invoice Reference</h3>
                <p className="text-xs text-gray-600 mb-1" id="expired-memo-label">Memo</p>
                <code className="block text-xs bg-white p-2 rounded border font-semibold" aria-labelledby="expired-memo-label">
                  {invoice.memo}
                </code>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {invoice.status === 'PAID' && (
              <PaymentReceipt invoice={invoice} />
            )}

            {isExpired && (
              <div className="card text-center py-8">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-red-100 rounded-full mb-4">
                  {/* Decorative cross: the heading below already says it. */}
                  <svg className="w-12 h-12 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-red-700 mb-2">Payment Expired</h3>
                <p className="text-gray-700">
                  {statusText('EXPIRED').description}
                </p>
              </div>
            )}

            {showPaymentControls && (
              <>
                <div className="card">
                  <h3 className="text-lg font-semibold text-center mb-4">Scan QR Code</h3>
                  <QRCodeDisplay
                    value={paymentInfo?.stellarQrCode || paymentInfo?.paymentUrl}
                    title=""
                    size={220}
                    description={`a request to pay ${amountLabel} with memo ${invoice.memo}`}
                  />
                  <p className="text-sm text-gray-700 text-center mt-4">
                    Scan with your Stellar wallet app to pay instantly
                  </p>
                </div>

                <div className="card">
                  <h3 className="text-xl font-semibold text-center mb-4">Pay with Wallet</h3>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                    <p className="text-sm text-blue-800 font-semibold mb-2" id="how-to-pay-label">How to Pay:</p>
                    <ol className="text-sm text-blue-800 space-y-1.5 list-decimal list-inside" aria-labelledby="how-to-pay-label">
                      <li>Connect your Freighter wallet</li>
                      <li>Select Pay with Freighter</li>
                      <li>Confirm the transaction</li>
                    </ol>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    <div>
                      <label htmlFor="payer-name" className="block text-sm font-medium text-gray-700 mb-1">
                        Your name (optional)
                      </label>
                      <input
                        id="payer-name"
                        type="text"
                        value={payerName}
                        onChange={(event) => setPayerName(event.target.value)}
                        maxLength={255}
                        autoComplete="name"
                        className="input text-sm"
                        placeholder="Name on payment proof"
                      />
                    </div>
                    <div>
                      <label htmlFor="payer-email" className="block text-sm font-medium text-gray-700 mb-1">
                        Your email (optional)
                      </label>
                      <input
                        id="payer-email"
                        type="email"
                        value={payerEmail}
                        onChange={(event) => setPayerEmail(event.target.value)}
                        maxLength={255}
                        autoComplete="email"
                        className="input text-sm"
                        placeholder="Email on payment proof"
                      />
                    </div>
                  </div>

                  <div className="flex justify-center mb-4">
                    <WalletConnect onConnect={setUserWallet} />
                  </div>

                  <PaymentButton
                    destination={invoice.sellerPublicKey}
                    amount={invoice.amount.toString()}
                    memo={invoice.memo}
                    assetCode={invoice.assetCode}
                    assetIssuer={invoice.assetIssuer}
                    invoiceId={invoice.id}
                    payerName={payerName}
                    payerEmail={payerEmail}
                    onStart={() => dispatch({ type: 'PAY_STARTED' })}
                    onSuccess={handlePaymentSuccess}
                    onError={(message) => dispatch({ type: 'PAY_FAILED', error: message })}
                  />

                  <div className="mt-6 pt-4 border-t text-center">
                    <p className="text-xs text-gray-600">Secure payment on Stellar blockchain</p>
                  </div>
                </div>

                {/*
                  Manual verification. The input had no label at all, and its
                  rejection message existed only as a toast — so a payer who
                  pasted a bad hash was told nothing they could go back to. It
                  is now a labelled form with the error wired to the field.
                */}
                <form
                  className="card"
                  aria-labelledby="verify-heading"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleVerify();
                  }}
                >
                  <h3 id="verify-heading" className="text-lg font-semibold text-center mb-4">
                    Already paid? Verify your transaction
                  </h3>
                  <label htmlFor="verify-tx-hash" className="label">
                    Stellar transaction hash
                  </label>
                  <div className="flex items-center gap-2 mb-1">
                    <input
                      id="verify-tx-hash"
                      name="txHash"
                      type="text"
                      placeholder="Transaction hash (64 chars)"
                      value={verifyTxHash}
                      onChange={(e) => {
                        setVerifyTxHash(e.target.value);
                        if (verifyFieldError) setVerifyFieldError(null);
                      }}
                      maxLength={64}
                      aria-invalid={Boolean(verifyFieldError)}
                      aria-describedby={
                        verifyFieldError ? 'verify-tx-hash-error' : 'verify-tx-hash-hint'
                      }
                      className="input flex-1"
                    />
                    <button
                      type="submit"
                      disabled={verifying}
                      aria-busy={verifying}
                      className="btn btn-primary flex items-center gap-2"
                    >
                      {verifying ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                          Verifying...
                        </>
                      ) : (
                        <>Verify</>
                      )}
                    </button>
                  </div>
                  {verifyFieldError ? (
                    <p id="verify-tx-hash-error" role="alert" className="field-hint text-red-700">
                      {verifyFieldError}
                    </p>
                  ) : (
                    <p id="verify-tx-hash-hint" className="field-hint">
                      Enter the 64-character Stellar transaction hash you received. If
                      verification succeeds, the invoice will show the receipt and download
                      options.
                    </p>
                  )}
                </form>
              </>
            )}
          </div>
        </div>

        </main>
      </div>
    </div>
  );
}
