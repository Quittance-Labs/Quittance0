'use client';

import { useState } from 'react';
import { invoiceApi } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface InvoiceFormProps {
  onSuccess?: (invoice: any) => void;
  userWallet?: string;
}

export default function InvoiceForm({ onSuccess, userWallet }: InvoiceFormProps) {
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('');

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
      const result = await invoiceApi.create({
        amount: parseFloat(amount),
        assetCode: 'XLM',
        expiresInDays: 7,
        sellerPublicKey: userWallet,
      });

      toast.success('Payment link created successfully!');
      
      if (onSuccess) {
        onSuccess(result.data);
      }

      // Reset form
      setAmount('');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create payment link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="label text-lg font-semibold mb-3">Payment Amount</label>
        <div className="flex gap-3">
          <input
            type="number"
            step="0.0000001"
            min="0.0000001"
            required
            className="input flex-1 text-2xl py-4 px-6"
            placeholder="10.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="input w-24 text-xl font-bold flex items-center justify-center bg-stellar-50 border-stellar-300 text-stellar-700">
            XLM
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-2">Enter the amount you want to receive in XLM</p>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn btn-primary w-full flex items-center justify-center gap-2 text-lg py-4"
      >
        {loading ? (
          <>
            <Loader2 className="w-6 h-6 animate-spin" />
            Creating Payment Link...
          </>
        ) : (
          'Create Payment Link'
        )}
      </button>
    </form>
  );
}

