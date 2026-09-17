'use client';

import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import PayProofPanel from '@/components/PayProofPanel';
import PayMonitorPanel from '@/components/PayMonitorPanel';
import PayVerifyPanel from '@/components/PayVerifyPanel';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import PaymentButton from '@/components/PaymentButton';
import WalletConnect from '@/components/WalletConnect';
import FreighterInstallPrompt from '@/components/FreighterInstallPrompt';
import MobilePaymentFallback from '@/components/MobilePaymentFallback';
import { formatAmount } from '@/lib/utils';
import { emailPaymentProof, openInvoicePDF, shareInvoiceByEmail } from '@/lib/export';
import { getPayPageWalletGate } from '@/lib/payment-page-state';
import { PAYMENT_STATUS_POLL_INTERVAL_MS } from '@/lib/api';
import { describeAmount, statusText } from '@/lib/a11y';
import { useWalletStore } from '@/lib/store';
import { EXPECTED_WALLET_NETWORK, NETWORK_DISPLAY_NAME } from '@/lib/stellar';
import type { PayPageSession } from '@/components/pay-page.types';

interface PayActionsSectionProps {
  session: PayPageSession;
  isMobile: boolean;
  showDesktopWalletAnyway: boolean;
  setShowDesktopWalletAnyway: (show: boolean) => void;
}

/**
 * Interactive actions column for payment, verification, wallet interaction, and settlement proof.
 */
export default function PayActionsSection({
  session,
  isMobile,
  showDesktopWalletAnyway,
  setShowDesktopWalletAnyway,
}: PayActionsSectionProps) {
  const {
    invoice,
    view,
    paymentInfo,
    payerName,
    setPayerName,
    payerEmail,
    setPayerEmail,
    txHash,
    setTxHash,
    verifying,
    monitoring,
    dispatch,
    verify,
    reload,
  } = session;

  const walletSession = useWalletStore();
  const isWrongNetwork = useWalletStore((s) => s.isWrongNetwork);

  if (!invoice) return null;

  const walletPaymentGate = getPayPageWalletGate(
    invoice,
    walletSession,
    EXPECTED_WALLET_NETWORK
  );

  const download = () => {
    openInvoicePDF(invoice);
    toast.success('Opening payment proof');
  };

  const email = () => {
    try {
      if (invoice.status === 'PAID') {
        emailPaymentProof(invoice);
      } else {
        shareInvoiceByEmail(invoice);
      }
      toast.success('Opening email client');
    } catch (err: any) {
      toast.error(err?.message || 'No recipient email on this invoice');
    }
  };

  const amountLabel = describeAmount(formatAmount(invoice.amount, 7), invoice.assetCode);

  return (
    <div className="space-y-6">
      {view.showProof && (
        <PayProofPanel invoice={invoice} onDownload={download} onEmail={email} />
      )}

      {view.expired && (
        <div className="card text-center py-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-red-100 rounded-full mb-4">
            <svg
              className="w-12 h-12 text-red-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h3 className="text-2xl font-bold text-red-700 mb-2">Payment Expired</h3>
          <p className="text-gray-700">{statusText('EXPIRED').description}</p>
        </div>
      )}

      {view.cancelled && (
        <div className="card text-center py-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
            <svg
              className="w-12 h-12 text-gray-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h3 className="text-2xl font-bold text-gray-700 mb-2">Invoice Cancelled</h3>
          <p className="text-gray-700">{statusText('CANCELLED').description}</p>
        </div>
      )}

      {view.showPaymentControls && (
        <>
          <section aria-label="Stellar payment QR code" className="card text-center">
            <h3 className="text-lg font-semibold mb-4">Scan QR Code</h3>
            <QRCodeDisplay
              value={paymentInfo?.stellarQrCode || paymentInfo?.paymentUrl || ''}
              title=""
              size={220}
              description={`a request to pay ${amountLabel} with memo ${invoice.memo}`}
            />
            <p className="text-sm text-gray-700 text-center mt-4">
              Scan with your Stellar wallet app to pay instantly
            </p>
          </section>

          {isMobile && !showDesktopWalletAnyway ? (
            <div className="space-y-4">
              <MobilePaymentFallback
                destination={invoice.sellerPublicKey}
                amount={String(invoice.amount)}
                assetCode={invoice.assetCode}
                assetIssuer={invoice.assetIssuer}
                memo={invoice.memo}
                paymentUrl={
                  paymentInfo?.paymentUrl ||
                  (typeof window !== 'undefined' ? window.location.href : '')
                }
                onCopy={(_text, label) => {
                  dispatch({ type: 'COPIED', key: label });
                }}
              />
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setShowDesktopWalletAnyway(true)}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Show desktop extension controls
                </button>
              </div>
            </div>
          ) : (
            <section aria-labelledby="wallet-pay-title" className="card">
              <h3 id="wallet-pay-title" className="text-xl font-semibold text-center mb-4">
                Pay with Wallet
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <PayerField
                  id="payer-name"
                  label="Your name (optional)"
                  value={payerName}
                  onChange={setPayerName}
                />
                <PayerField
                  id="payer-email"
                  label="Your email (optional)"
                  value={payerEmail}
                  onChange={setPayerEmail}
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
              {walletPaymentGate.ready && isWrongNetwork && (
                <div
                  role="alert"
                  className="mb-4 p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-center gap-3 text-sm text-amber-900"
                >
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">Wrong Stellar Network</p>
                    <p className="mt-0.5 text-xs text-amber-800">
                      Your wallet is connected to a different network. Please switch to {NETWORK_DISPLAY_NAME} in Freighter, then reconnect to pay.
                    </p>
                  </div>
                </div>
              )}
              {!(isWrongNetwork && walletPaymentGate.ready) && (
                <PaymentButton
                  destination={invoice.sellerPublicKey}
                  amount={String(invoice.amount)}
                  memo={invoice.memo}
                  assetCode={invoice.assetCode}
                  assetIssuer={invoice.assetIssuer}
                  invoiceId={invoice.id}
                  payerName={payerName}
                  payerEmail={payerEmail}
                  invoiceStatus={view.expired ? 'EXPIRED' : invoice.status}
                  onStart={() => dispatch({ type: 'PAY_STARTED' })}
                  onSuccess={(submittedTxHash) => {
                    dispatch({ type: 'PAY_SENT', txHash: submittedTxHash });
                    void reload();
                  }}
                  onError={(error) => dispatch({ type: 'PAY_FAILED', error })}
                />
              )}
              {isMobile && showDesktopWalletAnyway && (
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => setShowDesktopWalletAnyway(false)}
                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                  >
                    Return to mobile guidance
                  </button>
                </div>
              )}
            </section>
          )}

          <PayMonitorPanel
            active={monitoring}
            intervalMs={paymentInfo?.statusPollingIntervalMs ?? PAYMENT_STATUS_POLL_INTERVAL_MS}
          />

          <PayVerifyPanel
            txHash={txHash}
            verifying={verifying}
            onChange={setTxHash}
            onVerify={() => void verify()}
          />
        </>
      )}
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
