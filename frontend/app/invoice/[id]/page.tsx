'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
// `apiErrorMessage` resolves stable verification codes to their canonical
// message, so the invoice error banner never shows divergent copy.
import { apiErrorMessage, invoiceApi, isApiUnavailableError } from '@/lib/api';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import PaymentStatus from '@/components/PaymentStatus';
import WalletConnect from '@/components/WalletConnect';
import UserProfile from '@/components/UserProfile';
import FreighterInstallPrompt from '@/components/FreighterInstallPrompt';
import PaymentReceipt from '@/components/PaymentReceipt';
import AssetLogo from '@/components/AssetLogo';
import { formatAmount, formatDate, getTimeRemaining } from '@/lib/utils';
import { MAIN_CONTENT_ID, describeAmount, statusText } from '@/lib/a11y';
import { ArrowLeft, Share2, Loader2, X, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useWalletStore } from '@/lib/store';
import ApiErrorState from '@/components/ApiErrorState';
import { effectiveInvoiceStatus } from '@/lib/invoice-lifecycle';
import { invoiceSharePath } from '@/lib/invoice-share-path';
import { EXPECTED_WALLET_NETWORK } from '@/lib/stellar';
import { walletGate } from '@/lib/freighter-availability';
import {
  shareInvoiceByEmail,
  emailPaymentProof,
  canSendInvoiceEmail,
  canSendProofEmail,
  getProofMailtoRecipient,
} from '@/lib/export';
import { copyWithFeedback } from '@/lib/clipboard-feedback';
import { getExplorerTransactionUrl } from '@/lib/stellar';

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { publicKey, connected, network, freighterAvailable, sessionVerified } = useWalletStore();

  const gate = walletGate(
    { sessionVerified, freighterAvailable, connected, publicKey, network },
    EXPECTED_WALLET_NETWORK
  );
  const userWallet = gate.ready ? publicKey : null;

  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lifecycleNow, setLifecycleNow] = useState(() => Date.now());
  // Cancelling reloads the invoice and swaps the status panel out from under
  // the button that was just pressed, so focus has to be moved deliberately.
  const statusPanelRef = useRef<HTMLDivElement>(null);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setLifecycleNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadInvoice = useCallback(async () => {
    if (!userWallet) return;
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    try {
      const result = await invoiceApi.getById(id, userWallet);
      if (requestId !== loadRequestRef.current) return;
      setInvoice(result.data);
    } catch (error: any) {
      if (requestId !== loadRequestRef.current) return;
      setInvoice(null);
      if (error?.status === 403) setForbidden(true);
      const message = apiErrorMessage(error, 'Failed to load invoice');
      if (isApiUnavailableError(error)) setLoadError(message);
      toast.error(message);
      console.error(error);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [id, userWallet]);

  useEffect(() => {
    if (!userWallet) {
      loadRequestRef.current += 1;
      setInvoice(null);
      setForbidden(false);
      setLoadError(null);
      setLoading(false);
      return;
    }
    void loadInvoice();
  }, [loadInvoice, userWallet]);

  const handleCopyPayLink = async () => {
    const url = `${window.location.origin}${invoiceSharePath(invoice.id)}`;
    const copied = await copyWithFeedback(url);
    if (copied) {
      toast.success('Pay link copied to clipboard');
    } else {
      toast.error('Failed to copy link');
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}${invoiceSharePath(invoice.id)}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Quittance Invoice',
          text: `Pay ${invoice.amount} ${invoice.assetCode}`,
          url,
        });
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          toast.error('Failed to open the share menu');
        }
      }
    } else {
      await handleCopyPayLink();
    }
  };

  const handleCancel = async () => {
    if (cancelling || !userWallet || !window.confirm('Cancel this invoice?')) return;
    setCancelling(true);
    try {
      await invoiceApi.cancel(id, userWallet);
      toast.success('Invoice cancelled');
      await loadInvoice();
      /*
       * Cancelling unmounts the Cancel button that was just pressed, which
       * drops focus to the top of the document with no explanation. Focus goes
       * to the status panel instead, which is also a live region and so states
       * the new status (issue #289).
       */
      statusPanelRef.current?.focus();
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to cancel invoice');
      if (isApiUnavailableError(error)) setLoadError(message);
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  };

  if (!gate.ready) {
    return (
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-screen bg-logo-pattern relative flex items-center justify-center px-4"
      >
        <div className="max-w-md w-full relative z-10">
          <FreighterInstallPrompt gate={gate} action={<WalletConnect />} />
        </div>
      </main>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────
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
        {/* The spinner has no text equivalent on its own. */}
        <div className="relative" role="status" aria-live="polite">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full blur-2xl opacity-30"></div>
          <Loader2 className="w-16 h-16 animate-spin text-teal-800 relative z-10" aria-hidden="true" />
          <span className="sr-only">Loading this invoice.</span>
        </div>
      </main>
    );
  }

  if (forbidden) {
    return (
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-screen bg-logo-pattern relative flex items-center justify-center px-4"
      >
        <div className="card text-center max-w-md relative z-10" role="alert">
          <h1 className="text-2xl font-bold text-red-700 mb-2">Access Denied</h1>
          <p className="text-gray-700 mb-4">
            This invoice belongs to a different seller. Connect the wallet that created this invoice to view it.
          </p>
          <Link href="/dashboard" className="btn btn-primary inline-block">Go to Dashboard</Link>
        </div>
      </main>
    );
  }

  // ── Invoice not found ──────────────────────────────────────────────────
  if (!invoice) {
    if (loadError) {
      return (
        <div className="min-h-screen bg-logo-pattern flex items-center justify-center px-4">
          <div className="max-w-lg w-full">
            <ApiErrorState message={loadError} onRetry={() => void loadInvoice()} />
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
            {loadError ?? 'The invoice you are looking for does not exist.'}
          </p>
        </div>
      </main>
    );
  }

  const isOwner = invoice.sellerPublicKey === userWallet;
  if (!isOwner) {
    return (
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-screen bg-logo-pattern relative flex items-center justify-center px-4"
      >
        <div className="card text-center max-w-md relative z-10" role="alert">
          <h1 className="text-2xl font-bold text-red-700 mb-2">Access Denied</h1>
          <p className="text-gray-700 mb-4">
            This invoice belongs to a different seller. Connect the wallet that created this invoice to view it.
          </p>
          <Link href="/dashboard" className="btn btn-primary inline-block">Go to Dashboard</Link>
        </div>
      </main>
    );
  }
  const payUrl = `${typeof window === 'undefined' ? '' : window.location.origin}${invoiceSharePath(invoice.id)}`;

  const effectiveStatus = (effectiveInvoiceStatus(invoice, lifecycleNow) || invoice.status) as
    'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

  // ── Status timeline steps ──────────────────────────────────────────────
  type TimelineStep = { label: string; timestamp?: string; active: boolean; completed: boolean };
  const timelineSteps: TimelineStep[] = [
    {
      label: 'Created',
      timestamp: invoice.createdAt,
      active: false,
      completed: true,
    },
    {
      label: 'Awaiting Payment',
      active: effectiveStatus === 'PENDING',
      completed: effectiveStatus !== 'PENDING',
    },
    ...(effectiveStatus === 'CANCELLED'
      ? [{
          label: 'Cancelled',
          timestamp: invoice.cancelledAt,
          active: false,
          completed: true,
        }]
      : effectiveStatus === 'EXPIRED'
        ? [{
            label: 'Expired',
            timestamp: invoice.expiresAt,
            active: false,
            completed: true,
          }]
        : [{
            label: 'Paid',
            timestamp: invoice.paidAt,
            active: false,
            completed: effectiveStatus === 'PAID',
          }]
    ),
  ];

  return (
    <div className="min-h-screen bg-logo-pattern relative py-8 sm:py-12 px-4">
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>

      {/* Top-level banner landmark, not nested inside the content wrapper. */}
      <header className="fixed top-0 left-0 right-0 z-50 premium-header border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/*
              Labels here are hidden below `sm`, so each control carries an
              explicit accessible name that does not depend on the breakpoint.
            */}
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
            {!publicKey ? (
              <WalletConnect />
            ) : (
              <UserProfile userWallet={publicKey} />
            )}
            {effectiveStatus === 'PENDING' && isOwner && (
              <div className="flex items-center gap-2">
                {invoice.customerEmail && canSendInvoiceEmail(invoice) && (
                  <button
                    onClick={() => {
                      shareInvoiceByEmail(invoice);
                      toast.success('Opening email client');
                    }}
                    className="btn btn-outline flex items-center gap-2"
                    aria-label={`Resend invoice to ${invoice.customerEmail}`}
                  >
                    <Mail className="w-5 h-5" aria-hidden="true" />
                    <span className="hidden sm:inline">Resend</span>
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
                  disabled={cancelling}
                  aria-busy={cancelling}
                  className="btn btn-destructive flex items-center gap-2"
                  aria-label="Cancel this invoice"
                >
                  {cancelling ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <X className="w-5 h-5" aria-hidden="true" />}
                  <span className="hidden sm:inline">{cancelling ? 'Cancelling…' : 'Cancel'}</span>
                </button>
              </div>
            )}
            {effectiveStatus === 'PAID' && isOwner && canSendProofEmail(invoice) && (
              <button
                onClick={() => {
                  emailPaymentProof(invoice);
                  toast.success('Opening email client');
                }}
                className="btn btn-outline flex items-center gap-2"
                aria-label={`Email payment proof to ${getProofMailtoRecipient(invoice)}`}
              >
                <Mail className="w-5 h-5" aria-hidden="true" />
                <span className="hidden sm:inline">Send Proof</span>
              </button>
            )}
          </nav>
        </div>
      </header>

      <div className="max-w-4xl mx-auto relative z-10">
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
              <h2 className="text-3xl font-bold text-gray-900 mb-8">Invoice Details</h2>

              {/*
                A description list: each of these is a label/value pair, which
                <dl> states outright rather than leaving to reading order.
                The amount keeps an explicit name because `bg-clip-text` and
                the nested span split it into two announcements.
              */}
              <dl className="space-y-5">
                <div className="bg-gradient-to-br from-gray-50 to-slate-50 p-5 rounded-2xl border border-gray-200/50">
                  <dt className="text-xs text-gray-600 mb-2 font-semibold uppercase tracking-wide">Invoice ID</dt>
                  <dd className="font-mono text-sm text-gray-900 break-all">{invoice.id}</dd>
                </div>

                <div className="bg-gradient-to-br from-cyan-50 to-blue-50 p-6 rounded-2xl border-2 border-cyan-200/50 shadow-lg">
                  <dt className="text-xs text-gray-600 mb-3 font-semibold uppercase tracking-wide">Amount</dt>
                  {/*
                    The value is given as hidden visual text plus a screen
                    reader equivalent, rather than an `aria-label` on the
                    <dd> — ARIA prohibits naming a <dd>, and axe reports it.
                  */}
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

                <div className="border-b pb-4">
                  <dt className="text-sm text-gray-600 mb-1">Status</dt>
                  <dd className="text-gray-900 font-semibold">
                    {statusText(effectiveStatus).label}
                  </dd>
                </div>

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
                    <dd className="text-gray-900">{formatDate(invoice.paidAt)}</dd>
                  </div>
                )}

                {/* Tx hash + explorer link for paid invoices */}
                {effectiveStatus === 'PAID' && invoice.paymentTxHash && (
                  <div className="border-b pb-4">
                    <dt className="text-sm text-gray-600 mb-1">Transaction Hash</dt>
                    <dd className="text-gray-900">
                      <a
                        href={getExplorerTransactionUrl(invoice.paymentTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm text-cyan-700 hover:text-cyan-900 underline break-all"
                        aria-label={`View transaction ${invoice.paymentTxHash} on Stellar Explorer`}
                      >
                        {invoice.paymentTxHash}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>

              {/* ── Pay link copy button ────────────────────────────────── */}
              {effectiveStatus === 'PENDING' && isOwner && (
                <div className="mt-6">
                  <button
                    onClick={handleCopyPayLink}
                    className="btn btn-outline w-full flex items-center justify-center gap-2"
                    aria-label="Copy pay link to clipboard"
                  >
                    <Share2 className="w-4 h-4" aria-hidden="true" />
                    Copy Pay Link
                  </button>
                </div>
              )}
            </div>

            {/*
              The status side of the page. The wrapper takes focus after a
              cancel, because that action removes the button it was triggered
              from and the panel below is the result of it.
            */}
            <div className="space-y-6" ref={statusPanelRef} tabIndex={-1}>
              {/* ── Status timeline ──────────────────────────────────────── */}
              <div className="card">
                <h3 className="text-lg font-semibold mb-4">Status Timeline</h3>
                <ol className="relative border-l-2 border-gray-200 ml-3 space-y-4" aria-label="Invoice status timeline">
                  {timelineSteps.map((step) => (
                    <li key={step.label} className="ml-6">
                      <span
                        className={`absolute -left-[9px] w-4 h-4 rounded-full border-2 ${
                          step.completed
                            ? 'bg-green-500 border-green-500'
                            : step.active
                              ? 'bg-cyan-500 border-cyan-500'
                              : 'bg-gray-200 border-gray-300'
                        }`}
                        aria-hidden="true"
                      />
                      <p className={`text-sm font-medium ${step.completed || step.active ? 'text-gray-900' : 'text-gray-400'}`}>
                        {step.label}
                      </p>
                      {step.timestamp && (
                        <time dateTime={step.timestamp} className="text-xs text-gray-500">{formatDate(step.timestamp)}</time>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {effectiveStatus !== 'PAID' && (
                <PaymentStatus status={effectiveStatus} txHash={invoice.paymentTxHash} />
              )}

              {effectiveStatus === 'PAID' && (
                <PaymentReceipt invoice={invoice} />
              )}

              {effectiveStatus === 'PENDING' && (
                <div className="card">
                  <h3 className="text-lg font-semibold mb-4 text-center">
                    Payment QR Code
                  </h3>
                  <QRCodeDisplay
                    value={payUrl}
                    size={200}
                    showCopy={true}
                    description={`a payment link for ${describeAmount(
                      formatAmount(invoice.amount, 7),
                      invoice.assetCode
                    )}`}
                  />
                  <Link
                    href={`/pay/${invoice.id}`}
                    className="btn btn-primary w-full mt-4"
                  >
                    Go to Payment Page
                  </Link>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
