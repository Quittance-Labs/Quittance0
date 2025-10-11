'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { invoiceApi } from '@/lib/api';
import PaymentButton from '@/components/PaymentButton';
import PaymentStatus from '@/components/PaymentStatus';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import WalletConnect from '@/components/WalletConnect';
import { formatAmount, formatDate, getTimeRemaining, copyToClipboard } from '@/lib/utils';
import { Copy, ExternalLink, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';

export default function PaymentPage() {
  const params = useParams();
  const id = params.id as string;

  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paymentInfo, setPaymentInfo] = useState<any>(null);

  useEffect(() => {
    loadInvoice();
  }, [id]);

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
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-12 h-12 animate-spin text-stellar-600" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card text-center max-w-md">
          <h2 className="text-2xl font-bold text-red-600 mb-2">Invoice Not Found</h2>
          <p className="text-gray-600">The invoice you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  const horizonUrl =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET'
      ? 'https://stellar.expert/explorer/testnet'
      : 'https://stellar.expert/explorer/public';

  return (
    <div className="min-h-screen bg-gradient-to-br from-stellar-50 to-white py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header with Wallet Connect */}
        <div className="flex justify-end mb-6">
          <WalletConnect />
        </div>

        {/* Page Title */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Complete Payment</h1>
          <p className="text-gray-600">Pay with your Stellar wallet</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Payment Details */}
          <div className="card">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Payment Details</h2>

            <div className="space-y-4 mb-6">
              <div className="bg-stellar-50 border-2 border-stellar-200 rounded-xl p-6 text-center">
                <p className="text-sm text-gray-600 mb-2">Amount to Pay</p>
                <p className="text-5xl font-bold text-stellar-700">
                  {formatAmount(invoice.amount, 7)}
                </p>
                <p className="text-2xl font-semibold text-stellar-600 mt-1">XLM</p>
              </div>

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
                      {invoice.amount} XLM
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
              <div className="card text-center py-8">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4">
                  <Check className="w-12 h-12 text-green-600" />
                </div>
                <h3 className="text-2xl font-bold text-green-700 mb-2">Payment Successful!</h3>
                <p className="text-gray-600 mb-4">Your payment has been confirmed on the blockchain</p>
                {invoice.paymentTxHash && (
                  <a
                    href={`${horizonUrl}/tx/${invoice.paymentTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary inline-flex items-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View Transaction
                  </a>
                )}
              </div>
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

            {invoice.status === 'PENDING' && (
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

