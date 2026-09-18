'use client';

import React, { useEffect, useRef } from 'react';
import { ShieldCheck, AlertCircle, ArrowRight, X, Loader2 } from 'lucide-react';
import { PaymentSummary } from '@/lib/payment-builder';

/**
 * Properties for PaymentReviewDialog.
 */
interface PaymentReviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  summary: PaymentSummary | null;
  loading: boolean;
}

/**
 * Accessible modal dialog displaying payment transaction details for user verification prior to signing.
 *
 * @param props - Dialog properties including visibility state, action callbacks, and payment summary.
 * @returns Dialog element or null when closed.
 */
export default function PaymentReviewDialog({
  isOpen,
  onClose,
  onConfirm,
  summary,
  loading,
}: PaymentReviewDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const timeoutId = setTimeout(() => {
      confirmButtonRef.current?.focus();
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeoutId);
    };
  }, [isOpen, loading, onClose]);

  if (!isOpen || !summary) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-review-title"
        aria-describedby="payment-review-desc"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden transform transition-all"
      >
        <div className="px-6 py-5 bg-gradient-to-r from-teal-50 to-cyan-50 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-teal-100/80 text-teal-700">
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="payment-review-title" className="text-lg font-bold text-gray-900">
                Review Payment Details
              </h2>
              <p id="payment-review-desc" className="text-xs text-gray-500">
                Verify transaction parameters before signing
              </p>
            </div>
          </div>
          {!loading && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close review dialog"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="p-6 space-y-4">
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Total Sending
            </span>
            <div className="mt-1 flex items-baseline justify-center gap-1.5">
              <span className="text-3xl font-extrabold text-gray-900 font-mono tracking-tight">
                {summary.amount}
              </span>
              <span className="text-lg font-bold text-teal-700">
                {summary.assetCode}
              </span>
            </div>
          </div>

          <div className="divide-y divide-gray-100 text-sm">
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-gray-500 font-medium">Recipient</span>
              <div className="flex items-center gap-1 font-mono text-gray-800" title={summary.destination}>
                <span>{summary.shortDestination}</span>
              </div>
            </div>

            <div className="py-2.5 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-gray-500 font-medium">Invoice Memo</span>
                <span className="text-[11px] text-teal-600 font-semibold flex items-center gap-1">
                  Verified exact match
                </span>
              </div>
              <span className="font-mono font-semibold px-2 py-1 rounded bg-teal-50 text-teal-900 border border-teal-200/60">
                {summary.memo}
              </span>
            </div>

            <div className="py-2.5 flex items-center justify-between">
              <span className="text-gray-500 font-medium">Stellar Network</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {summary.network}
              </span>
            </div>

            <div className="py-2.5 flex items-center justify-between">
              <span className="text-gray-500 font-medium">Estimated Network Fee</span>
              <span className="text-gray-700 font-mono text-xs">
                ~{summary.fee} XLM
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-amber-50/80 border border-amber-200/60 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" aria-hidden="true" />
            <p>
              Freighter will prompt you to approve this transaction. Once submitted on Stellar, the invoice will automatically verify.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="btn btn-outline px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="btn btn-primary px-5 py-2 text-sm flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Signing in Freighter...
              </>
            ) : (
              <>
                Confirm & Sign
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
