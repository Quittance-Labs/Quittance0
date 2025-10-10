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
}

export default function QRCodeDisplay({
  value,
  title,
  size = 256,
  showCopy = true,
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

  return (
    <div className="flex flex-col items-center gap-4">
      {title && (
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      )}
      
      <div className="bg-white p-4 rounded-xl border-2 border-gray-200">
        <QRCodeSVG
          value={value}
          size={size}
          level="H"
          includeMargin={true}
        />
      </div>

      {showCopy && (
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 bg-gray-50 p-3 rounded-lg">
            <code className="flex-1 text-xs text-gray-700 truncate">
              {value}
            </code>
            <button
              onClick={handleCopy}
              className="btn btn-secondary p-2 shrink-0"
              title="Copy to clipboard"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

