'use client';

import { useState } from 'react';
import { sendPayment, checkWalletConnection, requestWalletAccess } from '@/lib/stellar';
import { toast } from 'sonner';
import { Wallet, Loader2 } from 'lucide-react';
import { invoiceApi } from '@/lib/api';

interface PaymentButtonProps {
  destination: string;
  amount: string;
  memo: string;
  assetCode?: string;
  assetIssuer?: string;
  invoiceId?: string;
  onSuccess?: (txHash: string) => void;
}

export default function PaymentButton({
  destination,
  amount,
  memo,
  assetCode = 'XLM',
  assetIssuer,
  invoiceId,
  onSuccess,
}: PaymentButtonProps) {
  const [loading, setLoading] = useState(false);
  const [walletConnected, setWalletConnected] = useState(false);

  const handlePayment = async () => {
    setLoading(true);
    try {
      const connected = await checkWalletConnection();
      if (!connected) {
        const allowed = await requestWalletAccess();
        if (!allowed) {
          toast.error('Access denied');
          setLoading(false);
          return;
        }
        setWalletConnected(true);
      }

      toast.loading('Confirm in wallet...');
      const txHash = await sendPayment(destination, amount, memo, assetCode, assetIssuer);

      // Verify payment with backend if invoice ID provided
      if (invoiceId) {
        toast.loading('Verifying payment...');
        try {
          await invoiceApi.verify(invoiceId, txHash);
          toast.success('Payment verified!', {
            description: `TX: ${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
          });
        } catch (error) {
          console.error('Verification failed:', error);
          toast.warning('Payment sent but verification failed', {
            description: 'Please wait for automatic confirmation',
          });
        }
      } else {
        toast.success('Payment successful', {
          description: `TX: ${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
        });
      }

      onSuccess?.(txHash);
    } catch (error: any) {
      toast.error('Payment failed', {
        description: error.message || 'Try again',
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

