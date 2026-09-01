'use client';

import { useState } from 'react';
import { apiErrorMessage, invoiceApi, isApiUnavailableError } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { STELLAR_ASSETS, getAssetByCode } from '@/lib/assets';
import AssetLogo from './AssetLogo';
import ApiErrorState from './ApiErrorState';

interface InvoiceFormProps {
  onSuccess?: (invoice: any) => void;
  userWallet?: string;
}

export default function InvoiceForm({ onSuccess, userWallet }: InvoiceFormProps) {
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [assetCode, setAssetCode] = useState('XLM');
  const [description, setDescription] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [sellerEmail, setSellerEmail] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState(7);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!userWallet) {
      toast.error('Connect your wallet first');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      toast.error('Enter a valid client email');
      return;
    }

    if (sellerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sellerEmail)) {
      toast.error('Enter a valid email for yourself');
      return;
    }

    setLoading(true);
    setApiError(null);
    try {
      const selectedAsset = getAssetByCode(assetCode);
      // Creates a pending invoice owned by the connected seller wallet
      const result = await invoiceApi.create({
        amount: parseFloat(amount),
        assetCode: assetCode,
        assetIssuer: selectedAsset?.issuer,
        expiresInDays,
        sellerPublicKey: userWallet,
        sellerName: sellerName.trim() || undefined,
        sellerEmail: sellerEmail.trim() || undefined,
        description: description || undefined,
        customerName: customerName.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
      });

      toast.success('Invoice created');
      onSuccess?.(result.data);
      setAmount('');
      setAssetCode('XLM');
      setDescription('');
      setSellerName('');
      setSellerEmail('');
      setCustomerName('');
      setCustomerEmail('');
      setExpiresInDays(7);
    } catch (error: any) {
      const message = apiErrorMessage(error, 'Failed to create invoice');
      if (isApiUnavailableError(error)) setApiError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    /*
     * Every control below is associated with a visible `<label htmlFor>`. They
     * previously relied on an adjacent unassociated `<label>` plus a
     * `placeholder`, which axe accepts as a name but which disappears the moment
     * the field has a value — leaving a screen-reader user editing an unnamed
     * box. The asset `<select>` had neither, and failed axe's `select-name`
     * outright.
     */
    <form onSubmit={handleSubmit} className="space-y-4" aria-labelledby="invoice-form-heading">
      <h3 id="invoice-form-heading" className="sr-only">
        Invoice details
      </h3>

      {apiError && <ApiErrorState message={apiError} compact />}
      <div>
        <label htmlFor="invoice-amount" className="label">
          Invoice amount <span aria-hidden="true">*</span>
          <span className="sr-only">(required)</span>
        </label>
        <div className="flex gap-3 flex-col sm:flex-row">
          <input
            id="invoice-amount"
            name="amount"
            type="number"
            step="0.0000001"
            min="0.0000001"
            required
            aria-required="true"
            aria-describedby="invoice-amount-hint"
            className="input flex-1 text-2xl font-semibold"
            placeholder="10.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="relative">
            <label htmlFor="invoice-asset" className="sr-only">
              Asset
            </label>
            <select
              id="invoice-asset"
              name="assetCode"
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
            {/*
              The logo repeats the asset code already announced by the select's
              own value, so it is hidden from assistive technology rather than
              read twice.
            */}
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <AssetLogo code={assetCode} size={24} showName={false} decorative />
            </div>
          </div>
        </div>
        <p id="invoice-amount-hint" className="field-hint">
          The amount your client pays, in the selected asset.
        </p>
      </div>

      <div>
        <label htmlFor="invoice-description" className="label">
          Description
        </label>
        <textarea
          id="invoice-description"
          name="description"
          className="input min-h-[80px] resize-none text-sm"
          placeholder="What is this invoice for?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />
      </div>

      <div>
        <label className="label" htmlFor="invoice-expiry">Payment window</label>
        <select
          id="invoice-expiry"
          className="input w-full text-sm"
          value={expiresInDays}
          onChange={(event) => setExpiresInDays(Number(event.target.value))}
        >
          {[1, 3, 7, 14, 30].map((days) => (
            <option key={days} value={days}>
              {days} day{days === 1 ? '' : 's'}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          After this window the invoice stays in history but cannot be paid or verified.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="seller-name" className="label">
            Your name (optional)
          </label>
          <input
            id="seller-name"
            name="sellerName"
            type="text"
            autoComplete="name"
            className="input text-sm"
            placeholder="Your name or business"
            value={sellerName}
            onChange={(e) => setSellerName(e.target.value)}
            maxLength={255}
          />
        </div>

        <div>
          <label htmlFor="seller-email" className="label">
            Your email (optional)
          </label>
          <input
            id="seller-email"
            name="sellerEmail"
            type="email"
            autoComplete="email"
            className="input text-sm"
            placeholder="you@example.com"
            value={sellerEmail}
            onChange={(e) => setSellerEmail(e.target.value)}
            maxLength={255}
          />
        </div>
      </div>

      <div>
        <label htmlFor="customer-name" className="label">
          Client name (optional)
        </label>
        <input
          id="customer-name"
          name="customerName"
          type="text"
          className="input text-sm"
          placeholder="Client or company name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          maxLength={255}
        />
      </div>

      <div>
        <label htmlFor="customer-email" className="label">
          Client email (optional)
        </label>
        <input
          id="customer-email"
          name="customerEmail"
          type="email"
          aria-describedby="customer-email-hint"
          className="input text-sm"
          placeholder="client@example.com"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          maxLength={255}
        />
        <p id="customer-email-hint" className="field-hint">
          Used only to send the invoice or payment proof. Not required to create an invoice.
        </p>
      </div>

      <button
        type="submit"
        disabled={loading}
        aria-busy={loading}
        className="btn btn-primary w-full flex items-center justify-center gap-2 mt-6"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            Creating...
          </>
        ) : (
          'Create Invoice'
        )}
      </button>
    </form>
  );
}
