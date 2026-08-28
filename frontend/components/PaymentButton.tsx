'use client';

import { useState } from 'react';
import { sendPayment, checkWalletConnection, requestWalletAccess } from '@/lib/stellar';
import { toast } from 'sonner';
import { Wallet, Loader2 } from 'lucide-react';
import { invoiceApi } from '@/lib/api';
import { showFreighterInstallPrompt } from '@/components/FreighterInstallPrompt';
import { checkPayerInfo, resolveVerificationError } from '@/lib/verification';

interface PaymentButtonProps {
  destination: string;
  amount: string;
  memo: string;
  assetCode?: string;
  assetIssuer?: string;
  invoiceId?: string;
  payerName?: string;
  payerEmail?: string;
  onSuccess?: (txHash: string) => void;
}

const PAY_TOAST_ID = 'payment-flow';

export default function PaymentButton({
  destination,
  amount,
  memo,
  assetCode = 'XLM',
  assetIssuer,
  invoiceId,
  payerName,
  payerEmail,
  onSuccess,
}: PaymentButtonProps) {
  const [loading, setLoading] = useState(false);

  const handlePayment = async () => {
    // Same payer rules as the server, so the wallet is never opened for input
    // the verify endpoint would reject afterwards.
    const payerCheck = checkPayerInfo({ payerName, payerEmail });
    if (!payerCheck.ok) {
      toast.error(payerCheck.error);
      return;
    }

    setLoading(true);
    try {
      const freighterInstalled = await checkWalletConnection();
      if (!freighterInstalled) {
        showFreighterInstallPrompt();
        return;
      }

      const allowed = await requestWalletAccess();
      if (!allowed) {
        toast.error('Freighter access was denied');
        return;
      }

      toast.loading('Confirm in wallet...', { id: PAY_TOAST_ID });
      const txHash = await sendPayment(destination, amount, memo, assetCode, assetIssuer);

      if (invoiceId) {
        toast.loading('Verifying payment...', { id: PAY_TOAST_ID });
        try {
          await invoiceApi.verify(invoiceId, txHash, payerCheck.value);
          toast.success('Payment verified', {
            id: PAY_TOAST_ID,
            description: `TX: ${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
          });
        } catch (error) {
          console.error('Verification failed:', error);
          // Surface the shared rejection message rather than a generic warning.
          toast.warning('Payment sent but verification failed', {
            id: PAY_TOAST_ID,
            description: resolveVerificationError(
              error,
              'Refresh the page or wait for status to update'
            ),
          });
        }
      } else {
        toast.success('Payment successful', {
          id: PAY_TOAST_ID,
          description: `TX: ${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
        });
      }

      onSuccess?.(txHash);
    } catch (error: any) {
      const missingTrustline =
        assetCode !== 'XLM' && error.message?.toLowerCase().includes('trustline');
      toast.error(missingTrustline ? `${assetCode} trustline required` : 'Payment failed', {
        id: PAY_TOAST_ID,
        description: error.message || 'Try again',
        duration: missingTrustline ? 10000 : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handlePayment}
      disabled={loading}
      className="btn btn-primary w-full flex items-center justify-center gap-2 text-lg py-4"
    >
      {loading ? (
        <>
          <Loader2 className="w-6 h-6 animate-spin" />
          Processing...
        </>
      ) : (
        <>
          <Wallet className="w-6 h-6" />
          Pay with Freighter
        </>
      )}
    </button>
  );
}
