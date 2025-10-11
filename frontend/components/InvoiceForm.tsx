'use client';

import { useState } from 'react';
import { invoiceApi } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { STELLAR_ASSETS, getAssetByCode } from '@/lib/assets';
import AssetLogo from './AssetLogo';

interface InvoiceFormProps {
  onSuccess?: (invoice: any) => void;
  userWallet?: string;
}

export default function InvoiceForm({ onSuccess, userWallet }: InvoiceFormProps) {
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [assetCode, setAssetCode] = useState('XLM');
  const [description, setDescription] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!userWallet) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    setLoading(true);

    try {
      const selectedAsset = getAssetByCode(assetCode);
      
      const result = await invoiceApi.create({
        amount: parseFloat(amount),
        assetCode: assetCode,
        assetIssuer: selectedAsset?.issuer,
        expiresInDays: 7,
        sellerPublicKey: userWallet,
        description: description || undefined,
        customerName: customerName || undefined,
        customerEmail: customerEmail || undefined,
      });

      toast.success('Payment link created successfully!');
      
      if (onSuccess) {
        onSuccess(result.data);
      }

      // Reset form
      setAmount('');
      setAssetCode('XLM');
      setDescription('');
      setCustomerName('');
      setCustomerEmail('');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create payment link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Payment Amount *</label>
        <div className="flex gap-3 flex-col sm:flex-row">
          <input
            type="number"
            step="0.0000001"
            min="0.0000001"
            required
            className="input flex-1 text-2xl font-semibold"
            placeholder="10.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="relative">
            <select
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
              className="input w-full sm:w-40 text-sm font-semibold pl-12 pr-3 appearance-none cursor-pointer"
            >
              {STELLAR_ASSETS.map((asset) => (
                <option key={asset.code} value={asset.code}>
                  {asset.code}
                </option>
              ))}
            </select>
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <AssetLogo code={assetCode} size={24} showName={false} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className="label">Description</label>
        <textarea
          className="input min-h-[80px] resize-none text-sm"
          placeholder="What is this payment for?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Customer Name</label>
          <input
            type="text"
            className="input text-sm"
            placeholder="John Doe"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            maxLength={100}
          />
        </div>

        <div>
          <label className="label">Customer Email</label>
          <input
            type="email"
            className="input text-sm"
            placeholder="john@example.com"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            maxLength={100}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn btn-primary w-full flex items-center justify-center gap-2 mt-6"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Creating...
          </>
        ) : (
          'Create Payment Link'
        )}
      </button>
    </form>
  );
}

