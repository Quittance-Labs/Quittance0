'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiErrorMessage, invoiceApi, isApiUnavailableError } from '@/lib/api';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import PaymentStatus from '@/components/PaymentStatus';
import WalletConnect from '@/components/WalletConnect';
import UserProfile from '@/components/UserProfile';
import PaymentReceipt from '@/components/PaymentReceipt';
import { formatAmount, formatDate, getTimeRemaining } from '@/lib/utils';
import { MAIN_CONTENT_ID, describeAmount, statusText } from '@/lib/a11y';
import { ArrowLeft, Share2, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import ApiErrorState from '@/components/ApiErrorState';
import { effectiveInvoiceStatus } from '@/lib/invoice-lifecycle';
import { invoiceSharePath } from '@/lib/invoice-share-path';

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [invoice, setInvoice] = useState<any>(null);
  const [paymentInfo, setPaymentInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userWallet, setUserWallet] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lifecycleNow, setLifecycleNow] = useState(() => Date.now());
  // Cancelling reloads the invoice and swaps the status panel out from under
  // the button that was just pressed, so focus has to be moved deliberately.
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

  const handleShare = async () => {
    const url = `${window.location.origin}${invoiceSharePath(invoice.id)}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Quittance Invoice',
          text: `Pay ${invoice.amount} ${invoice.assetCode}`,
          url,
        });
      } catch {
        // User cancelled share
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success('Invoice link copied');
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this invoice?')) return;
    try {
      await invoiceApi.cancel(id);
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
    }
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
        {/* The spinner has no text equivalent on its own. */}
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

  const effectiveStatus = (effectiveInvoiceStatus(invoice, lifecycleNow) || invoice.status) as
    'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

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
            {!userWallet ? (
              <WalletConnect onConnect={setUserWallet} />
            ) : (
              <UserProfile userWallet={userWallet} onDisconnect={() => setUserWallet(null)} />
            )}
            {effectiveStatus === 'PENDING' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleShare}
                  className="btn btn-primary flex items-center gap-2"
                  aria-label="Share this invoice"
                >
                  <Share2 className="w-5 h-5" aria-hidden="true" />
                  <span className="hidden sm:inline">Share</span>
                </button>
                {userWallet && invoice.sellerPublicKey === userWallet && (
                  <button
                    onClick={handleCancel}
                    className="btn btn-destructive flex items-center gap-2"
                    aria-label="Cancel this invoice"
                  >
                    <X className="w-5 h-5" aria-hidden="true" />
                    <span className="hidden sm:inline">Cancel</span>
                  </button>
                )}
              </div>
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
                  <dd className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-cyan-700 to-blue-700 bg-clip-text text-transparent">
                    <span aria-hidden="true">
                      {formatAmount(invoice.amount, 7)} <span className="text-2xl">{invoice.assetCode}</span>
                    </span>
                    <span className="sr-only">
                      {describeAmount(formatAmount(invoice.amount, 7), invoice.assetCode)}
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
              </dl>
            </div>

            {/*
              The status side of the page. The wrapper takes focus after a
              cancel, because that action removes the button it was triggered
              from and the panel below is the result of it.
            */}
            <div className="space-y-6" ref={statusPanelRef} tabIndex={-1}>
              {effectiveStatus !== 'PAID' && (
                <PaymentStatus status={effectiveStatus} txHash={invoice.paymentTxHash} />
              )}

              {effectiveStatus === 'PAID' && (
                <PaymentReceipt invoice={invoice} />
              )}

              {effectiveStatus === 'PENDING' && paymentInfo?.paymentAvailable !== false && (
                <div className="card">
                  <h3 className="text-lg font-semibold mb-4 text-center">
                    Payment QR Code
                  </h3>
                  <QRCodeDisplay
                    value={paymentInfo.paymentUrl}
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
