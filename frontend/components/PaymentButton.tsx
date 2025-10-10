'use client';

import { useState } from 'react';
import { sendPayment, checkWalletConnection, requestWalletAccess } from '@/lib/stellar';
import { toast } from 'sonner';
import { Wallet, Loader2 } from 'lucide-react';

interface PaymentButtonProps {
  destination: string;
  amount: string;
  memo: string;
  assetCode?: string;
  assetIssuer?: string;
  onSuccess?: (txHash: string) => void;
}

export default function PaymentButton({
  destination,
  amount,
  memo,
  assetCode = 'XLM',
  assetIssuer,
  onSuccess,
}: PaymentButtonProps) {
  const [loading, setLoading] = useState(false);
  const [walletConnected, setWalletConnected] = useState(false);

  const handlePayment = async () => {
    setLoading(true);

    try {
      // Check wallet connection
      const connected = await checkWalletConnection();
      
      if (!connected) {
        toast.info('Please connect your Freighter wallet');
        const allowed = await requestWalletAccess();
        
        if (!allowed) {
          toast.error('Wallet access denied');
          setLoading(false);
          return;
        }
        
        setWalletConnected(true);
      }

      // Send payment
      toast.loading('Please confirm the transaction in your wallet...');
      
      const txHash = await sendPayment(
        destination,
        amount,
        memo,
        assetCode,
        assetIssuer
      );

      toast.success('Payment successful!', {
        description: `Transaction: ${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
      });

      if (onSuccess) {
        onSuccess(txHash);
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      toast.error('Payment failed', {
        description: error.message || 'Please try again',
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

