'use client';

import { useState, useRef, useEffect } from 'react';
import { User, LogOut, Wallet, ChevronDown } from 'lucide-react';
import { useWalletStore } from '@/lib/store';
import { NETWORK_DISPLAY_NAME } from '@/lib/stellar';

interface UserProfileProps {
  userWallet: string | null;
  onDisconnect?: () => void;
}

export default function UserProfile({ userWallet, onDisconnect }: UserProfileProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { disconnect, isWrongNetwork } = useWalletStore();
  const menuId = 'user-profile-menu';

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

  /*
   * Escape closes the menu and returns focus to the trigger (issue #289).
   *
   * The menu could previously only be dismissed by clicking outside it, which
   * is not a thing a keyboard user can do — once opened, focus was stuck inside
   * a popup with no way back that did not involve tabbing through the entire
   * page.
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Opening with the keyboard should land on the first item, not leave focus
  // behind on the trigger with the menu open somewhere off to the side.
  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector('button')?.focus();
  }, [isOpen]);

  if (!userWallet) {
    return null;
  }

  const shortAddress = `${userWallet.substring(0, 6)}...${userWallet.substring(userWallet.length - 4)}`;

  const closeAndRestoreFocus = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={`Wallet menu for ${shortAddress}`}
        className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors duration-200 border border-gray-200 bg-white"
      >
        <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center">
          <User className="w-4 h-4 text-white" aria-hidden="true" />
        </div>
        <div className="hidden sm:block text-left" aria-hidden="true">
          <p className="text-sm font-medium text-gray-900">Wallet</p>
          <p className="text-xs text-gray-600 font-mono">{shortAddress}</p>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-gray-600 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="Wallet menu"
          className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50"
        >
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">Connected wallet</p>
              {isWrongNetwork ? (
                <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-full">
                  Wrong Network
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium text-[var(--teal)] bg-[var(--teal)]/10 rounded-full">
                  {NETWORK_DISPLAY_NAME}
                </span>
              )}
            </div>
            {/* text-gray-400 on white is 2.6:1 — below AA for this address. */}
            <p className="text-xs text-gray-600 font-mono break-all mt-1">{userWallet}</p>
          </div>

          <div className="py-2">
            <button
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                window.location.href = '/dashboard';
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Wallet className="w-4 h-4" aria-hidden="true" />
              Dashboard
            </button>
          </div>

          <div className="border-t border-gray-100 pt-2">
            <button
              role="menuitem"
              onClick={() => {
                disconnect();
                if (onDisconnect) onDisconnect();
                closeAndRestoreFocus();
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-700 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              Disconnect Wallet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
