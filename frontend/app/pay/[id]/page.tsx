'use client';

import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import PayPageHeader from '@/components/PayPageHeader';
import PayAmountBlock from '@/components/PayAmountBlock';
import PayMemoBlock from '@/components/PayMemoBlock';
import PayVerifyPanel from '@/components/PayVerifyPanel';
import PayProofPanel from '@/components/PayProofPanel';
import PayMonitorPanel from '@/components/PayMonitorPanel';
import PaymentResultPanel from '@/components/PaymentResultPanel';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import PaymentButton from '@/components/PaymentButton';
import WalletConnect from '@/components/WalletConnect';
import FreighterInstallPrompt from '@/components/FreighterInstallPrompt';
import ApiErrorState from '@/components/ApiErrorState';
import { copyToClipboard, formatAmount } from '@/lib/utils';
import { openInvoicePDF, shareInvoiceByEmail } from '@/lib/export';
import { getPayPageView, getPayPageWalletGate } from '@/lib/payment-page-state';
import { PAYMENT_STATUS_POLL_INTERVAL_MS } from '@/lib/api';
import { usePaymentPage } from '@/lib/use-payment-page';
import { MAIN_CONTENT_ID, describeAmount, statusText } from '@/lib/a11y';
import { useWalletStore } from '@/lib/store';
import { EXPECTED_WALLET_NETWORK } from '@/lib/stellar';

