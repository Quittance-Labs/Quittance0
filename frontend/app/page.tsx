'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import InvoiceForm from '@/components/InvoiceForm';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import WalletConnect from '@/components/WalletConnect';
import UserProfile from '@/components/UserProfile';
import AssetLogo from '@/components/AssetLogo';
import { useWalletStore } from '@/lib/store';
import { FileText, Zap, Shield, QrCode, Wallet as WalletIcon } from 'lucide-react';
import { toast } from 'sonner';

export default function HomePage() {
  const [createdInvoice, setCreatedInvoice] = useState<any>(null);
  const { publicKey, connected } = useWalletStore();


  const handleInvoiceCreated = (result: any) => setCreatedInvoice(result);
  const handleWalletDisconnected = () => setCreatedInvoice(null);

  return (
    <div className="min-h-screen bg-logo-pattern relative" style={{zIndex: 2}}>
      <div 
        className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[1500px] h-[1500px] opacity-30 pointer-events-none"
        style={{zIndex: 1}}
      >
        <Image
          src="/Stellink.jpg"
          alt="Background Logo"
          fill
          className="object-contain animate-pulse"
          priority
        />
      </div>
      <div className="accent-blob accent-blob-1"></div>
      <div className="accent-blob accent-blob-2"></div>
      <header className="fixed top-0 left-0 right-0 premium-header border-b border-gray-200" style={{zIndex: 100}}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/Stellink.jpg"
              alt="Stellink Logo"
              width={45}
              height={45}
              className="w-11 h-11 object-contain"
              priority
            />
            <h1 className="text-2xl font-bold text-gray-900 hidden sm:block">
              Stellink
            </h1>
          </Link>
          <div className="flex items-center gap-3">
            {!connected ? (
              <WalletConnect />
            ) : (
              <UserProfile userWallet={publicKey} onDisconnect={handleWalletDisconnected} />
            )}
          </div>
        </div>
      </header>

      <div className="pt-20 relative" style={{zIndex: 3}}>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24 relative z-10">
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 mb-6 px-5 py-2 bg-cyan-50 rounded-full border border-cyan-200">
            <span className="text-cyan-700 text-sm font-semibold">Powered by Stellar Network</span>
          </div>
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight max-w-4xl mx-auto">
            Accept Crypto Payments
            <br />
            <span className="text-cyan-500">in Seconds</span>
          </h2>
          <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed mb-10">
            Generate instant payment links with QR codes. Accept XLM, USDC, and USDT payments on Stellar blockchain with automatic verification.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <span className="flex items-center gap-2 text-sm text-gray-600">
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              No Registration Required
            </span>
            <span className="flex items-center gap-2 text-sm text-gray-600">
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Instant Settlement
            </span>
            <span className="flex items-center gap-2 text-sm text-gray-600">
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Low Fees
            </span>
          </div>
        </div>

        <div className="bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl p-8 sm:p-12 mb-20">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-white mb-2">&lt; 3s</div>
              <div className="text-cyan-100 text-sm font-medium">Payment Creation</div>
            </div>
            <div className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-white mb-2">0.00001</div>
              <div className="text-cyan-100 text-sm font-medium">XLM Fee</div>
            </div>
            <div className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-white mb-2">24/7</div>
              <div className="text-cyan-100 text-sm font-medium">Availability</div>
            </div>
            <div className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-white mb-2">100%</div>
              <div className="text-cyan-100 text-sm font-medium">Decentralized</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
          <div className="feature-card group">
            <div className="w-14 h-14 bg-cyan-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Zap className="w-7 h-7 text-cyan-600" />
            </div>
            <h3 className="text-xl font-bold mb-3 text-gray-900">Instant Links</h3>
            <p className="text-gray-600 leading-relaxed">
              Create payment links instantly with your connected wallet. No registration or approval process required.
            </p>
          </div>

          <div className="feature-card group">
            <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <QrCode className="w-7 h-7 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold mb-3 text-gray-900">QR Code Payments</h3>
            <p className="text-gray-600 leading-relaxed">
              Scan QR code to pay instantly from any Stellar wallet. Perfect for in-person and online payments.
            </p>
          </div>

          <div className="feature-card group">
            <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-green-600" />
            </div>
            <h3 className="text-xl font-bold mb-3 text-gray-900">Auto Verification</h3>
            <p className="text-gray-600 leading-relaxed">
              Payments verified automatically on the blockchain. Real-time confirmation with zero fraud risk.
            </p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-2xl p-8 sm:p-12 mb-20">
          <h3 className="text-3xl font-bold text-gray-900 text-center mb-4">Start Accepting Crypto Payments Today</h3>
          <p className="text-gray-600 text-center mb-8 max-w-2xl mx-auto">
            Join thousands of users who trust Stellink for fast, secure, and decentralized crypto payments on the Stellar network.
          </p>
          {!connected && (
            <div className="flex justify-center">
              <WalletConnect />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div>
            {!connected ? (
              <div className="card text-center py-12">
                <div className="w-20 h-20 bg-cyan-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <WalletIcon className="w-10 h-10 text-cyan-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">
                  Connect Your Wallet
                </h3>
                <p className="text-gray-600 mb-8 text-base leading-relaxed max-w-md mx-auto">
                  Connect your Stellar wallet to create payment links and start receiving payments.
                </p>
                <WalletConnect />
              </div>
            ) : (
              <div className="card">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
                    <WalletIcon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-green-800">Wallet Connected</p>
                    <p className="text-xs text-green-600 font-mono truncate">{publicKey?.substring(0, 16)}...{publicKey?.substring(publicKey.length - 10)}</p>
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Create Payment Link
                </h3>
                <p className="text-gray-600 mb-6 text-sm">
                  Enter the amount you want to receive. Payments will be sent directly to your wallet.
                </p>
                <InvoiceForm onSuccess={handleInvoiceCreated} userWallet={publicKey || undefined} />
              </div>
            )}
          </div>

          <div>
            {createdInvoice ? (
              <div className="card">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">Link Created</h3>
                  <p className="text-gray-600 text-sm">Share this link or QR code</p>
                </div>
                
                <div className="mb-6 flex justify-center">
                  <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                    <QRCodeDisplay
                      value={createdInvoice.paymentUrl}
                      title="Scan to Pay"
                      size={200}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="bg-cyan-50 border border-cyan-200 p-4 rounded-lg">
                    <p className="text-xs text-gray-600 mb-2 font-semibold">Payment Amount</p>
                    <div className="flex items-center gap-3">
                      <AssetLogo code={createdInvoice.invoice.assetCode} size={32} showName={false} />
                      <p className="font-bold text-3xl text-gray-900">
                        {createdInvoice.invoice.amount}
                      </p>
                      <span className="font-semibold text-lg text-cyan-600">
                        {createdInvoice.invoice.assetCode}
                      </span>
                    </div>
                  </div>

                  {createdInvoice.invoice.description && (
                    <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1 font-semibold">Description</p>
                      <p className="text-sm text-gray-800">{createdInvoice.invoice.description}</p>
                    </div>
                  )}

                  {(createdInvoice.invoice.customerName || createdInvoice.invoice.customerEmail) && (
                    <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg space-y-2">
                      {createdInvoice.invoice.customerName && (
                        <div>
                          <p className="text-xs text-gray-600 font-semibold">Customer</p>
                          <p className="text-sm text-gray-900">{createdInvoice.invoice.customerName}</p>
                        </div>
                      )}
                      {createdInvoice.invoice.customerEmail && (
                        <div>
                          <p className="text-xs text-gray-600 font-semibold">Email</p>
                          <p className="text-sm text-gray-900">{createdInvoice.invoice.customerEmail}</p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-gray-800 p-4 rounded-lg">
                    <p className="text-xs text-gray-400 mb-2 font-semibold">Payment Link</p>
                    <p className="font-mono text-xs break-all text-gray-200">{createdInvoice.paymentUrl}</p>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(createdInvoice.paymentUrl);
                        toast.success('Link copied to clipboard!');
                      }}
                      className="btn btn-primary flex-1"
                    >
                      Copy Link
                    </button>
                    <button
                      onClick={() => setCreatedInvoice(null)}
                      className="btn btn-secondary px-6"
                    >
                      New
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card text-center py-16">
                <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <QrCode className="w-10 h-10 text-gray-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-700 mb-2">
                  Your Payment Link Will Appear Here
                </h3>
                <p className="text-gray-600 text-sm max-w-md mx-auto">
                  Connect your wallet and create a payment link to get started
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      </div>

      <footer className="relative z-10 border-t border-gray-200 bg-gray-50 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Image
                  src="/Stellink.jpg"
                  alt="Stellink Logo"
                  width={40}
                  height={40}
                  className="w-10 h-10 object-contain"
                />
                <span className="text-xl font-bold text-gray-900">Stellink</span>
              </div>
              <p className="text-gray-600 text-sm">
                Fast, secure, and decentralized crypto payment links on the Stellar network.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><Link href="/" className="hover:text-cyan-600 transition-colors">Home</Link></li>
                <li><Link href="/dashboard" className="hover:text-cyan-600 transition-colors">Dashboard</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Network</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><a href="https://www.stellar.org" target="_blank" rel="noopener noreferrer" className="hover:text-cyan-600 transition-colors">Stellar.org</a></li>
                <li><a href="https://stellar.expert" target="_blank" rel="noopener noreferrer" className="hover:text-cyan-600 transition-colors">Block Explorer</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-200 pt-8 text-center">
            <p className="text-gray-600 text-sm">
              © 2024 Stellink. Powered by Stellar Network. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}


