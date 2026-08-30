'use client';

import Image from 'next/image';
import { getAssetByCode } from '@/lib/assets';

interface AssetLogoProps {
  code: string;
  size?: number;
  showName?: boolean;
  className?: string;
  /**
   * Hides the logo from assistive technology.
   *
   * Set this wherever the asset code is already announced by adjacent text — a
   * heading, a select value, an aria-label on the amount. Without it the code
   * is read twice in a row, which is how "10 XLM" became "10 Stellar Lumens
   * XLM XLM" on the pay page.
   */
  decorative?: boolean;
}

export default function AssetLogo({
  code,
  size = 24,
  showName = true,
  className = '',
  decorative = false,
}: AssetLogoProps) {
  const asset = getAssetByCode(code);

  if (!asset) {
    return <span className={className}>{code}</span>;
  }

  return (
    <div
      className={`inline-flex items-center gap-2 ${className}`}
      {...(decorative ? { 'aria-hidden': true } : {})}
    >
      <div
        className="rounded-full overflow-hidden flex items-center justify-center bg-white shadow-sm border border-gray-100"
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          padding: '2px'
        }}
      >
        <Image
          src={asset.logo}
          // A decorative logo carries an empty alt so it is skipped outright
          // rather than announced as an unlabelled image.
          alt={decorative ? '' : asset.name}
          width={size - 4}
          height={size - 4}
          className="object-contain rounded-full"
          unoptimized
          priority
        />
      </div>
      {showName && (
        <span className="font-semibold">{asset.code}</span>
      )}
    </div>
  );
}

