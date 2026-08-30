'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatAmount, formatDate, getStatusColor, getTimeRemaining } from '@/lib/utils';
import { Clock, ExternalLink, Copy, Check, Mail, Download } from 'lucide-react';
import { copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';
import AssetLogo from './AssetLogo';
import { openInvoicePDF, shareInvoiceByEmail } from '@/lib/export';
import { describeAmount, statusBadgeLabel, statusText } from '@/lib/a11y';

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
}

export default function InvoiceCard({ invoice }: InvoiceCardProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const statusColor = getStatusColor(invoice.status);
  const paymentUrl = `${window.location.origin}/pay/${invoice.id}`;

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

  const handleDownloadPDF = () => {
    openInvoicePDF(invoice as any);
    toast.success('Opening payment proof');
  };

  const handleEmailShare = () => {
    shareInvoiceByEmail(invoice as any);
  };

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
        {/*
          The badge is a coloured pill whose only content is a shouty enum value.
          `aria-label` replaces it with the same sentence the pay page and the
          detail page use, so status does not depend on recognising the colour.
        */}
        <span
          className={`px-3 py-1 rounded-lg text-xs font-semibold ${statusColor}`}
          aria-label={statusBadgeLabel(invoice.status)}
        >
          {statusText(invoice.status).label}
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
        {invoice.status === 'PENDING' && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Clock className="w-4 h-4" aria-hidden="true" />
            <span>Expires: {getTimeRemaining(invoice.expiresAt)}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {/*
          "View", "Download Proof" and the icon-only buttons repeat verbatim on
          every card, so each accessible name carries the amount that identifies
          which invoice it acts on.
        */}
        <Link
          href={`/invoice/${invoice.id}`}
          className="btn btn-outline flex-1 flex items-center justify-center gap-2 text-sm"
          aria-label={`View ${amountLabel} invoice`}
        >
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
          View
        </Link>
        {invoice.status === 'PENDING' && (
          <button
            onClick={handleCopyLink}
            className="btn btn-secondary flex items-center justify-center gap-2 px-3"
            aria-label={
              linkCopied
                ? `Payment link for the ${amountLabel} invoice copied`
                : `Copy payment link for the ${amountLabel} invoice`
            }
          >
            {linkCopied ? (
              <Check className="w-4 h-4 text-green-700" aria-hidden="true" />
            ) : (
              <Copy className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        )}
        {invoice.status === 'PAID' && (
          <button
            onClick={handleDownloadPDF}
            className="btn btn-primary flex-1 flex items-center justify-center gap-2 text-sm"
            aria-label={`Download payment proof for the ${amountLabel} invoice`}
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            Download Proof
          </button>
        )}
        {invoice.status === 'PAID' && (
          <>
            {/*
              `aria-disabled` rather than `disabled`: the button stays in the tab
              order, so the reason below is reachable and gets announced. A
              `disabled` button is skipped entirely and its `title` never read,
              which left this control simply missing rather than unavailable.
            */}
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
