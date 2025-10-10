'use client';

import { useState } from 'react';
import Link from 'next/link';
import InvoiceForm from '@/components/InvoiceForm';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import WalletConnect from '@/components/WalletConnect';
import { FileText, Zap, Shield, QrCode } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  const [createdInvoice, setCreatedInvoice] = useState<any>(null);

  const handleInvoiceCreated = (result: any) => {
    setCreatedInvoice(result);
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
              One-Click Crypto Invoice
            </h1>
            <h1 className="text-lg font-bold text-gray-900 sm:hidden">
              Crypto Invoice
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <WalletConnect />
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
            Create Crypto Invoices
            <span className="text-stellar-600"> in Seconds</span>
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Accept payments on Stellar blockchain with automatic verification
            and real-time tracking
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          <div className="card text-center">
            <div className="w-12 h-12 bg-stellar-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Zap className="w-6 h-6 text-stellar-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Instant Creation</h3>
            <p className="text-gray-600 text-sm">
              Generate invoices with payment links and QR codes instantly
            </p>
          </div>

          <div className="card text-center">
            <div className="w-12 h-12 bg-stellar-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="w-6 h-6 text-stellar-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Auto Verification</h3>
            <p className="text-gray-600 text-sm">
              Payments are automatically verified using memo and amount
            </p>
          </div>

          <div className="card text-center">
            <div className="w-12 h-12 bg-stellar-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <QrCode className="w-6 h-6 text-stellar-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">QR Payments</h3>
            <p className="text-gray-600 text-sm">
              Easy mobile payments with QR code scanning
            </p>
          </div>
        </div>

        {/* Invoice Creation Form */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <div className="card">
              <h3 className="text-2xl font-bold text-gray-900 mb-6">
                Create New Invoice
              </h3>
              <InvoiceForm onSuccess={handleInvoiceCreated} />
            </div>
          </div>

          <div>
            {createdInvoice ? (
              <div className="card">
                <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">
                  Invoice Created! 🎉
                </h3>
                
                <div className="mb-6">
                  <QRCodeDisplay
                    value={createdInvoice.paymentUrl}
                    title="Payment Link"
                    size={200}
                  />
                </div>

                <div className="space-y-4">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Invoice ID</p>
                    <p className="font-mono text-sm">{createdInvoice.invoice.id}</p>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Amount</p>
                    <p className="font-semibold text-lg">
                      {createdInvoice.invoice.amount} {createdInvoice.invoice.assetCode}
                    </p>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Payment Memo</p>
                    <p className="font-mono text-sm">{createdInvoice.invoice.memo}</p>
                  </div>

                  <div className="flex gap-2">
                    <Link
                      href={`/invoice/${createdInvoice.invoice.id}`}
                      className="btn btn-primary flex-1"
                    >
                      View Invoice
                    </Link>
                    <button
                      onClick={() => setCreatedInvoice(null)}
                      className="btn btn-secondary"
                    >
                      New Invoice
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card bg-gray-50 text-center">
                <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">
                  No Invoice Yet
                </h3>
                <p className="text-gray-600">
                  Fill out the form to create your first invoice
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
            One-Click Crypto Invoice © 2024 - Open Source Project
          </p>
        </div>
      </footer>
    </div>
  );
}

