'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiErrorMessage, invoiceApi, isApiUnavailableError } from '@/lib/api';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import PaymentStatus from '@/components/PaymentStatus';
import WalletConnect from '@/components/WalletConnect';
import UserProfile from '@/components/UserProfile';
import FreighterInstallPrompt from '@/components/FreighterInstallPrompt';
import PaymentReceipt from '@/components/PaymentReceipt';
import AssetLogo from '@/components/AssetLogo';
import { formatAmount, formatDate, getTimeRemaining, copyToClipboard } from '@/lib/utils';
import { MAIN_CONTENT_ID, describeAmount, statusText } from '@/lib/a11y';
import {
  ArrowLeft,
  Share2,
  Loader2,
  X,
  Mail,
  Check,
  Copy,
  ExternalLink,
  ShieldAlert,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useWalletStore } from '@/lib/store';
import ApiErrorState from '@/components/ApiErrorState';
import { effectiveInvoiceStatus } from '@/lib/invoice-lifecycle';
import { invoiceSharePath } from '@/lib/invoice-share-path';
import { shareInvoiceByEmail, emailPaymentProof, openInvoicePDF } from '@/lib/export';
import { canSendInvoiceEmail, canSendProofEmail } from '@/lib/mailto-delivery';
import { EXPECTED_WALLET_NETWORK, getExplorerTransactionUrl } from '@/lib/stellar';
import { walletGate } from '@/lib/freighter-availability';
import { buildHorizonTxUrl } from '@/lib/explorer-tx-link';

/**
 * Seller invoice detail view with scoping to the invoice owner,
 * lifecycle status timeline, payment link sharing, and management actions.
 */