export default function PaymentPage() {
  const id = useParams().id as string;
  const page = usePaymentPage(id);
  const walletSession = useWalletStore();

  if (page.loading) {
    return (
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-screen bg-logo-pattern relative flex items-center justify-center"
      >
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
        <div className="relative" role="status" aria-live="polite">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full blur-2xl opacity-30"></div>
          <Loader2 className="w-16 h-16 animate-spin text-teal-800 relative z-10" aria-hidden="true" />
          <span className="sr-only">Loading this invoice.</span>
        </div>
      </main>
    );
  }

  if (!page.invoice) {
    if (page.loadError) {
      return (
        <div className="min-h-screen bg-logo-pattern flex items-center justify-center px-4">
          <div className="max-w-lg w-full">
            <ApiErrorState message={page.loadError} onRetry={() => void page.reload()} />
          </div>
        </div>
      );
    }
    return (
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-screen bg-logo-pattern relative flex items-center justify-center"
      >
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
        <div className="card text-center max-w-md relative z-10" role="alert">
          <h1 className="text-2xl font-bold text-red-700 mb-2">Invoice Not Found</h1>
          <p className="text-gray-700">
            {page.loadError ?? 'The invoice you are looking for does not exist.'}
          </p>
        </div>
      </main>
    );
  }

  const invoice = page.invoice;
  const view = getPayPageView(invoice);
  const walletPaymentGate = getPayPageWalletGate(
    invoice,
    walletSession,
    EXPECTED_WALLET_NETWORK
  );
  const copy = async (value: string, label: string) => {
    if (await copyToClipboard(value)) toast.success(`${label} copied`);
  };
  const download = () => {
    openInvoicePDF(invoice);
    toast.success('Opening payment proof');
  };
  const email = () => {
    if (!invoice.customerEmail) return toast.error('No client email on this invoice');
    shareInvoiceByEmail(invoice);
  };

  const amountLabel = describeAmount(formatAmount(invoice.amount, 7), invoice.assetCode);

  return (
    <div className="min-h-screen bg-logo-pattern relative py-8 sm:py-12 px-4">
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>
      <PayPageHeader
        wallet={page.wallet}
      />
      <div className="max-w-4xl mx-auto relative z-10">
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="pt-20">
          {page.loadError && (
            <div className="mb-6">
              <ApiErrorState message={page.loadError} onRetry={() => void page.reload()} compact />
            </div>
          )}
          <div className="text-center mb-10 sm:mb-12">
            <p className="pay-page-kicker">{view.expired ? 'Expired Invoice' : 'Secure Payment'}</p>
            <h1 className="text-4xl sm:text-5xl font-bold text-[var(--ink)] mb-3">
              {view.expired ? 'Invoice Expired' : 'Complete Payment'}
            </h1>
            <p className="text-xl text-[var(--muted)]">
              {view.expired ? 'Payment is no longer available' : 'Pay with your Stellar wallet'}
            </p>
          </div>

          <div className="mb-6">
            <PaymentResultPanel state={page.payment} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
            <div className="space-y-6">
              <PayAmountBlock invoice={invoice} />
              <PayMemoBlock invoice={invoice} onCopy={copy} />
            </div>
            <div className="space-y-6">
              {view.showProof && (
                <PayProofPanel invoice={invoice} onDownload={download} onEmail={email} />
              )}
              {view.expired && (
                <div className="card text-center py-8">
                  <div className="inline-flex items-center justify-center w-20 h-20 bg-red-100 rounded-full mb-4">
                    <svg className="w-12 h-12 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-red-700 mb-2">Payment Expired</h3>
                  <p className="text-gray-700">
                    {statusText('EXPIRED').description}
                  </p>
                </div>
              )}
              {view.showPaymentControls && (
                <>
                  <section aria-label="Stellar payment QR code" className="card text-center">
                    <h3 className="text-lg font-semibold mb-4">Scan QR Code</h3>
                    <QRCodeDisplay
                      value={page.paymentInfo?.stellarQrCode || page.paymentInfo?.paymentUrl || ''}
                      title=""
                      size={220}
                      description={`a request to pay ${amountLabel} with memo ${invoice.memo}`}
                    />
                    <p className="text-sm text-gray-700 text-center mt-4">
                      Scan with your Stellar wallet app to pay instantly
                    </p>
                  </section>
                  <section aria-labelledby="wallet-pay-title" className="card">
                    <h3 id="wallet-pay-title" className="text-xl font-semibold text-center mb-4">
                      Pay with Wallet
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                      <PayerField
                        id="payer-name"
                        label="Your name (optional)"
                        value={page.payerName}
                        onChange={page.setPayerName}
                      />
                      <PayerField
                        id="payer-email"
                        label="Your email (optional)"
                        value={page.payerEmail}
                        onChange={page.setPayerEmail}
                        type="email"
                      />
                    </div>
                    <div className="flex justify-center mb-4">
                      <WalletConnect />
                    </div>
                    {!walletPaymentGate.ready && walletPaymentGate.action !== 'none' && (
                      <FreighterInstallPrompt
                        gate={walletPaymentGate}
                        action={<WalletConnect />}
                        compact
                        className="mb-4"
                      />
                    )}
                    <PaymentButton
                      destination={invoice.sellerPublicKey}
                      amount={String(invoice.amount)}
                      memo={invoice.memo}
                      assetCode={invoice.assetCode}
                      assetIssuer={invoice.assetIssuer}
                      invoiceId={invoice.id}
                      payerName={page.payerName}
                      payerEmail={page.payerEmail}
                      invoiceStatus={view.expired ? 'EXPIRED' : invoice.status}
                      onStart={() => page.dispatch({ type: 'PAY_STARTED' })}
                      onSuccess={(txHash) => {
                        page.dispatch({ type: 'PAY_SENT', txHash });
                        void page.reload();
                      }}
                      onError={(error) => page.dispatch({ type: 'PAY_FAILED', error })}
                    />
                  </section>
                  <PayMonitorPanel
                    active={page.monitoring}
                    intervalMs={
                      page.paymentInfo?.statusPollingIntervalMs ?? PAYMENT_STATUS_POLL_INTERVAL_MS
                    }
                  />
                  <PayVerifyPanel
                    txHash={page.txHash}
                    verifying={page.verifying}
                    onChange={page.setTxHash}
                    onVerify={() => void page.verify()}
                  />
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function PayerField({
  id,
  label,
  value,
  onChange,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label htmlFor={id} className="text-sm font-medium text-gray-700">
      {label}
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={255}
        className="input text-sm mt-1"
      />
    </label>
  );
}
