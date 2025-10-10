'use client';

import { useState } from 'react';
import { invoiceApi } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface InvoiceFormProps {
  onSuccess?: (invoice: any) => void;
}

export default function InvoiceForm({ onSuccess }: InvoiceFormProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    amount: '',
    assetCode: 'XLM',
    description: '',
    customerName: '',
    customerEmail: '',
    expiresInDays: 7,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await invoiceApi.create({
        amount: parseFloat(formData.amount),
        assetCode: formData.assetCode,
        description: formData.description || undefined,
        customerName: formData.customerName || undefined,
        customerEmail: formData.customerEmail || undefined,
        expiresInDays: formData.expiresInDays,
      });

      toast.success('Invoice created successfully!');
      
      if (onSuccess) {
        onSuccess(result.data);
      }

      // Reset form
      setFormData({
        amount: '',
        assetCode: 'XLM',
        description: '',
        customerName: '',
        customerEmail: '',
        expiresInDays: 7,
      });
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create invoice');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Amount *</label>
        <div className="flex gap-2">
          <input
            type="number"
            step="0.0000001"
            min="0"
            required
            className="input flex-1"
            placeholder="100.00"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
          />
          <select
            className="input w-32"
            value={formData.assetCode}
            onChange={(e) => setFormData({ ...formData, assetCode: e.target.value })}
          >
            <option value="XLM">XLM</option>
            <option value="USDC">USDC</option>
          </select>
        </div>
      </div>

      <div>
        <label className="label">Description</label>
        <textarea
          className="input"
          rows={3}
          placeholder="Invoice description..."
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Customer Name</label>
          <input
            type="text"
            className="input"
            placeholder="John Doe"
            value={formData.customerName}
            onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
          />
        </div>

        <div>
          <label className="label">Customer Email</label>
          <input
            type="email"
            className="input"
            placeholder="john@example.com"
            value={formData.customerEmail}
            onChange={(e) => setFormData({ ...formData, customerEmail: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className="label">Expires In (Days)</label>
        <input
          type="number"
          min="1"
          max="365"
          className="input"
          value={formData.expiresInDays}
          onChange={(e) => setFormData({ ...formData, expiresInDays: parseInt(e.target.value) })}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn btn-primary w-full flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Creating Invoice...
          </>
        ) : (
          'Create Invoice'
        )}
      </button>
    </form>
  );
}

