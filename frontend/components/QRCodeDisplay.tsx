'use client';

import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';

interface QRCodeDisplayProps {
  value: string;
  title?: string;
  size?: number;
  showCopy?: boolean;
  /**
   * What the code encodes, for the text alternative. Defaults to the generic
   * wording; the pay page passes something more specific.
   */
  description?: string;
}

export default function QRCodeDisplay({
  value,
  title,
  size = 256,
  showCopy = true,
  description = 'the payment link for this invoice',
}: QRCodeDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(value);
    if (success) {
      setCopied(true);
      toast.success('Copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Failed to copy');
    }
  };

  // Check if value is a base64 image (from backend)
  const isBase64Image = value.startsWith('data:image');

  /*
   * A QR code is an image of a link, and "QR Code" as alt text says nothing
   * about which link. Both branches now describe what scanning it does, and the
   * link itself is exposed as selectable text below — a keyboard or
   * screen-reader user cannot scan a code with a phone camera, so the copyable
   * value is the equivalent, not a convenience.
   */
  const alternativeText = `QR code containing ${description}. Scan it with a Stellar wallet app, or use the link below.`;

  if (!value) {
    return (
      <div role="status" className="pay-qr-placeholder">
        Payment QR code is preparing...
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {title && (
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      )}

      <div className="bg-white p-5 rounded-xl border-2 border-gray-200 shadow-lg">
        {isBase64Image ? (
          // Display base64 image from backend
          // eslint-disable-next-line @next/next/no-img-element -- a data: URL, not a remote asset
          <img
            src={value}
            alt={alternativeText}
            width={size}
            height={size}
            className="block"
          />
        ) : (
          // Generate QR code from URL. QRCodeSVG renders a bare <svg>, which is
          // an unnamed graphic to assistive technology without these.
          <QRCodeSVG
            value={value}
            size={size}
            level="H"
            includeMargin={true}
            role="img"
            aria-label={alternativeText}
          />
        )}
      </div>

      {showCopy && (
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 bg-gray-50 p-3 rounded-lg border border-gray-200">
            <code className="flex-1 text-xs text-gray-700 truncate font-mono">
              {value}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="btn btn-secondary p-2 shrink-0 hover:scale-105 transition-transform"
              aria-label={copied ? 'Payment link copied' : 'Copy payment link'}
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-700" aria-hidden="true" />
              ) : (
                <Copy className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
