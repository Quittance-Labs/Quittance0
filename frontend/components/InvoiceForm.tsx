'use client';

import { useEffect, useState } from 'react';
import { apiErrorMessage, invoiceApi, isApiUnavailableError } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, AlertTriangle } from 'lucide-react';
import { STELLAR_ASSETS, getAssetByCode } from '@/lib/assets';
import { useWalletStore } from '@/lib/store';
import { NETWORK_DISPLAY_NAME } from '@/lib/stellar';
import { showFreighterWrongNetworkPrompt } from './FreighterInstallPrompt';
import AssetLogo from './AssetLogo';
import ApiErrorState from './ApiErrorState';
import { walletSessionGate } from '@/lib/wallet-session';
import { EXPECTED_WALLET_NETWORK } from '@/lib/stellar';
import { showFreighterInstallPrompt } from './FreighterInstallPrompt';
import { parseAmountInput } from '@/lib/parse-amount-input';
import { clearInvoiceDraft, loadInvoiceDraft, saveInvoiceDraft } from '@/lib/invoice-draft';
import {
  fieldErrorSummary,
  fieldErrorsFromApiError,
  firstInvalidFieldId,
  formFieldErrors,
} from '@/lib/invoice-form-validation';

interface InvoiceFormProps {
  onSuccess?: (invoice: any) => void;
  userWallet?: string;
}

function focusField(fieldId: string | null) {
  if (!fieldId) return;
  const element = document.getElementById(fieldId);
  if (element instanceof HTMLElement) {
    element.focus();
  }
}

export default function InvoiceForm({ onSuccess, userWallet }: InvoiceFormProps) {
  const { publicKey, connected, network, freighterAvailable } = useWalletStore();
  const [loading, setLoading] = useState(false);
  // The page renders this form only while the wallet gate is ready, so a
  // Freighter disconnect unmounts it. The draft is read once on mount so the
  // fields someone had typed come back; only typed fields are stored, never
  // anything about the wallet (issue #442, lib/invoice-draft.js).
  const [initialDraft] = useState(() => loadInvoiceDraft());
  const [amount, setAmount] = useState(initialDraft.amount ?? '');
  const [assetCode, setAssetCode] = useState(initialDraft.assetCode ?? 'XLM');
  const [description, setDescription] = useState(initialDraft.description ?? '');
  const [sellerName, setSellerName] = useState(initialDraft.sellerName ?? '');
  const [sellerEmail, setSellerEmail] = useState(initialDraft.sellerEmail ?? '');
  const [customerName, setCustomerName] = useState(initialDraft.customerName ?? '');
  const [customerEmail, setCustomerEmail] = useState(initialDraft.customerEmail ?? '');
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [expiresInDays, setExpiresInDays] = useState(initialDraft.expiresInDays ?? 7);
  const { isWrongNetwork } = useWalletStore();

  // Whatever is typed is kept for the next mount, so a disconnect in the middle
  // of filling the form costs nothing.
  useEffect(() => {
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
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const sellerWallet = userWallet || publicKey || undefined;
    // The session module normalises the store first, so a store that claims
    // connected without a public key cannot enable the submit button.
    const gate = walletSessionGate(
      { freighterAvailable, connected, publicKey: sellerWallet, network },
      EXPECTED_WALLET_NETWORK
    );
    if (!gate.ready) {
      showFreighterInstallPrompt(gate);
      return;
    }

    if (isWrongNetwork) {
      showFreighterWrongNetworkPrompt(NETWORK_DISPLAY_NAME);
      return;
    }

    // One parser and one rule set for the whole create path, asked before the
    // request so the message under an input is the sentence the server would
    // have answered with - the two local regexes and the toast-only checks are
    // gone. When the parser refuses, the raw text goes along: an empty box and
    // letters in the box are different mistakes.
    const parsedValue = parseAmountInput(amount);
    const parsedAmount = parsedValue as number;

    const preflight = formFieldErrors({
      sellerPublicKey: sellerWallet,
      amount:
        parsedValue === null && amount.trim() !== '' ? amount.trim() : parsedValue ?? undefined,
      assetCode,
      assetIssuer: getAssetByCode(assetCode)?.issuer,
      description: description || undefined,
      customerName: customerName.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      sellerName: sellerName.trim() || undefined,
      sellerEmail: sellerEmail.trim() || undefined,
      expiresInDays,
      network: EXPECTED_WALLET_NETWORK,
    });

    if (Object.keys(preflight).length > 0) {
      setFieldErrors(preflight);
      focusField(firstInvalidFieldId(preflight));
      return;
    }

    setFieldErrors({});

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
      onSuccess?.(result.data);
      setAmount('');
      setAssetCode('XLM');
      setDescription('');
      setSellerName('');
      setSellerEmail('');
      setCustomerName('');
      setCustomerEmail('');
      setExpiresInDays(7);
      // The invoice exists now, so the draft has served its purpose.
      clearInvoiceDraft();
    } catch (error: any) {
      // A refusal that names fields belongs under those fields; anything else
      // (an unreachable API, a 500) keeps the banner-and-toast path.
      const serverFieldErrors = fieldErrorsFromApiError(error);
      if (Object.keys(serverFieldErrors).length > 0) {
        setFieldErrors(serverFieldErrors);
        focusField(firstInvalidFieldId(serverFieldErrors));
        toast.error(fieldErrorSummary(serverFieldErrors) || 'Could not create the invoice');
        return;
      }

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

      {isWrongNetwork && (
        <div
          role="alert"
          className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-2.5 text-xs text-amber-900"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">Wrong Stellar Network</p>
            <p className="mt-0.5 text-amber-800">
              Your wallet is connected to a different network. Please switch to {NETWORK_DISPLAY_NAME} in Freighter before creating invoices.
            </p>
          </div>
        </div>
      )}

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
            aria-invalid={fieldErrors.amount ? true : undefined}
            aria-describedby={
              fieldErrors.amount
                ? 'invoice-amount-hint invoice-amount-error'
                : 'invoice-amount-hint'
            }
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
          {assetCode === 'USDC'
            ? 'The amount your client pays in USDC (requires a USDC trustline on Stellar).'
            : 'The amount your client pays, in the selected asset.'}
        </p>
        {fieldErrors.amount && (
          <p id="invoice-amount-error" className="field-hint text-red-600" role="alert">
            {fieldErrors.amount}
          </p>
        )}
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
            aria-invalid={fieldErrors.sellerEmail ? true : undefined}
            aria-describedby={fieldErrors.sellerEmail ? 'seller-email-error' : undefined}
          />
          {fieldErrors.sellerEmail && (
            <p id="seller-email-error" className="field-hint text-red-600" role="alert">
              {fieldErrors.sellerEmail}
            </p>
          )}
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
          aria-invalid={fieldErrors.customerEmail ? true : undefined}
          aria-describedby={
            fieldErrors.customerEmail
              ? 'customer-email-hint customer-email-error'
              : 'customer-email-hint'
          }
          className="input text-sm"
          placeholder="client@example.com"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          maxLength={255}
        />
        <p id="customer-email-hint" className="field-hint">
          Used only to send the invoice or payment proof. Not required to create an invoice.
        </p>
        {fieldErrors.customerEmail && (
          <p id="customer-email-error" className="field-hint text-red-600" role="alert">
            {fieldErrors.customerEmail}
          </p>
        )}
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
