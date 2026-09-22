'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, AlertTriangle, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import PayPageHeader from '@/components/PayPageHeader';
import PayAmountBlock from '@/components/PayAmountBlock';
import PayMemoBlock from '@/components/PayMemoBlock';
import PayVerifyPanel from '@/components/PayVerifyPanel';
import PayProofPanel from '@/components/PayProofPanel';
import PayMonitorPanel from '@/components/PayMonitorPanel';
import PaymentResultPanel from '@/components/PaymentResultPanel';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import PaymentButton from '@/components/PaymentButton';
import WalletConnect from '@/components/WalletConnect';
import FreighterInstallPrompt from '@/components/FreighterInstallPrompt';
import MobilePaymentFallback from '@/components/MobilePaymentFallback';
import ApiErrorState from '@/components/ApiErrorState';
import { copyToClipboard, formatAmount } from '@/lib/utils';
import { emailPaymentProof, openInvoicePDF, shareInvoiceByEmail } from '@/lib/export';
import { getPayPageView, getPayPageWalletGate } from '@/lib/payment-page-state';
import { PAYMENT_STATUS_POLL_INTERVAL_MS } from '@/lib/api';
import { memoPaymentHint } from '@/lib/pay-memo-hint';
import { usePaymentPage } from '@/lib/use-payment-page';
import { MAIN_CONTENT_ID, describeAmount, statusText } from '@/lib/a11y';
import { useWalletStore } from '@/lib/store';
import { EXPECTED_WALLET_NETWORK, NETWORK_DISPLAY_NAME, loadAccount, addTrustline } from '@/lib/stellar';
import { detectDevice } from '@/lib/mobile-detection';
import { checkPayerTrustline, isNativeAsset, type TrustlinePreflightResult } from '@/lib/trustline-preflight';
import type { PayPageInvoice } from '@/components/pay-page.types';

