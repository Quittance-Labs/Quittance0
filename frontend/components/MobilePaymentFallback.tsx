'use client';

import React, { useState } from 'react';
import { Copy, Check, ExternalLink, Smartphone, Monitor, AlertCircle } from 'lucide-react';
import { copyWithFeedback } from '@/lib/clipboard-feedback';
import { buildSep0007PayUri } from '@/lib/mobile-detection';
import { isAllowedPayReturnUrl } from '@/lib/pay-return';
import { MOBILE_FALLBACK_COPY } from '@/lib/mobile-fallback-copy';
import { toast } from 'sonner';

interface MobilePaymentFallbackProps {
  destination: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo: string;
  paymentUrl: string;
  /**
   * Server-built SEP-0007 URI from the pay-link artifact (issue #557). When
   * present this is used instead of rebuilding the URI client-side, so the
   * mobile deep link matches create and the QR copy row.
   */
  stellarUri?: string;
  /** Passphrase from the same resolver explorer links use. */
  networkPassphrase?: string;
  onCopy?: (text: string, label: string) => void;
}

/**
 * Fallback guidance and manual payment controls for mobile browsers.
 *
 * @param props - Payment parameters and copy handlers.
 * @returns Accessible fallback component.
 */
export default function MobilePaymentFallback({
  destination,
  amount,
  assetCode,
  assetIssuer,
  memo,
  paymentUrl,
  stellarUri,
  networkPassphrase,
  onCopy,
}: MobilePaymentFallbackProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Prefer the server pay-link artifact so the deep link matches create and
  // the QR (issue #557). Only rebuild client-side when the artifact is absent
  // (mock / offline paths), still pinning network from the shared resolver.
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const callback = isAllowedPayReturnUrl(paymentUrl, origin) ? paymentUrl : undefined;

  const sep0007Uri =
    stellarUri ||
    buildSep0007PayUri({
      destination,
      amount,
      assetCode,
      assetIssuer,
      memo,
      networkPassphrase,
      callback,
    });

  const handleCopy = async (text: string, fieldName: string, label: string) => {
    const success = await copyWithFeedback(text);
    if (success) {
      setCopiedField(fieldName);
      toast.success(`Copied ${label} to clipboard`);
      if (onCopy) {
        onCopy(text, label);
      }
      setTimeout(() => setCopiedField(null), 2000);
    } else {
      toast.error(`Failed to copy ${label}`);
    }
  };

  return (
    <section
      aria-labelledby="mobile-fallback-heading"
      className="card border-2 border-amber-200 bg-amber-50/40 p-5 rounded-xl space-y-5"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 bg-amber-100 rounded-lg text-amber-800 shrink-0">
          <Smartphone className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <div className="inline-block px-2 py-0.5 bg-amber-200 text-amber-900 text-xs font-semibold rounded">
            {MOBILE_FALLBACK_COPY.badge}
          </div>
          <h3
            id="mobile-fallback-heading"
            className="text-lg font-bold text-gray-900"
          >
            {MOBILE_FALLBACK_COPY.headline}
          </h3>
          <p className="text-sm text-gray-700">
            {MOBILE_FALLBACK_COPY.description}
          </p>
          <p className="text-xs text-gray-600 font-medium pt-1">
            {MOBILE_FALLBACK_COPY.noAuthNote}
          </p>
        </div>
      </div>

      <div className="border-t border-amber-200/60 pt-4 space-y-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-3">
          <div className="flex items-center gap-2">
            <ExternalLink className="w-4 h-4 text-primary" aria-hidden="true" />
            <h4 className="font-semibold text-gray-900 text-sm">
              {MOBILE_FALLBACK_COPY.options.mobileWallet.title}
            </h4>
          </div>
          <p className="text-xs text-gray-600">
            {MOBILE_FALLBACK_COPY.options.mobileWallet.description}
          </p>
          <a
            href={sep0007Uri}
            className="btn btn-secondary w-full text-xs flex items-center justify-center gap-2 py-2"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            {MOBILE_FALLBACK_COPY.options.mobileWallet.cta}
          </a>
        </div>

        <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-3">
          <div className="flex items-center gap-2">
            <Copy className="w-4 h-4 text-primary" aria-hidden="true" />
            <h4 className="font-semibold text-gray-900 text-sm">
              {MOBILE_FALLBACK_COPY.options.manualTransfer.title}
            </h4>
          </div>
          <p className="text-xs text-gray-600">
            {MOBILE_FALLBACK_COPY.options.manualTransfer.description}
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-200 text-xs">
              <span className="text-gray-500 font-medium">Destination:</span>
              <div className="flex items-center gap-2">
                <code className="font-mono text-gray-800 truncate max-w-[140px] sm:max-w-[200px]">
                  {destination}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(destination, 'destination', 'Destination Address')}
                  className="p-1 text-gray-600 hover:text-gray-900"
                  aria-label="Copy destination address"
                >
                  {copiedField === 'destination' ? (
                    <Check className="w-3.5 h-3.5 text-green-700" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-200 text-xs">
              <span className="text-gray-500 font-medium">Memo:</span>
              <div className="flex items-center gap-2">
                <code className="font-mono font-bold text-gray-900">
                  {memo}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(memo, 'memo', 'Invoice Memo')}
                  className="p-1 text-gray-600 hover:text-gray-900"
                  aria-label="Copy invoice memo"
                >
                  {copiedField === 'memo' ? (
                    <Check className="w-3.5 h-3.5 text-green-700" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-200 text-xs">
              <span className="text-gray-500 font-medium">Amount:</span>
              <div className="flex items-center gap-2">
                <code className="font-mono text-gray-800">
                  {amount} {assetCode}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(amount, 'amount', 'Amount')}
                  className="p-1 text-gray-600 hover:text-gray-900"
                  aria-label="Copy invoice amount"
                >
                  {copiedField === 'amount' ? (
                    <Check className="w-3.5 h-3.5 text-green-700" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 bg-amber-50 p-2 rounded text-xs text-amber-900 border border-amber-200">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" aria-hidden="true" />
            <span>{MOBILE_FALLBACK_COPY.options.manualTransfer.memoWarning}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-3">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-primary" aria-hidden="true" />
            <h4 className="font-semibold text-gray-900 text-sm">
              {MOBILE_FALLBACK_COPY.options.desktopHandoff.title}
            </h4>
          </div>
          <p className="text-xs text-gray-600">
            {MOBILE_FALLBACK_COPY.options.desktopHandoff.description}
          </p>
          <button
            type="button"
            onClick={() => handleCopy(paymentUrl, 'paymentUrl', 'Payment Link')}
            className="btn btn-outline w-full text-xs flex items-center justify-center gap-2 py-2"
          >
            {copiedField === 'paymentUrl' ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-700" aria-hidden="true" />
                <span>Link Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{MOBILE_FALLBACK_COPY.options.desktopHandoff.cta}</span>
              </>
            )}
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 text-center italic">
        {MOBILE_FALLBACK_COPY.unsupportedNotice}
      </p>
    </section>
  );
}
