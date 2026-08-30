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
import QRCodeDisplay from '@/components/QRCodeDisplay';
import PaymentButton from '@/components/PaymentButton';
import WalletConnect from '@/components/WalletConnect';
import { copyToClipboard } from '@/lib/utils';
import { openInvoicePDF, shareInvoiceByEmail } from '@/lib/export';
import { getPayPageView } from '@/lib/payment-page-state';
import { PAYMENT_STATUS_POLL_INTERVAL_MS } from '@/lib/api';
import { usePaymentPage } from '@/lib/use-payment-page';

export default function PaymentPage() {
  const id = useParams().id as string;
  const page = usePaymentPage(id);

  if (page.loading) return <PageMessage><Loader2 className="w-16 h-16 animate-spin text-cyan-400" /></PageMessage>;
  if (!page.invoice) return <PageMessage><h2 className="text-2xl font-bold text-red-600">Invoice Not Found</h2></PageMessage>;

  const invoice = page.invoice;
  const view = getPayPageView(invoice);
  const copy = async (value: string, label: string) => {
    if (await copyToClipboard(value)) toast.success(`${label} copied`);
  };
  const download = () => { openInvoicePDF(invoice); toast.success('Opening payment proof'); };
  const email = () => {
    if (!invoice.customerEmail) return toast.error('No client email on this invoice');
    shareInvoiceByEmail(invoice);
  };

  return (
    <main className="min-h-screen bg-logo-pattern relative py-8 sm:py-12 px-4">
      <PayPageHeader wallet={page.wallet} onConnect={page.setWallet} onDisconnect={() => page.setWallet(null)} />
      <div className="max-w-4xl mx-auto relative z-10 pt-20">
        <div className="text-center mb-10 sm:mb-12">
          <p className="pay-page-kicker">{view.expired ? 'Expired Invoice' : 'Secure Payment'}</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-[var(--ink)] mb-3">{view.expired ? 'Invoice Expired' : 'Complete Payment'}</h1>
          <p className="text-xl text-[var(--muted)]">{view.expired ? 'Payment is no longer available' : 'Pay with your Stellar wallet'}</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
          <div className="space-y-6">
            <PayAmountBlock invoice={invoice} />
            <PayMemoBlock invoice={invoice} onCopy={copy} />
          </div>
          <div className="space-y-6">
            {view.showProof && <PayProofPanel invoice={invoice} onDownload={download} onEmail={email} />}
            {view.expired && <PageMessage><p className="text-red-700 font-semibold">This invoice has expired and can no longer be paid.</p></PageMessage>}
            {view.showPaymentControls && (
              <>
                <section aria-label="Stellar payment QR code" className="card text-center">
                  <h3 className="text-lg font-semibold mb-4">Scan QR Code</h3>
                  <QRCodeDisplay value={page.paymentInfo?.stellarQrCode || page.paymentInfo?.paymentUrl || ''} title="" size={220} />
                  <p className="text-sm text-gray-600 mt-4">Scan with your Stellar wallet app to pay instantly.</p>
                </section>
                <section aria-labelledby="wallet-pay-title" className="card">
                  <h3 id="wallet-pay-title" className="text-xl font-semibold text-center mb-4">Pay with Wallet</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    <PayerField id="payer-name" label="Your name (optional)" value={page.payerName} onChange={page.setPayerName} />
                    <PayerField id="payer-email" label="Your email (optional)" value={page.payerEmail} onChange={page.setPayerEmail} type="email" />
                  </div>
                  <div className="flex justify-center mb-4"><WalletConnect onConnect={page.setWallet} /></div>
                  <PaymentButton destination={invoice.sellerPublicKey} amount={String(invoice.amount)} memo={invoice.memo} assetCode={invoice.assetCode} assetIssuer={invoice.assetIssuer} invoiceId={invoice.id} payerName={page.payerName} payerEmail={page.payerEmail} onStart={() => page.dispatch({ type: 'PAY_STARTED' })} onSuccess={(txHash) => { page.dispatch({ type: 'PAY_SENT', txHash }); void page.reload(); }} onError={(error) => page.dispatch({ type: 'PAY_FAILED', error })} />
                </section>
                <PayMonitorPanel active={page.monitoring} intervalMs={page.paymentInfo?.statusPollingIntervalMs ?? PAYMENT_STATUS_POLL_INTERVAL_MS} />
                <PayVerifyPanel txHash={page.txHash} verifying={page.verifying} onChange={page.setTxHash} onVerify={() => void page.verify()} />
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[12rem] card flex items-center justify-center text-center">{children}</div>;
}

function PayerField({ id, label, value, onChange, type = 'text' }: { id: string; label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}<input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} maxLength={255} className="input text-sm mt-1" /></label>;
}
