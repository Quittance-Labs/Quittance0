'use client';

import { useState, useRef, useEffect } from 'react';
import { User, LogOut, Wallet, ChevronDown } from 'lucide-react';
import { useWalletStore } from '@/lib/store';

interface UserProfileProps {
  userWallet: string | null;
  onDisconnect?: () => void;
}

export default function UserProfile({ userWallet, onDisconnect }: UserProfileProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { disconnect } = useWalletStore();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  if (!userWallet) {
    return null;
  }

  const shortAddress = `${userWallet.substring(0, 6)}...${userWallet.substring(userWallet.length - 4)}`;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors duration-200 border border-gray-200 bg-white"
      >
        <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center">
          <User className="w-4 h-4 text-white" />
        </div>
        <div className="hidden sm:block text-left">
          <p className="text-sm font-medium text-gray-900">Wallet</p>
          <p className="text-xs text-gray-500 font-mono">{shortAddress}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Connected wallet</p>
            <p className="text-xs text-gray-400 font-mono break-all mt-1">{userWallet}</p>
          </div>

          <div className="py-2">
            <button
              onClick={() => {
                setIsOpen(false);
                window.location.href = '/dashboard';
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Wallet className="w-4 h-4" />
              Dashboard
            </button>
          </div>

          <div className="border-t border-gray-100 pt-2">
            <button
              onClick={() => {
                disconnect();
                if (onDisconnect) onDisconnect();
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Disconnect Wallet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
