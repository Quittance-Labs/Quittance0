'use client';

import { useState } from 'react';
import Link from 'next/link';
import InvoiceForm from '@/components/InvoiceForm';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import WalletConnect from '@/components/WalletConnect';
import { FileText, Zap, Shield, QrCode, Wallet as WalletIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getUserPublicKey } from '@/lib/stellar';
import { toast } from 'sonner';

export default function HomePage() {
  const router = useRouter();
  const [createdInvoice, setCreatedInvoice] = useState<any>(null);
  const [userWallet, setUserWallet] = useState<string | null>(null);

  const handleInvoiceCreated = (result: any) => {
    setCreatedInvoice(result);
  };

  const handleWalletConnected = (publicKey: string) => {
    setUserWallet(publicKey);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stellar-50 to-white">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-stellar-600 rounded-lg flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 hidden sm:block">
              Link to Pay
            </h1>
            <h1 className="text-lg font-bold text-gray-900 sm:hidden">
              Link to Pay
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <WalletConnect onConnect={handleWalletConnected} />
            <Link href="/dashboard" className="btn btn-outline">
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h2 className="text-5xl font-bold text-gray-900 mb-4">
            Create Payment Links
            <span className="text-stellar-600"> in Seconds</span>
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Generate instant payment links with QR codes. Accept XLM payments on Stellar blockchain with automatic verification.
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          <div className="card text-center">
            <div className="w-12 h-12 bg-stellar-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Zap className="w-6 h-6 text-stellar-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Instant Links</h3>
            <p className="text-gray-600 text-sm">
              Create payment links instantly with your connected wallet
            </p>
          </div>

          <div className="card text-center">
            <div className="w-12 h-12 bg-stellar-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <QrCode className="w-6 h-6 text-stellar-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">QR Code Payments</h3>
            <p className="text-gray-600 text-sm">
              Scan QR code to pay instantly from any Stellar wallet
            </p>
          </div>

          <div className="card text-center">
            <div className="w-12 h-12 bg-stellar-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="w-6 h-6 text-stellar-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Auto Verification</h3>
            <p className="text-gray-600 text-sm">
              Payments verified automatically on the blockchain
            </p>
          </div>
        </div>

        {/* Payment Link Creation */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            {!userWallet ? (
              <div className="card text-center py-12">
                <WalletIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-700 mb-2">
                  Connect Your Wallet
                </h3>
                <p className="text-gray-600 mb-6">
                  Connect your Stellar wallet to create payment links and receive XLM
                </p>
                <WalletConnect onConnect={handleWalletConnected} />
              </div>
            ) : (
              <div className="card">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                  <WalletIcon className="w-6 h-6 text-green-600" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-green-800">Wallet Connected</p>
                    <p className="text-xs text-green-600 font-mono">{userWallet.substring(0, 12)}...{userWallet.substring(userWallet.length - 8)}</p>
                  </div>
                </div>
                <h3 className="text-3xl font-bold text-gray-900 mb-2">
                  Create Payment Link
                </h3>
                <p className="text-gray-600 mb-6">
                  Enter the amount you want to receive. XLM will be sent directly to your wallet.
                </p>
                <InvoiceForm onSuccess={handleInvoiceCreated} userWallet={userWallet} />
              </div>
            )}
          </div>

          <div>
            {createdInvoice ? (
              <div className="card">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">
                    Payment Link Created!
                  </h3>
                  <p className="text-gray-600">Share this link or QR code to receive payment</p>
                </div>
                
                <div className="mb-6">
                  <QRCodeDisplay
                    value={createdInvoice.paymentUrl}
                    title="Scan to Pay"
                    size={220}
                  />
                </div>

                <div className="space-y-3">
                  <div className="bg-stellar-50 border border-stellar-200 p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Payment Amount</p>
                    <p className="font-bold text-2xl text-stellar-700">
                      {createdInvoice.invoice.amount} XLM
                    </p>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Payment Link</p>
                    <p className="font-mono text-xs break-all text-gray-800">{createdInvoice.paymentUrl}</p>
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
                      className="btn btn-secondary"
                    >
                      New Link
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card bg-gradient-to-br from-gray-50 to-stellar-50 text-center py-16">
                <QrCode className="w-20 h-20 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">
                  Your Payment Link Will Appear Here
                </h3>
                <p className="text-gray-600">
                  Connect your wallet and enter an amount to get started
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-gray-50 mt-16">
        <div className="max-w-7xl mx-auto px-4 py-8 text-center text-gray-600">
          <p>Powered by Stellar Network</p>
          <p className="text-sm mt-2">
            Link to Pay © 2024 - Instant Crypto Payments
          </p>
        </div>
      </footer>
    </div>
  );
}

