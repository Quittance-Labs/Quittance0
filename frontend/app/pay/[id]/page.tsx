'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { invoiceApi } from '@/lib/api';
import PaymentButton from '@/components/PaymentButton';
import PaymentStatus from '@/components/PaymentStatus';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import WalletConnect from '@/components/WalletConnect';
import UserProfile from '@/components/UserProfile';
import PaymentReceipt from '@/components/PaymentReceipt';
import AssetLogo from '@/components/AssetLogo';
import { formatAmount, formatDate, getTimeRemaining, copyToClipboard } from '@/lib/utils';
import { Copy, ExternalLink, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';

export default function PaymentPage() {
  const params = useParams();
  const id = params.id as string;

  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paymentInfo, setPaymentInfo] = useState<any>(null);
  const [polling, setPolling] = useState(true);
  const [userWallet, setUserWallet] = useState<string | null>(null);

  useEffect(() => {
    loadInvoice();
  }, [id]);

  // Auto-refresh for pending invoices
  useEffect(() => {
    if (!invoice || invoice.status !== 'PENDING' || !polling) {
      return;
    }

    const intervalId = setInterval(async () => {
      try {
        const result = await invoiceApi.getById(id);
        if (result.data.status !== 'PENDING') {
          setInvoice(result.data);
          setPolling(false);
          if (result.data.status === 'PAID') {
            toast.success('Payment confirmed! 🎉');
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(intervalId);
  }, [invoice, id, polling]);

  const loadInvoice = async () => {
    try {
      const [invoiceResult, paymentResult] = await Promise.all([
        invoiceApi.getById(id),
        invoiceApi.getPaymentInfo(id),
      ]);

      setInvoice(invoiceResult.data);
      setPaymentInfo(paymentResult.data);
    } catch (error: any) {
      toast.error('Failed to load invoice');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSuccess = async (txHash: string) => {
    toast.success('Payment confirmed! Verifying...');
    
    // Wait a bit for blockchain confirmation
    setTimeout(async () => {
      await loadInvoice();
    }, 3000);
  };

  const copyInfo = async (text: string, label: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      toast.success(`${label} copied!`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-logo-pattern relative flex items-center justify-center">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full blur-2xl opacity-30"></div>
          <Loader2 className="w-16 h-16 animate-spin text-cyan-400 relative z-10" />
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-logo-pattern relative flex items-center justify-center">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
        <div className="card text-center max-w-md relative z-10">
          <h2 className="text-2xl font-bold text-red-600 mb-2">Invoice Not Found</h2>
          <p className="text-gray-700">The invoice you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  const horizonUrl =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET'
      ? 'https://stellar.expert/explorer/testnet'
      : 'https://stellar.expert/explorer/public';

  return (
    <div className="min-h-screen bg-logo-pattern relative py-8 sm:py-12 px-4">
      {/* Animated Background Orbs */}
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>
      
      <div className="max-w-4xl mx-auto relative z-10">
        {/* Fixed Header */}
        <header className="fixed top-0 left-0 right-0 z-50 premium-header border-b border-gray-200">
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
              {!userWallet ? (
                <WalletConnect onConnect={setUserWallet} />
              ) : (
                <UserProfile userWallet={userWallet} onDisconnect={() => setUserWallet(null)} />
              )}
            </div>
          </div>
        </header>

        {/* Main Content with Header Offset */}
        <div className="pt-20">

        {/* Page Title */}
        <div className="text-center mb-10 sm:mb-12">
          <div className="inline-block mb-4 px-6 py-2 bg-gradient-to-r from-cyan-400/20 to-blue-500/20 backdrop-blur-md rounded-full border border-white/30">
            <span className="text-white text-sm font-semibold tracking-wide">💳 Secure Payment</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-3">Complete Payment</h1>
          <p className="text-xl text-white/90">Pay with your Stellar wallet</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
          {/* Payment Details */}
          <div className="card">
            <h2 className="text-3xl font-bold text-gray-900 mb-8">Payment Details</h2>

            <div className="space-y-5 mb-8">
              <div className="bg-gradient-to-br from-cyan-50 to-blue-50 border-2 border-cyan-200/50 rounded-2xl p-8 text-center shadow-lg">
                <p className="text-sm text-gray-600 mb-4 font-semibold uppercase tracking-wide">Amount to Pay</p>
                <div className="flex items-center justify-center gap-4">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full blur-lg opacity-40"></div>
                    <AssetLogo code={invoice.assetCode} size={50} showName={false} />
                  </div>
                  <div>
                    <p className="text-5xl sm:text-6xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
                      {formatAmount(invoice.amount, 7)}
                    </p>
                    <p className="text-xl font-bold text-cyan-600 mt-2">
                      {invoice.assetCode}
                    </p>
                  </div>
                </div>
              </div>

              {invoice.description && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-1">📝 Payment For</p>
                  <p className="text-gray-800 font-medium">{invoice.description}</p>
                </div>
              )}

              {(invoice.customerName || invoice.customerEmail) && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                  <p className="text-sm text-gray-600 font-semibold">Customer Information</p>
                  {invoice.customerName && (
                    <div>
                      <p className="text-xs text-gray-500">Name</p>
                      <p className="text-sm text-gray-800">{invoice.customerName}</p>
                    </div>
                  )}
                  {invoice.customerEmail && (
                    <div>
                      <p className="text-xs text-gray-500">Email</p>
                      <p className="text-sm text-gray-800">{invoice.customerEmail}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="border-b pb-4">
                <p className="text-sm text-gray-600 mb-1">Status</p>
                <div className="inline-flex items-center gap-2 mt-1">
                  {invoice.status === 'PENDING' && (
                    <>
                      <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                      <span className="text-yellow-700 font-semibold">Waiting for Payment</span>
                    </>
                  )}
                  {invoice.status === 'PAID' && (
                    <>
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-green-700 font-semibold">Paid</span>
                    </>
                  )}
                  {invoice.status === 'EXPIRED' && (
                    <>
                      <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      <span className="text-red-700 font-semibold">Expired</span>
                    </>
                  )}
                </div>
              </div>

              {invoice.status === 'PENDING' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800 font-semibold mb-1">⏰ Expires In</p>
                  <p className="text-blue-700 font-semibold text-lg">
                    {getTimeRemaining(invoice.expiresAt)}
                  </p>
                </div>
              )}
            </div>

            {/* Payment Instructions for Manual Transfer */}
            {invoice.status === 'PENDING' && (
              <div className="bg-gray-50 p-4 rounded-lg space-y-3 border">
                <h3 className="font-semibold text-gray-900 mb-3">📋 Manual Payment Info</h3>
                
                <div>
                  <p className="text-xs text-gray-600 mb-1">Destination Address</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white p-2 rounded border truncate">
                      {invoice.sellerPublicKey}
                    </code>
                    <button
                      onClick={() => copyInfo(invoice.sellerPublicKey, 'Address')}
                      className="p-2 hover:bg-gray-200 rounded transition"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-600 mb-1">Memo (Required)</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white p-2 rounded border font-semibold">
                      {invoice.memo}
                    </code>
                    <button
                      onClick={() => copyInfo(invoice.memo, 'Memo')}
                      className="p-2 hover:bg-gray-200 rounded transition"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-600 mb-1">Exact Amount</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white p-2 rounded border font-semibold">
                      {invoice.amount} {invoice.assetCode}
                    </code>
                    <button
                      onClick={() => copyInfo(invoice.amount.toString(), 'Amount')}
                      className="p-2 hover:bg-gray-200 rounded transition"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Payment Actions */}
          <div className="space-y-6">
            {invoice.status === 'PAID' && (
              <PaymentReceipt invoice={invoice} />
            )}

            {invoice.status === 'EXPIRED' && (
              <div className="card text-center py-8">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-red-100 rounded-full mb-4">
                  <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-red-700 mb-2">Payment Expired</h3>
                <p className="text-gray-600">This payment link has expired</p>
              </div>
            )}

            {invoice.status === 'PENDING' && !invoice.paymentTxHash && (
              <>
                {/* QR Code */}
                <div className="card">
                  <h3 className="text-lg font-semibold text-center mb-4">Scan QR Code</h3>
                  <QRCodeDisplay
                    value={paymentInfo?.stellarQrCode || paymentInfo?.paymentUrl}
                    title=""
                    size={220}
                  />
                  <p className="text-sm text-gray-600 text-center mt-4">
                    📱 Scan with your Stellar wallet app to pay instantly
                  </p>
                </div>

                {/* Payment with Freighter Wallet */}
                <div className="card">
                  <h3 className="text-xl font-semibold text-center mb-4">Pay with Wallet</h3>
                  
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                    <p className="text-sm text-blue-800 font-semibold mb-2">
                      💳 How to Pay:
                    </p>
                    <ol className="text-sm text-blue-700 space-y-1.5 list-decimal list-inside">
                      <li>Connect your Freighter wallet</li>
                      <li>Click the "Pay with Freighter" button</li>
                      <li>Confirm the transaction</li>
                    </ol>
                  </div>

                  <div className="flex justify-center mb-4">
                    <WalletConnect />
                  </div>

                  <PaymentButton
                    destination={invoice.sellerPublicKey}
                    amount={invoice.amount.toString()}
                    memo={invoice.memo}
                    assetCode={invoice.assetCode}
                    assetIssuer={invoice.assetIssuer}
                    onSuccess={handlePaymentSuccess}
                  />
                  
                  <div className="mt-6 pt-4 border-t text-center">
                    <p className="text-xs text-gray-500 flex items-center justify-center gap-1">
                      🔒 Secure payment on Stellar blockchain
                    </p>
                  </div>
                </div>

                {/* Test Payment Button (MVP) */}
                <div className="card bg-yellow-50 border-yellow-300">
                  <h3 className="text-sm font-semibold text-center mb-3 text-yellow-800">
                    🧪 Test Mode
                  </h3>
                  <p className="text-xs text-yellow-700 mb-4 text-center">
                    Simulate a payment without using a real wallet (for testing only)
                  </p>
                  <button
                    onClick={async () => {
                      try {
                        setLoading(true);
                        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invoices/${id}/simulate-payment`, {
                          method: 'POST',
                        });
                        const result = await response.json();
                        
                        if (result.success) {
                          toast.success('Test payment successful! 🎉');
                          await loadInvoice();
                          setPolling(false);
                        } else {
                          toast.error(result.error || 'Failed to simulate payment');
                        }
                      } catch (error: any) {
                        toast.error('Failed to simulate payment');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    disabled={loading}
                    className="btn btn-secondary w-full flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Simulating...
                      </>
                    ) : (
                      '🧪 Simulate Payment'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        </div>
      </div>
    </div>
  );
}

