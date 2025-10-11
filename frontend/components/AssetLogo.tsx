'use client';

import Image from 'next/image';
import { getAssetByCode } from '@/lib/assets';

interface AssetLogoProps {
  code: string;
  size?: number;
  showName?: boolean;
  className?: string;
}

export default function AssetLogo({ 
  code, 
  size = 24, 
  showName = true,
  className = '' 
}: AssetLogoProps) {
  const asset = getAssetByCode(code);

  if (!asset) {
    return <span className={className}>{code}</span>;
  }

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
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
          alt={asset.name}
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

