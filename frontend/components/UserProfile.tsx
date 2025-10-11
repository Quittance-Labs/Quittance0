'use client';

import { useState, useRef, useEffect } from 'react';
import { User, Settings, LogOut, Wallet, ChevronDown } from 'lucide-react';
import { useWalletStore } from '@/lib/store';
import { useAuth } from '@/lib/auth';

interface UserProfileProps {
  userWallet: string | null;
  onDisconnect?: () => void;
}

export default function UserProfile({ userWallet, onDisconnect }: UserProfileProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { disconnect } = useWalletStore();
  const { user: googleUser, logout: googleLogout } = useAuth();

  // Close dropdown when clicking outside
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

  if (!userWallet && !googleUser) {
    return null;
  }

  const shortAddress = userWallet ? `${userWallet.substring(0, 6)}...${userWallet.substring(userWallet.length - 4)}` : '';
  const displayName = googleUser?.name || 'User';
  const displayEmail = googleUser?.email || '';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors duration-200 border border-gray-200 bg-white"
      >
        <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center overflow-hidden">
          {googleUser?.picture ? (
            <img 
              src={googleUser.picture} 
              alt={displayName}
              className="w-full h-full object-cover"
            />
          ) : (
            <User className="w-4 h-4 text-white" />
          )}
        </div>
        <div className="hidden sm:block text-left">
          <p className="text-sm font-medium text-gray-900">{displayName}</p>
          <p className="text-xs text-gray-500">
            {googleUser?.email || shortAddress}
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">{displayName}</p>
            <p className="text-xs text-gray-500 break-all mt-1">{displayEmail}</p>
            {userWallet && (
              <p className="text-xs text-gray-400 font-mono break-all mt-1">{userWallet}</p>
            )}
          </div>

          {/* Menu Items */}
          <div className="py-2">
            <button
              onClick={() => {
                setIsOpen(false);
                // Navigate to dashboard
                window.location.href = '/dashboard';
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Wallet className="w-4 h-4" />
              Dashboard
            </button>
            
            <button
              onClick={() => {
                setIsOpen(false);
                // Navigate to settings (if you have a settings page)
                // window.location.href = '/settings';
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
          </div>

          {/* Disconnect Buttons */}
          <div className="border-t border-gray-100 pt-2 space-y-1">
            {userWallet && (
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
            )}
            {googleUser && (
              <button
                onClick={() => {
                  googleLogout();
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}