function PayPageLoaded({
  invoice,
  page,
}: {
  invoice: PayPageInvoice;
  page: ReturnType<typeof usePaymentPage>;
}) {
  const walletSession = useWalletStore();
  const isWrongNetwork = useWalletStore((s) => s.isWrongNetwork);
  const [isMobile, setIsMobile] = useState(false);
  const [showDesktopWalletAnyway, setShowDesktopWalletAnyway] = useState(false);
  const [trustlinePreflight, setTrustlinePreflight] = useState<TrustlinePreflightResult | null>(null);
  const [isCheckingTrustline, setIsCheckingTrustline] = useState(false);
  const [isAddingTrustline, setIsAddingTrustline] = useState(false);

  useEffect(() => {
    setIsMobile(detectDevice().isMobile);
  }, []);

  const view = getPayPageView(invoice);
  const walletPaymentGate = getPayPageWalletGate(
    invoice,
    walletSession,
    EXPECTED_WALLET_NETWORK
  );

  const runTrustlineCheck = useCallback(async () => {
    if (
      !invoice ||
      isNativeAsset(invoice.assetCode) ||
      !walletSession.publicKey ||
      isWrongNetwork ||
      !walletPaymentGate.ready
    ) {
      setTrustlinePreflight(null);
      return;
    }
    setIsCheckingTrustline(true);
    try {
      const result = await checkPayerTrustline({
        loadAccountFn: loadAccount,
        publicKey: walletSession.publicKey,
        assetCode: invoice.assetCode,
        assetIssuer: invoice.assetIssuer,
      });
      setTrustlinePreflight(result);
    } finally {
      setIsCheckingTrustline(false);
    }
  }, [
    invoice,
    walletSession.publicKey,
    isWrongNetwork,
    walletPaymentGate.ready,
  ]);

  useEffect(() => {
    void runTrustlineCheck();
  }, [runTrustlineCheck]);

  const handleAddTrustline = async () => {
    if (!invoice?.assetCode || !invoice?.assetIssuer) {
      return;
    }
    setIsAddingTrustline(true);
    const toastId = 'trustline-add';
    toast.loading(`Establishing ${invoice.assetCode} trustline in Freighter...`, {
      id: toastId,
    });
    try {
      await addTrustline(invoice.assetCode, invoice.assetIssuer);
      toast.success(`${invoice.assetCode} trustline established`, { id: toastId });
      await runTrustlineCheck();
    } catch (err: any) {
      toast.error('Failed to add trustline', {
        id: toastId,
        description: err?.message || 'Transaction was rejected or cancelled.',
      });
    } finally {
      setIsAddingTrustline(false);
    }
  };

  const copy = async (value: string, label: string) => {
    if (await copyToClipboard(value)) toast.success(`${label} copied`);
  };
  const download = () => {
    openInvoicePDF(invoice);
    toast.success('Opening payment proof');
  };
  const email = () => {
    try {
      if (invoice.status === 'PAID') {
        emailPaymentProof(invoice);
      } else {
        shareInvoiceByEmail(invoice);
      }
      toast.success('Opening email client');
    } catch (err: any) {
      toast.error(err?.message || 'No recipient email on this invoice');
    }
  };

  const amountLabel = describeAmount(formatAmount(invoice.amount, 7), invoice.assetCode);

  return (
    <div className="min-h-screen bg-logo-pattern relative py-8 sm:py-12 px-4">
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>
      <PayPageHeader
        wallet={page.wallet}
      />
      <div className="max-w-4xl mx-auto relative z-10">
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="pt-20">
          {page.loadError && (
            <div className="mb-6">
              <ApiErrorState message={page.loadError} onRetry={() => void page.reload()} compact />
            </div>
          )}
          <div className="text-center mb-10 sm:mb-12">
            <p className="pay-page-kicker">
              {view.expired ? 'Expired Invoice' : view.cancelled ? 'Cancelled Invoice' : 'Secure Payment'}
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-[var(--ink)] mb-3">
              {view.expired ? 'Invoice Expired' : view.cancelled ? 'Invoice Cancelled' : 'Complete Payment'}
            </h1>
            <p className="text-xl text-[var(--muted)]">
              {view.expired
                ? 'Payment is no longer available'
                : view.cancelled
                ? 'This invoice was cancelled by the seller'
                : 'Pay with your Stellar wallet'}
            </p>
          </div>

          <div className="mb-6">
            <PaymentResultPanel state={page.payment} />
          </div>

          {invoice.assetCode && invoice.assetCode !== 'XLM' && view.showPaymentControls && (
            <>
              {(!walletPaymentGate.ready || isWrongNetwork || !trustlinePreflight) && (
                <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <span className="font-semibold block mb-0.5">{invoice.assetCode} Trustline Notice</span>
                    <span>Please ensure your Stellar wallet has established a trustline for {invoice.assetCode} before submitting payment.</span>
                  </div>
                </div>
              )}
              {walletPaymentGate.ready && !isWrongNetwork && trustlinePreflight?.status === 'trustline_exists' && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-6 bg-emerald-50 border border-emerald-300 rounded-lg p-4 text-sm text-emerald-900 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
                    <div>
                      <span className="font-semibold block">{invoice.assetCode} Trustline Verified</span>
                      <span className="text-xs text-emerald-800">Your connected wallet can receive and hold this asset.</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runTrustlineCheck()}
                    disabled={isCheckingTrustline}
                    className="text-xs text-emerald-700 hover:text-emerald-900 underline flex items-center gap-1 shrink-0"
                    aria-label={`Recheck ${invoice.assetCode} trustline`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingTrustline ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span>Recheck</span>
                  </button>
                </div>
              )}
              {walletPaymentGate.ready && !isWrongNetwork && trustlinePreflight?.status === 'missing_trustline' && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mb-6 bg-amber-50 border border-amber-300 rounded-lg p-4 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <span className="font-semibold block mb-0.5">{invoice.assetCode} Trustline Required</span>
                      <span className="text-xs sm:text-sm text-amber-800">{trustlinePreflight.message}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleAddTrustline}
                      disabled={isAddingTrustline}
                      className="btn btn-primary text-xs sm:text-sm px-3 py-1.5 flex items-center gap-1.5"
                    >
                      {isAddingTrustline ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          <span>Adding...</span>
                        </>
                      ) : (
                        <span>Add {invoice.assetCode} Trustline</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runTrustlineCheck()}
                      disabled={isCheckingTrustline}
                      className="btn btn-secondary text-xs sm:text-sm px-3 py-1.5 flex items-center gap-1"
                      aria-label="Recheck trustline"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isCheckingTrustline ? 'animate-spin' : ''}`} aria-hidden="true" />
                      <span>Recheck</span>
                    </button>
                  </div>
                </div>
              )}
              {walletPaymentGate.ready && !isWrongNetwork && trustlinePreflight?.status === 'no_account' && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mb-6 bg-amber-50 border border-amber-300 rounded-lg p-4 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <span className="font-semibold block mb-0.5">Account Not Funded</span>
                      <span className="text-xs sm:text-sm text-amber-800">{trustlinePreflight.message}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runTrustlineCheck()}
                    disabled={isCheckingTrustline}
                    className="btn btn-secondary text-xs sm:text-sm px-3 py-1.5 flex items-center gap-1 shrink-0"
                    aria-label="Recheck account status"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingTrustline ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span>Recheck</span>
                  </button>
                </div>
              )}
              {walletPaymentGate.ready && !isWrongNetwork && trustlinePreflight?.status === 'outage' && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mb-6 bg-red-50 border border-red-300 rounded-lg p-4 text-sm text-red-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <span className="font-semibold block mb-0.5">Stellar Network Unavailable</span>
                      <span className="text-xs sm:text-sm text-red-800">{trustlinePreflight.message}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runTrustlineCheck()}
                    disabled={isCheckingTrustline}
                    className="btn btn-secondary text-xs sm:text-sm px-3 py-1.5 flex items-center gap-1 shrink-0"
                    aria-label="Retry network check"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingTrustline ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span>Retry Check</span>
                  </button>
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
            <div className="space-y-6">
              <PayAmountBlock invoice={invoice} />
              <PayMemoBlock invoice={invoice} onCopy={copy} />
              <p className="text-xs text-gray-600">
                {memoPaymentHint(invoice.memo)}
              </p>
            </div>
            <div className="space-y-6">
              {view.showProof && (
                <PayProofPanel invoice={invoice} onDownload={download} onEmail={email} />
              )}
              {view.expired && (
                <div className="card text-center py-8">
                  <div className="inline-flex items-center justify-center w-20 h-20 bg-red-100 rounded-full mb-4">
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
              {view.cancelled && (
                <div className="card text-center py-8">
                  <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
                    <svg className="w-12 h-12 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-700 mb-2">Invoice Cancelled</h3>
                  <p className="text-gray-700">
                    {statusText('CANCELLED').description}
                  </p>
                </div>
              )}
              {view.showPaymentControls && (
                <>
                  <section aria-label="Stellar payment QR code" className="card text-center">
                    <h3 className="text-lg font-semibold mb-4">Scan QR Code</h3>
                    <QRCodeDisplay
                      value={page.paymentInfo?.stellarQrCode || page.paymentInfo?.paymentUrl || ''}
                      title=""
                      size={220}
                      description={`a request to pay ${amountLabel} with memo ${invoice.memo}`}
                    />
                    <p className="text-sm text-gray-700 text-center mt-4">
                      Scan with your Stellar wallet app to pay instantly
                    </p>
                  </section>
                  {isMobile && !showDesktopWalletAnyway ? (
                    <div className="space-y-4">
                      <MobilePaymentFallback
                        destination={invoice.sellerPublicKey}
                        amount={String(invoice.amount)}
                        assetCode={invoice.assetCode}
                        assetIssuer={invoice.assetIssuer}
                        memo={invoice.memo}
                        paymentUrl={
                          page.paymentInfo?.paymentUrl ||
                          (typeof window !== 'undefined' ? window.location.href : '')
                        }
                        onCopy={(text, label) => {
                          page.dispatch({ type: 'COPIED', key: label });
                        }}
                      />
                      <div className="text-center">
                        <button
                          type="button"
                          onClick={() => setShowDesktopWalletAnyway(true)}
                          className="text-xs text-gray-500 hover:text-gray-700 underline"
                        >
                          Show desktop extension controls
                        </button>
                      </div>
                    </div>
                  ) : (
                    <section aria-labelledby="wallet-pay-title" className="card">
                      <h3 id="wallet-pay-title" className="text-xl font-semibold text-center mb-4">
                        Pay with Wallet
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                        <PayerField
                          id="payer-name"
                          label="Your name (optional)"
                          value={page.payerName}
                          onChange={page.setPayerName}
                        />
                        <PayerField
                          id="payer-email"
                          label="Your email (optional)"
                          value={page.payerEmail}
                          onChange={page.setPayerEmail}
                          type="email"
                        />
                      </div>
                      <div className="flex justify-center mb-4">
                        <WalletConnect />
                      </div>
                      {!walletPaymentGate.ready && walletPaymentGate.action !== 'none' && (
                        <FreighterInstallPrompt
                          gate={walletPaymentGate}
                          action={<WalletConnect />}
                          compact
                          className="mb-4"
                        />
                      )}
                      {walletPaymentGate.ready && isWrongNetwork && (
                        <div
                          role="alert"
                          className="mb-4 p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-center gap-3 text-sm text-amber-900"
                        >
                          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
                          <div>
                            <p className="font-semibold">Wrong Stellar Network</p>
                            <p className="mt-0.5 text-xs text-amber-800">
                              Your wallet is connected to a different network. Please switch to {NETWORK_DISPLAY_NAME} in Freighter, then reconnect to pay.
                            </p>
                          </div>
                        </div>
                      )}
                      {!(isWrongNetwork && walletPaymentGate.ready) && (
                      <PaymentButton
                        destination={invoice.sellerPublicKey}
                        amount={String(invoice.amount)}
                        memo={invoice.memo}
                        assetCode={invoice.assetCode}
                        assetIssuer={invoice.assetIssuer}
                        invoiceId={invoice.id}
                        payerName={page.payerName}
                        payerEmail={page.payerEmail}
                        invoiceStatus={view.expired ? 'EXPIRED' : invoice.status}
                        trustlineGate={trustlinePreflight ?? undefined}
                        onStart={() => page.dispatch({ type: 'PAY_STARTED' })}
                        onSuccess={(txHash) => {
                          page.dispatch({ type: 'PAY_SENT', txHash });
                          void page.reload();
                        }}
                        onError={(error) => page.dispatch({ type: 'PAY_FAILED', error })}
                      />
                      )}
                      {isMobile && showDesktopWalletAnyway && (
                        <div className="mt-4 text-center">
                          <button
                            type="button"
                            onClick={() => setShowDesktopWalletAnyway(false)}
                            className="text-xs text-gray-500 hover:text-gray-700 underline"
                          >
                            Return to mobile guidance
                          </button>
                        </div>
                      )}
                    </section>
                  )}
                  <PayMonitorPanel
                    active={page.monitoring}
                    intervalMs={
                      page.paymentInfo?.statusPollingIntervalMs ?? PAYMENT_STATUS_POLL_INTERVAL_MS
                    }
                  />
                  <PayVerifyPanel
                    txHash={page.txHash}
                    verifying={page.verifying}
                    onChange={page.setTxHash}
                    onVerify={() => void page.verify()}
                  />
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Renders the public payment page for an invoice.
 */
export default function PaymentPage() {
  const id = useParams().id as string;
  const page = usePaymentPage(id);

  if (page.loading) {
    return (
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

  if (!page.invoice) {
    if (page.loadError) {
      return (
        <div className="min-h-screen bg-logo-pattern flex items-center justify-center px-4">
          <div className="max-w-lg w-full">
            <ApiErrorState message={page.loadError} onRetry={() => void page.reload()} />
          </div>
        </div>
      );
    }
    return (
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-screen bg-logo-pattern relative flex items-center justify-center"
      >
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
        <div className="card text-center max-w-md relative z-10" role="alert">
          <h1 className="text-2xl font-bold text-red-700 mb-2">Invoice Not Found</h1>
          <p className="text-gray-700">
            {page.loadError ?? 'The invoice you are looking for does not exist.'}
          </p>
        </div>
      </main>
    );
  }

  return <PayPageLoaded invoice={page.invoice} page={page} />;
}

function PayerField({
  id,
  label,
  value,
  onChange,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label htmlFor={id} className="text-sm font-medium text-gray-700">
      {label}
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={255}
        className="input text-sm mt-1"
      />
    </label>
  );
}
