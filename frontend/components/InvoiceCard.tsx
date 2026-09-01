'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatAmount, formatDate, getStatusColor } from '@/lib/utils';
import { expirySummary } from '@/lib/card-expiry-summary';
import { Clock, ExternalLink, Copy, Check, Mail, Download, X, Hash } from 'lucide-react';
import { copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';
import AssetLogo from './AssetLogo';
import { openInvoicePDF, shareInvoiceByEmail } from '@/lib/export';
import { effectiveInvoiceStatus } from '@/lib/invoice-lifecycle';
import { describeAmount, statusBadgeLabel, statusText } from '@/lib/a11y';
import { invoiceApi } from '@/lib/api';

interface Invoice {
  id: string;
  amount: number;
  assetCode: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  memo: string;
  sellerPublicKey?: string;
  sellerName?: string;
  sellerEmail?: string;
  payerPublicKey?: string;
  payerName?: string;
  payerEmail?: string;
  paymentTxHash?: string;
  paidAt?: string;
}

interface InvoiceCardProps {
  invoice: Invoice;
  userWallet?: string | null;
  onCancel?: (id: string) => void;
}

export default function InvoiceCard({ invoice, userWallet, onCancel }: InvoiceCardProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const status = effectiveInvoiceStatus(invoice) || invoice.status;
  const statusColor = getStatusColor(status);
  const paymentUrl = typeof window !== 'undefined' ? `${window.location.origin}/pay/${invoice.id}` : `/pay/${invoice.id}`;

  const handleCopyLink = async () => {
    const success = await copyToClipboard(paymentUrl);
    if (success) {
      setLinkCopied(true);
      toast.success('Invoice link copied');
      setTimeout(() => setLinkCopied(false), 2000);
    } else {
      toast.error('Could not copy invoice link');
    }
  };

  const handleCopyId = async () => {
    const success = await copyToClipboard(invoice.id);
    if (success) {
      setIdCopied(true);
      toast.success('Invoice ID copied');
      setTimeout(() => setIdCopied(false), 2000);
    } else {
      toast.error('Could not copy invoice ID');
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this invoice?')) return;
    setCancelling(true);
    try {
      await invoiceApi.cancel(invoice.id, userWallet || invoice.sellerPublicKey);
      toast.success('Invoice cancelled');
      onCancel?.(invoice.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel invoice';
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  };

  const handleDownloadPDF = () => {
    openInvoicePDF(invoice as any);
    toast.success('Opening payment proof');
  };

  const handleEmailShare = () => {
    shareInvoiceByEmail(invoice as any);
  };

  const isSeller = !invoice.sellerPublicKey || !userWallet || invoice.sellerPublicKey === userWallet;

  // Ids are scoped to the invoice: the dashboard renders many of these cards.
  const headingId = `invoice-${invoice.id}-heading`;
  const emailReasonId = `invoice-${invoice.id}-email-reason`;
  const canEmail = Boolean(invoice.customerEmail);
  const amountLabel = describeAmount(formatAmount(invoice.amount), invoice.assetCode);

  return (
    /*
     * An `<article>` labelled by its own heading, so the dashboard grid is a
     * list of named items a screen reader can jump between rather than one
     * undifferentiated run of text.
     */
    <article className="card hover:shadow-xl group" aria-labelledby={headingId}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {/* The heading already names the asset — the logo would repeat it. */}
            <AssetLogo code={invoice.assetCode} size={24} showName={false} decorative />
            <h3 id={headingId} className="text-lg font-bold text-gray-900">
              {formatAmount(invoice.amount)} <span className="text-cyan-700">{invoice.assetCode}</span>
              <span className="sr-only"> invoice</span>
            </h3>
          </div>
          {invoice.customerName && (
            <p className="text-sm text-gray-600">{invoice.customerName}</p>
          )}
        </div>
        <span
          className={`px-3 py-1 rounded-lg text-xs font-semibold ${statusColor}`}
          aria-label={statusBadgeLabel(status)}
        >
          {statusText(status).label}
        </span>
      </div>

      {invoice.description && (
        <p className="text-sm text-gray-600 mb-4 line-clamp-2">
          {invoice.description}
        </p>
      )}

      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <Clock className="w-4 h-4" aria-hidden="true" />
          <span>Created: {formatDate(invoice.createdAt)}</span>
        </div>
        {status === 'PENDING' && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Clock className="w-4 h-4" aria-hidden="true" />
            <span>Expires: {expirySummary(invoice.expiresAt)}</span>
          </div>
        )}
        {status === 'EXPIRED' && (
          <div className="flex items-center gap-2 text-xs text-red-600">
            <Clock className="w-4 h-4" aria-hidden="true" />
            <span>Expired: {formatDate(invoice.expiresAt)}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {/*
          "View", "Download Proof" and the icon-only buttons repeat verbatim on
          every card, so each accessible name carries the amount that identifies
          which invoice it acts on.
        */}
        <Link
          href={`/invoice/${invoice.id}`}
          className="btn btn-outline flex-1 flex items-center justify-center gap-2 text-sm min-w-[80px]"
          aria-label={`View ${amountLabel} invoice`}
        >
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
          View
        </Link>
        {status === 'PENDING' && (
          <>
            <button
              onClick={handleCopyLink}
              className="btn btn-secondary flex items-center justify-center gap-2 px-3"
              aria-label={
                linkCopied
                  ? `Payment link for the ${amountLabel} invoice copied`
                  : `Copy payment link for the ${amountLabel} invoice`
              }
              title="Copy Pay Link"
            >
              {linkCopied ? (
                <Check className="w-4 h-4 text-green-700" aria-hidden="true" />
              ) : (
                <Copy className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
            <button
              onClick={handleCopyId}
              className="btn btn-secondary flex items-center justify-center gap-2 px-3"
              aria-label={
                idCopied
                  ? `Invoice ID for the ${amountLabel} invoice copied`
                  : `Copy invoice ID for the ${amountLabel} invoice`
              }
              title="Copy Invoice ID"
            >
              {idCopied ? (
                <Check className="w-4 h-4 text-green-700" aria-hidden="true" />
              ) : (
                <Hash className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
            {isSeller && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="btn btn-destructive flex items-center justify-center gap-2 px-3 text-sm"
                aria-label={`Cancel the ${amountLabel} invoice`}
                title="Cancel Invoice"
              >
                <X className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only sm:inline">Cancel</span>
              </button>
            )}
          </>
        )}
        {status === 'PAID' && (
          <button
            onClick={handleDownloadPDF}
            className="btn btn-primary flex-1 flex items-center justify-center gap-2 text-sm min-w-[120px]"
            aria-label={`Download payment proof for the ${amountLabel} invoice`}
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            Proof
          </button>
        )}
        {status === 'PAID' && (
          <>
            <button
              onClick={canEmail ? handleEmailShare : undefined}
              aria-disabled={!canEmail}
              aria-describedby={canEmail ? undefined : emailReasonId}
              aria-label={`Email payment proof for the ${amountLabel} invoice`}
              className="btn btn-outline flex items-center justify-center gap-2 px-3"
            >
              <Mail className="w-4 h-4" aria-hidden="true" />
            </button>
            {!canEmail && (
              <span id={emailReasonId} className="sr-only">
                Unavailable: this invoice has no client email.
              </span>
            )}
          </>
        )}
      </div>
    </article>
  );
}
