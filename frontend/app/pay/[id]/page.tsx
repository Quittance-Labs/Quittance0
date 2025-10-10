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
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Payment Request</h1>
          <p className="text-gray-600">Complete your payment using Stellar</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Invoice Details */}
          <div className="card">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Invoice Details</h2>

            <div className="space-y-4 mb-6">
              <div className="border-b pb-4">
                <p className="text-sm text-gray-600 mb-1">Amount</p>
                <p className="text-3xl font-bold text-stellar-600">
                  {formatAmount(invoice.amount, 7)} {invoice.assetCode}
                </p>
              </div>

              {invoice.description && (
                <div className="border-b pb-4">
                  <p className="text-sm text-gray-600 mb-1">Description</p>
                  <p className="text-gray-900">{invoice.description}</p>
                </div>
              )}

              {invoice.customerName && (
                <div className="border-b pb-4">
                  <p className="text-sm text-gray-600 mb-1">Customer</p>
                  <p className="text-gray-900">{invoice.customerName}</p>
                </div>
              )}

              <div className="border-b pb-4">
                <p className="text-sm text-gray-600 mb-1">Status</p>
                <p className="text-gray-900 font-semibold">{invoice.status}</p>
              </div>

              <div className="border-b pb-4">
                <p className="text-sm text-gray-600 mb-1">Created</p>
                <p className="text-gray-900">{formatDate(invoice.createdAt)}</p>
              </div>

              {invoice.status === 'PENDING' && (
                <div className="border-b pb-4">
                  <p className="text-sm text-gray-600 mb-1">Expires In</p>
                  <p className="text-gray-900 font-semibold">
                    {getTimeRemaining(invoice.expiresAt)}
                  </p>
                </div>
              )}
            </div>

            {/* Payment Instructions for Manual Transfer */}
            <div className="bg-gray-50 p-4 rounded-lg space-y-3">
              <h3 className="font-semibold text-gray-900 mb-3">Manual Payment Info</h3>
              
              <div>
                <p className="text-xs text-gray-600 mb-1">Destination Address</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-white p-2 rounded border truncate">
                    {invoice.sellerPublicKey}
                  </code>
                  <button
                    onClick={() => copyInfo(invoice.sellerPublicKey, 'Address')}
                    className="p-2 hover:bg-gray-200 rounded"
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
                    className="p-2 hover:bg-gray-200 rounded"
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
                    className="p-2 hover:bg-gray-200 rounded"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Actions */}
          <div className="space-y-6">
            {invoice.status === 'PAID' && (
              <PaymentStatus status="PAID" txHash={invoice.paymentTxHash} />
            )}

            {invoice.status === 'EXPIRED' && <PaymentStatus status="EXPIRED" />}

            {invoice.status === 'PENDING' && (
              <>
                {/* QR Code */}
                <div className="card">
                  <QRCodeDisplay
                    value={paymentInfo?.stellarQrCode || paymentInfo?.paymentUrl}
                    title="Scan to Pay"
                    size={200}
                  />
                  <p className="text-xs text-gray-500 text-center mt-4">
                    Scan with your Stellar wallet app
                  </p>
                </div>

                {/* Payment Actions */}
                <div className="space-y-4">
                  {/* Wallet Payment */}
                  <div className="card">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">Pay with Wallet</h3>
                      <div className="scale-90">
                        <WalletConnect />
                      </div>
                    </div>
                    <PaymentButton
                      destination={invoice.sellerPublicKey}
                      amount={invoice.amount.toString()}
                      memo={invoice.memo}
                      assetCode={invoice.assetCode}
                      assetIssuer={invoice.assetIssuer}
                      onSuccess={handlePaymentSuccess}
                    />
                    <p className="text-xs text-gray-500 text-center mt-4">
                      Connect your Freighter wallet above to pay
                    </p>
                  </div>

                  {/* Test Payment (MVP) */}
                  <div className="card bg-gray-50 border-dashed">
                    <p className="text-xs text-gray-600 mb-3 text-center">
                      <strong>Testing without wallet?</strong> Simulate payment:
                    </p>
                    <button
                      onClick={async () => {
                        try {
                          const response = await fetch(
                            `${process.env.NEXT_PUBLIC_API_URL}/invoices/${invoice.id}/simulate-payment`,
                            { method: 'POST' }
                          );
                          const result = await response.json();
                          if (result.success) {
                            toast.success('Payment simulated successfully!');
                            setTimeout(() => loadInvoice(), 1000);
                          }
                        } catch (error) {
                          toast.error('Simulation failed');
                        }
                      }}
                      className="btn btn-outline w-full"
                    >
                      🧪 Simulate Payment (Test)
                    </button>
                  </div>
                </div>
              </>
            )}

            {invoice.paymentTxHash && (
              <div className="card">
                <h3 className="font-semibold mb-2">Transaction</h3>
                <a
                  href={`${horizonUrl}/tx/${invoice.paymentTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline w-full flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  View on Explorer
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

