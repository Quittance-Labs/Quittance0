'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { invoiceApi } from '@/lib/api';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import PaymentStatus from '@/components/PaymentStatus';
import WalletConnect from '@/components/WalletConnect';
import { formatAmount, formatDate, getTimeRemaining, getShareUrl } from '@/lib/utils';
import { ArrowLeft, Share2, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [invoice, setInvoice] = useState<any>(null);
  const [paymentInfo, setPaymentInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
    } catch (error) {
      toast.error('Failed to load invoice');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    const url = getShareUrl(invoice.id);
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Payment Invoice',
          text: `Pay ${invoice.amount} ${invoice.assetCode}`,
          url,
        });
      } catch (error) {
        console.log('Share cancelled');
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success('Payment link copied!');
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
        </div>
      </div>
    );
  }

  const horizonUrl =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET'
      ? 'https://stellar.expert/explorer/testnet'
      : 'https://stellar.expert/explorer/public';

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.back()}
            className="btn btn-outline flex items-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          
          <div className="flex items-center gap-3">
            <WalletConnect />
            {invoice.status === 'PENDING' && (
              <button
                onClick={handleShare}
                className="btn btn-primary flex items-center gap-2"
              >
                <Share2 className="w-5 h-5" />
                Share
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Invoice Details */}
          <div className="card">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Invoice Details</h2>

            <div className="space-y-4">
              <div className="border-b pb-4">
                <p className="text-sm text-gray-600 mb-1">Invoice ID</p>
                <p className="font-mono text-sm text-gray-900">{invoice.id}</p>
              </div>

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

              {invoice.customerEmail && (
                <div className="border-b pb-4">
                  <p className="text-sm text-gray-600 mb-1">Customer Email</p>
                  <p className="text-gray-900">{invoice.customerEmail}</p>
                </div>
              )}

              <div className="border-b pb-4">
                <p className="text-sm text-gray-600 mb-1">Memo</p>
                <p className="font-mono text-sm text-gray-900">{invoice.memo}</p>
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

              {invoice.paidAt && (
                <div className="border-b pb-4">
                  <p className="text-sm text-gray-600 mb-1">Paid At</p>
                  <p className="text-gray-900">{formatDate(invoice.paidAt)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Payment Info */}
          <div className="space-y-6">
            <PaymentStatus status={invoice.status} txHash={invoice.paymentTxHash} />

            {invoice.status === 'PENDING' && paymentInfo && (
              <div className="card">
                <h3 className="text-lg font-semibold mb-4 text-center">
                  Payment QR Code
                </h3>
                <QRCodeDisplay
                  value={paymentInfo.paymentUrl}
                  size={200}
                  showCopy={true}
                />
                <Link
                  href={`/pay/${invoice.id}`}
                  className="btn btn-primary w-full mt-4"
                >
                  Go to Payment Page
                </Link>
              </div>
            )}

            {invoice.paymentTxHash && (
              <div className="card">
                <h3 className="font-semibold mb-4">Transaction Details</h3>
                <div className="space-y-2 mb-4">
                  <div>
                    <p className="text-sm text-gray-600">Transaction Hash</p>
                    <p className="font-mono text-xs text-gray-900 break-all">
                      {invoice.paymentTxHash}
                    </p>
                  </div>
                  {invoice.payerPublicKey && (
                    <div>
                      <p className="text-sm text-gray-600">Payer Address</p>
                      <p className="font-mono text-xs text-gray-900 break-all">
                        {invoice.payerPublicKey}
                      </p>
                    </div>
                  )}
                </div>
                <a
                  href={`${horizonUrl}/tx/${invoice.paymentTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline w-full flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  View on Stellar Explorer
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

