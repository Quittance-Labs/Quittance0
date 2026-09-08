'use client';

import Link from 'next/link';
import WalletConnect from './WalletConnect';
import UserProfile from './UserProfile';

interface PayPageHeaderProps {
  wallet: string | null;
  onConnect: (wallet: string) => void;
  onDisconnect: () => void;
}

export default function PayPageHeader({ wallet, onConnect, onDisconnect }: PayPageHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 premium-header border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-display text-2xl tracking-tight text-[var(--ink)]">
          Quittance
        </Link>
        {wallet ? (
          <UserProfile userWallet={wallet} onDisconnect={onDisconnect} />
        ) : (
          <WalletConnect onConnect={onConnect} />
        )}
      </div>
    </header>
  );
}
