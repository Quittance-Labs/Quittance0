'use client';

import { useState, useEffect } from 'react';
import { apiErrorMessage, invoiceApi, isApiUnavailableError } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, AlertTriangle } from 'lucide-react';
import { STELLAR_ASSETS, getAssetByCode } from '@/lib/assets';
import { useWalletStore } from '@/lib/store';
import { NETWORK_DISPLAY_NAME, EXPECTED_WALLET_NETWORK } from '@/lib/stellar';
import { walletGate } from '@/lib/freighter-availability';
import { showFreighterInstallPrompt, showFreighterWrongNetworkPrompt } from './FreighterInstallPrompt';
import WalletConnect from './WalletConnect';
import AssetLogo from './AssetLogo';
import ApiErrorState from './ApiErrorState';
import { loadInvoiceDraft, saveInvoiceDraft, clearInvoiceDraft } from '@/lib/invoice-draft';

interface InvoiceFormProps {
  onSuccess?: (invoice: any) => void;
  userWallet?: string;
}

export default function InvoiceForm({ onSuccess, userWallet }: InvoiceFormProps) {
  const { publicKey, connected, network, freighterAvailable, isWrongNetwork } = useWalletStore();
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
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Restore draft from sessionStorage on initial mount
  useEffect(() => {
    const draft = loadInvoiceDraft();
    if (draft) {
      if (draft.amount) setAmount(draft.amount);
      if (draft.assetCode) setAssetCode(draft.assetCode);
      if (draft.description) setDescription(draft.description);
      if (draft.sellerName) setSellerName(draft.sellerName);
      if (draft.sellerEmail) setSellerEmail(draft.sellerEmail);
      if (draft.customerName) setCustomerName(draft.customerName);
      if (draft.customerEmail) setCustomerEmail(draft.customerEmail);
      if (typeof draft.expiresInDays === 'number') setExpiresInDays(draft.expiresInDays);
    }
    setDraftLoaded(true);
  }, []);

  // Save non-secret draft fields on change
  useEffect(() => {
    if (!draftLoaded) return;
    saveInvoiceDraft({
      amount,
      assetCode,
      description,
      sellerName,
      sellerEmail,
      customerName,
      customerEmail,
      expiresInDays,
    });
  }, [
    amount,
    assetCode,
    description,
    sellerName,
    sellerEmail,
    customerName,
    customerEmail,
    expiresInDays,
    draftLoaded,
  ]);

  const sellerWallet = userWallet || publicKey || undefined;
  const gate = walletGate(
    { freighterAvailable, connected, publicKey: sellerWallet, network },
    EXPECTED_WALLET_NETWORK
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!gate.ready) {
      showFreighterInstallPrompt(gate);
      return;
    }

    if (isWrongNetwork) {
      showFreighterWrongNetworkPrompt(NETWORK_DISPLAY_NAME);
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
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
        amount: parsedAmount,
        assetCode: assetCode,
        assetIssuer: selectedAsset?.issuer,
        expiresInDays,
        sellerPublicKey: sellerWallet,
        network: EXPECTED_WALLET_NETWORK,
        sellerName: sellerName.trim() || undefined,
        sellerEmail: sellerEmail.trim() || undefined,
        description: description || undefined,
        customerName: customerName.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
      });

      toast.success('Invoice created');
      clearInvoiceDraft();
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
    <form onSubmit={handleSubmit} className="space-y-4" aria-labelledby="invoice-form-heading">
      <h3 id="invoice-form-heading" className="sr-only">
        Invoice details
      </h3>

      {!gate.ready ? (
        <div
          role="alert"
          className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center mb-4"
        >
          <AlertTriangle className="w-6 h-6 text-amber-600 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-semibold text-amber-900 mb-1">{gate.title}</p>
          <p className="text-xs text-amber-800 mb-3">
            {gate.status === 'disconnected'
              ? 'Wallet disconnected: connect Freighter to finish creating your invoice. Your entered fields are preserved.'
              : gate.message}
          </p>
          <div className="flex justify-center">
            <WalletConnect />
          </div>
        </div>
      ) : isWrongNetwork ? (
        <div
          role="alert"
          className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-2.5 text-xs text-amber-900 mb-4"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">Wrong Stellar Network</p>
            <p className="mt-0.5 text-amber-800">
              Your wallet is connected to a different network. Please switch to {NETWORK_DISPLAY_NAME} in Freighter before creating invoices.
            </p>
          </div>
        </div>
      ) : null}

      {apiError && <ApiErrorState message={apiError} compact />}

      <div>
        <label htmlFor="invoice-amount" className="label">
          Invoice amount <span aria-hidden="true">*</span>
        </label>
        <div className="flex gap-2">
          <input
            id="invoice-amount"
            name="amount"
            type="number"
            step="0.0000001"
            min="0.0000001"
            required
            aria-required="true"
            aria-describedby="amount-hint"
            className="input flex-1 text-lg font-semibold"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="relative">
            <label htmlFor="asset-select" className="sr-only">
              Asset
            </label>
            <select
              id="asset-select"
              name="assetCode"
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
              className="input pr-8 font-semibold bg-gray-50 border-gray-300 h-full"
            >
              {STELLAR_ASSETS.map((asset) => (
                <option key={asset.code} value={asset.code}>
                  {asset.code}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p id="amount-hint" className="field-hint">
          Set the exact amount your client must send. Amounts are denominated in {assetCode}.
        </p>
      </div>

      <div>
        <label htmlFor="invoice-description" className="label">
          Description / Project details (optional)
        </label>
        <textarea
          id="invoice-description"
          name="description"
          aria-describedby="description-hint"
          className="input text-sm resize-none h-20"
          placeholder="e.g. Website redesign - Milestone 1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={255}
        />
        <p id="description-hint" className="field-hint">
          A short summary that appears on the invoice and payment proof.
        </p>
      </div>

      <div>
        <label htmlFor="expires-in" className="label">
          Invoice expiry
        </label>
        <select
          id="expires-in"
          name="expiresInDays"
          aria-describedby="expires-hint"
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(Number(e.target.value))}
          className="input text-sm"
        >
          <option value={1}>1 day</option>
          <option value={3}>3 days</option>
          <option value={7}>7 days (recommended)</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
        </select>
        <p id="expires-hint" className="field-hint">
          Invoices that are not settled before expiring cannot be paid on-chain.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="seller-name" className="label">
            Your name / Company (optional)
          </label>
          <input
            id="seller-name"
            name="sellerName"
            type="text"
            className="input text-sm"
            placeholder="Jane Doe"
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
        disabled={loading || !gate.ready || isWrongNetwork}
        aria-busy={loading}
        className="btn btn-primary w-full flex items-center justify-center gap-2 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            Creating...
          </>
        ) : !gate.ready ? (
          'Connect Wallet to Create'
        ) : isWrongNetwork ? (
          'Switch Network to Create'
        ) : (
          'Create Invoice'
        )}
      </button>
    </form>
  );
}
