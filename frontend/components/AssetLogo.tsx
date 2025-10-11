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
        className="rounded-full overflow-hidden flex items-center justify-center bg-white"
        style={{ 
          width: size, 
          height: size,
          minWidth: size,
          minHeight: size
        }}
      >
        <Image
          src={asset.logo}
          alt={asset.name}
          width={size}
          height={size}
          className="object-contain"
          unoptimized
        />
      </div>
      {showName && (
        <span className="font-medium">{asset.code}</span>
      )}
    </div>
  );
}