export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const {
    publicKey,
    connected,
    network,
    freighterAvailable,
  } = useWalletStore();

  const gate = walletGate(
    { freighterAvailable, connected, publicKey, network },
    EXPECTED_WALLET_NETWORK
  );
  const userWallet = gate.ready ? publicKey : null;

  const [invoice, setInvoice] = useState<any>(null);
  const [paymentInfo, setPaymentInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lifecycleNow, setLifecycleNow] = useState(() => Date.now());
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const statusPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setLifecycleNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadInvoice = useCallback(async () => {
    setLoadError(null);
    try {
      const [invoiceResult, paymentResult] = await Promise.allSettled([
        invoiceApi.getById(id),
        invoiceApi.getPaymentInfo(id),
      ]);

      if (invoiceResult.status === 'rejected') throw invoiceResult.reason;
      setInvoice(invoiceResult.value.data);
      if (paymentResult.status === 'fulfilled') {
        setPaymentInfo(paymentResult.value.data);
      } else {
        setLoadError(apiErrorMessage(paymentResult.reason));
      }
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to load invoice');
      if (isApiUnavailableError(error)) setLoadError(message);
      toast.error(message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const paymentPath = invoice ? invoiceSharePath(invoice.id) : `/pay/${id}`;
  const paymentUrl = `${origin}${paymentPath}`;

  const handleCopyPaymentUrl = async () => {
    const success = await copyToClipboard(paymentUrl);
    if (success) {
      setCopiedLink(true);
      toast.success('Payment link copied to clipboard');
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      toast.error('Failed to copy payment link');
    }
  };

  const handleCopyInvoiceId = async () => {
    if (!invoice) return;
    const success = await copyToClipboard(invoice.id);
    if (success) {
      setCopiedId(true);
      toast.success('Invoice ID copied to clipboard');
      setTimeout(() => setCopiedId(false), 2000);
    } else {
      toast.error('Failed to copy invoice ID');
    }
  };

  const handleShare = async () => {
    if (!invoice) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Quittance Invoice',
          text: `Pay ${invoice.amount} ${invoice.assetCode}`,
          url: paymentUrl,
        });
      } catch {
      }
    } else {
      await handleCopyPaymentUrl();
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this invoice?')) return;
    try {
      await invoiceApi.cancel(id, userWallet || invoice?.sellerPublicKey);
      toast.success('Invoice cancelled');
      await loadInvoice();
      statusPanelRef.current?.focus();
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to cancel invoice');
      if (isApiUnavailableError(error)) setLoadError(message);
      toast.error(message);
    }
  };

  const handleEmailInvoice = () => {
    if (!invoice) return;
    shareInvoiceByEmail(invoice);
    toast.success('Opening email client');
  };

  const handleEmailProof = () => {
    if (!invoice) return;
    emailPaymentProof(invoice);
    toast.success('Opening email client');
  };

  if (loading) {
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

  if (!invoice) {
    if (loadError) {
      return (
        <div className="min-h-screen bg-logo-pattern flex items-center justify-center px-4">
          <main id={MAIN_CONTENT_ID} tabIndex={-1} className="max-w-lg w-full">
            <ApiErrorState message={loadError} onRetry={() => void loadInvoice()} />
          </main>
        </div>
      );
    }
    return (
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-screen bg-logo-pattern relative flex items-center justify-center px-4"
      >
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
        <div className="card text-center max-w-md relative z-10" role="alert">
          <h1 className="text-2xl font-bold text-red-700 mb-2">Invoice Not Found</h1>
          <p className="text-gray-700">
            {loadError ?? 'The invoice you are looking for does not exist.'}
          </p>
          <Link href="/dashboard" className="btn btn-primary inline-flex items-center gap-2 mt-6">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (!gate.ready || !publicKey) {
    return (
      <div className="min-h-screen bg-logo-pattern relative py-8 sm:py-12 px-4 flex items-center justify-center">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="relative z-10 w-full max-w-lg"
        >
          <div className="card text-center py-12">
            <FileText className="w-16 h-16 text-cyan-600 mx-auto mb-4" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Connect Seller Wallet</h1>
            <p className="text-gray-600 mb-6">
              Connect the wallet that created this invoice to view its status, copy payment links, and manage this invoice.
            </p>
            <FreighterInstallPrompt
              gate={gate}
              action={<WalletConnect />}
              className="mt-4"
            />
          </div>
        </main>
      </div>
    );
  }

  if (invoice.sellerPublicKey && publicKey && invoice.sellerPublicKey !== publicKey) {
    return (
      <div className="min-h-screen bg-logo-pattern relative py-8 sm:py-12 px-4 flex items-center justify-center">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="relative z-10 w-full max-w-lg"
        >
          <div className="card text-center py-12" role="alert">
            <ShieldAlert className="w-16 h-16 text-red-600 mx-auto mb-4" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-red-700 mb-2">Access Denied</h1>
            <p className="text-gray-700 mb-6">
              You do not have permission to view this invoice. This invoice belongs to another seller wallet.
            </p>
            <Link href="/dashboard" className="btn btn-primary inline-flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back to Dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const effectiveStatus = (effectiveInvoiceStatus(invoice, lifecycleNow) || invoice.status) as
    'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

  const explorerUrl = invoice.paymentTxHash
    ? (buildHorizonTxUrl(invoice.paymentTxHash, network === 'PUBLIC' ? 'public' : 'testnet') ??
       getExplorerTransactionUrl(invoice.paymentTxHash))
    : null;

  return (
    <div className="min-h-screen bg-logo-pattern relative py-8 sm:py-12 px-4">
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>

      <header className="fixed top-0 left-0 right-0 z-50 premium-header border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="btn btn-outline flex items-center gap-2"
              aria-label="Go back to the previous page"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              <span className="hidden sm:inline">Back</span>
            </button>
            <Link href="/" className="hover:opacity-90 transition-opacity">
              <span className="font-display text-xl tracking-tight text-[var(--ink)]">Quittance</span>
            </Link>
          </div>

          <nav className="flex items-center gap-3" aria-label="Invoice actions">
            <UserProfile userWallet={publicKey} />
            {effectiveStatus === 'PENDING' && (
              <div className="flex items-center gap-2">
                {canSendInvoiceEmail(invoice) && (
                  <button
                    onClick={handleEmailInvoice}
                    className="btn btn-outline flex items-center gap-2"
                    aria-label={`Email invoice to ${invoice.customerEmail}`}
                  >
                    <Mail className="w-5 h-5" aria-hidden="true" />
                    <span className="hidden sm:inline">Email</span>
                  </button>
                )}
                <button
                  onClick={handleShare}
                  className="btn btn-primary flex items-center gap-2"
                  aria-label="Share this invoice"
                >
                  <Share2 className="w-5 h-5" aria-hidden="true" />
                  <span className="hidden sm:inline">Share</span>
                </button>
                <button
                  onClick={handleCancel}
                  className="btn btn-destructive flex items-center gap-2"
                  aria-label="Cancel this invoice"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                  <span className="hidden sm:inline">Cancel</span>
                </button>
              </div>
            )}
            {effectiveStatus === 'PAID' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openInvoicePDF(invoice)}
                  className="btn btn-primary flex items-center gap-2"
                  aria-label="Download payment proof PDF"
                >
                  <FileText className="w-5 h-5" aria-hidden="true" />
                  <span className="hidden sm:inline">PDF Proof</span>
                </button>
                {canSendProofEmail(invoice) && (
                  <button
                    onClick={handleEmailProof}
                    className="btn btn-outline flex items-center gap-2"
                    aria-label="Email payment proof to client"
                  >
                    <Mail className="w-5 h-5" aria-hidden="true" />
                    <span className="hidden sm:inline">Email Proof</span>
                  </button>
                )}
              </div>
            )}
          </nav>
        </div>
      </header>

      <div className="max-w-5xl mx-auto relative z-10">
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="pt-20">
          <h1 className="sr-only">
            Invoice for {describeAmount(formatAmount(invoice.amount, 7), invoice.assetCode)}
          </h1>

          {loadError && (
            <div className="mb-6">
              <ApiErrorState message={loadError} onRetry={() => void loadInvoice()} compact />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
            <div className="card">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Invoice Details</h2>
                <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-gray-50 text-gray-700 border-gray-200">
                  {statusText(effectiveStatus).label}
                </span>
              </div>

              <dl className="space-y-5">
                <div className="bg-gradient-to-br from-gray-50 to-slate-50 p-5 rounded-2xl border border-gray-200/50">
                  <dt className="text-xs text-gray-600 mb-2 font-semibold uppercase tracking-wide">Invoice ID</dt>
                  <dd className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm text-gray-900 break-all">{invoice.id}</span>
                    <button
                      type="button"
                      onClick={handleCopyInvoiceId}
                      className="text-xs text-cyan-700 hover:text-cyan-800 font-medium inline-flex items-center gap-1 shrink-0"
                      aria-label="Copy invoice ID to clipboard"
                    >
                      {copiedId ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-green-700" aria-hidden="true" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Copy ID</span>
                        </>
                      )}
                    </button>
                  </dd>
                </div>

                <div className="bg-gradient-to-br from-cyan-50 to-blue-50 p-6 rounded-2xl border-2 border-cyan-200/50 shadow-lg">
                  <dt className="text-xs text-gray-600 mb-3 font-semibold uppercase tracking-wide">Amount</dt>
                  <dd className="flex items-center gap-3 text-4xl sm:text-5xl font-bold bg-gradient-to-r from-cyan-700 to-blue-700 bg-clip-text text-transparent">
                    <AssetLogo code={invoice.assetCode || 'XLM'} size={32} showName={false} decorative />
                    <span aria-hidden="true">
                      {formatAmount(invoice.amount, 7)} <span className="text-2xl">{invoice.assetCode || 'XLM'}</span>
                    </span>
                    <span className="sr-only">
                      {describeAmount(formatAmount(invoice.amount, 7), invoice.assetCode || 'XLM')}
                    </span>
                  </dd>
                </div>

                {invoice.description && (
                  <div className="border-b pb-4">
                    <dt className="text-sm text-gray-600 mb-1">Description</dt>
                    <dd className="text-gray-900">{invoice.description}</dd>
                  </div>
                )}

                {invoice.customerName && (
                  <div className="border-b pb-4">
                    <dt className="text-sm text-gray-600 mb-1">Client</dt>
                    <dd className="text-gray-900">{invoice.customerName}</dd>
                  </div>
                )}

                {invoice.customerEmail && (
                  <div className="border-b pb-4">
                    <dt className="text-sm text-gray-600 mb-1">Client Email</dt>
                    <dd className="text-gray-900">{invoice.customerEmail}</dd>
                  </div>
                )}

                <div className="border-b pb-4">
                  <dt className="text-sm text-gray-600 mb-1">Memo</dt>
                  <dd className="font-mono text-sm text-gray-900">{invoice.memo}</dd>
                </div>

                <div className="border-b pb-4">
                  <dt className="text-sm text-gray-600 mb-1">Created</dt>
                  <dd className="text-gray-900">{formatDate(invoice.createdAt)}</dd>
                </div>

                {effectiveStatus === 'EXPIRED' && (
                  <div className="border-b pb-4">
                    <dt className="text-sm text-gray-600 mb-1">Expired At</dt>
                    <dd className="text-red-700 font-semibold">{formatDate(invoice.expiresAt)}</dd>
                  </div>
                )}

                {effectiveStatus === 'PENDING' && (
                  <div className="border-b pb-4">
                    <dt className="text-sm text-gray-600 mb-1">Expires In</dt>
                    <dd className="text-gray-900 font-semibold">
                      {getTimeRemaining(invoice.expiresAt)}
                    </dd>
                  </div>
                )}

                {invoice.paidAt && (
                  <div className="border-b pb-4">
                    <dt className="text-sm text-gray-600 mb-1">Paid At</dt>
                    <dd className="text-gray-900 font-semibold">{formatDate(invoice.paidAt)}</dd>
                  </div>
                )}

                {invoice.paymentTxHash && (
                  <div className="border-b pb-4">
                    <dt className="text-sm text-gray-600 mb-1">Transaction Hash</dt>
                    <dd className="space-y-2">
                      <div className="font-mono text-xs text-gray-900 break-all">
                        {invoice.paymentTxHash}
                      </div>
                      {explorerUrl && (
                        <div>
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-700 hover:text-cyan-800 hover:underline"
                            aria-label="View transaction on Stellar Explorer (opens in a new tab)"
                          >
                            <ExternalLink className="w-4 h-4" aria-hidden="true" />
                            <span>View on Stellar Explorer</span>
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        </div>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="space-y-6" ref={statusPanelRef} tabIndex={-1}>
              <section className="card" aria-labelledby="timeline-heading">
                <h2 id="timeline-heading" className="text-xl font-bold text-gray-900 mb-6">
                  Status Timeline
                </h2>
                <ol className="relative border-l border-gray-200 ml-3 space-y-6">
                  <li className="ml-6">
                    <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-green-100 rounded-full ring-4 ring-white">
                      <CheckCircle2 className="w-4 h-4 text-green-600" aria-hidden="true" />
                    </span>
                    <h3 className="text-sm font-semibold text-gray-900">Invoice Created</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDate(invoice.createdAt)}</p>
                  </li>

                  {effectiveStatus === 'PENDING' && (
                    <li className="ml-6">
                      <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-cyan-100 rounded-full ring-4 ring-white">
                        <Clock className="w-4 h-4 text-cyan-600 animate-pulse" aria-hidden="true" />
                      </span>
                      <h3 className="text-sm font-semibold text-gray-900">Awaiting Payment</h3>
                      <p className="text-xs text-cyan-700 font-medium mt-0.5">
                        Expires in {getTimeRemaining(invoice.expiresAt)} ({formatDate(invoice.expiresAt)})
                      </p>
                    </li>
                  )}

                  {effectiveStatus === 'PAID' && (
                    <li className="ml-6">
                      <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-green-100 rounded-full ring-4 ring-white">
                        <CheckCircle2 className="w-4 h-4 text-green-600" aria-hidden="true" />
                      </span>
                      <h3 className="text-sm font-semibold text-gray-900">Payment Confirmed</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatDate(invoice.paidAt || invoice.settledAt || invoice.createdAt)}
                      </p>
                    </li>
                  )}

                  {effectiveStatus === 'EXPIRED' && (
                    <li className="ml-6">
                      <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-amber-100 rounded-full ring-4 ring-white">
                        <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
                      </span>
                      <h3 className="text-sm font-semibold text-amber-900">Invoice Expired</h3>
                      <p className="text-xs text-amber-700 mt-0.5">{formatDate(invoice.expiresAt)}</p>
                    </li>
                  )}

                  {effectiveStatus === 'CANCELLED' && (
                    <li className="ml-6">
                      <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-gray-100 rounded-full ring-4 ring-white">
                        <XCircle className="w-4 h-4 text-gray-600" aria-hidden="true" />
                      </span>
                      <h3 className="text-sm font-semibold text-gray-900">Invoice Cancelled</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Cancelled by seller</p>
                    </li>
                  )}
                </ol>
              </section>

              {effectiveStatus !== 'PAID' && (
                <PaymentStatus status={effectiveStatus} txHash={invoice.paymentTxHash} />
              )}

              {effectiveStatus === 'PAID' && (
                <PaymentReceipt invoice={invoice} />
              )}

              {effectiveStatus === 'PENDING' && (
                <section className="card" aria-labelledby="sharing-heading">
                  <h2 id="sharing-heading" className="text-xl font-bold text-gray-900 mb-4">
                    Share Payment Link
                  </h2>
                  <p className="text-sm text-gray-600 mb-4">
                    Share this payment link with your client or have them scan the QR code to settle the invoice.
                  </p>

                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={paymentUrl}
                        className="input font-mono text-xs text-gray-800 bg-gray-50 flex-1 select-all"
                        aria-label="Payment link URL"
                      />
                      <button
                        type="button"
                        onClick={handleCopyPaymentUrl}
                        className="btn btn-secondary inline-flex items-center justify-center gap-2"
                        aria-label="Copy payment link to clipboard"
                      >
                        {copiedLink ? (
                          <>
                            <Check className="w-4 h-4 text-green-700" aria-hidden="true" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" aria-hidden="true" />
                            <span>Copy Link</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <Link
                        href={`/pay/${invoice.id}`}
                        className="btn btn-primary flex-1 text-center"
                      >
                        Open Payment Page
                      </Link>
                      {canSendInvoiceEmail(invoice) && (
                        <button
                          type="button"
                          onClick={handleEmailInvoice}
                          className="btn btn-outline inline-flex items-center gap-2"
                          aria-label={`Email invoice to ${invoice.customerEmail}`}
                        >
                          <Mail className="w-4 h-4" aria-hidden="true" />
                          <span>Email</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 pt-6 border-t border-gray-100 flex flex-col items-center">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Payment QR Code</h3>
                    <QRCodeDisplay
                      value={paymentUrl}
                      size={180}
                      showCopy={false}
                      description={`Payment QR code for ${describeAmount(
                        formatAmount(invoice.amount, 7),
                        invoice.assetCode
                      )}`}
                    />
                  </div>
                </section>
              )}

              {effectiveStatus === 'PENDING' && (
                <div className="card border-red-100 bg-red-50/30">
                  <h2 className="text-lg font-semibold text-red-900 mb-2">Cancel Invoice</h2>
                  <p className="text-sm text-gray-600 mb-4">
                    Cancelling this invoice will invalidate the payment link and prevent further settlement attempts.
                  </p>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="btn btn-destructive inline-flex items-center gap-2"
                    aria-label="Cancel this invoice"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                    <span>Cancel Invoice</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
