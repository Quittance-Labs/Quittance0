'use client';

import { Loader2 } from 'lucide-react';

interface PayVerifyPanelProps {
  txHash: string;
  verifying: boolean;
  onChange: (value: string) => void;
  onVerify: () => void;
}

export default function PayVerifyPanel({ txHash, verifying, onChange, onVerify }: PayVerifyPanelProps) {
  return (
    <section aria-labelledby="verify-title" className="card">
      <h3 id="verify-title" className="text-lg font-semibold text-center mb-4">Already paid? Verify your transaction</h3>
      <p className="text-sm text-gray-600 text-center mb-2">Enter the 64-character Stellar transaction hash.</p>
      <div className="flex items-center gap-2 mb-4">
        <input aria-label="Transaction hash" value={txHash} onChange={(event) => onChange(event.target.value)} maxLength={64} className="input flex-1" />
        <button type="button" onClick={onVerify} disabled={verifying} className="btn btn-primary flex items-center gap-2">
          {verifying && <Loader2 className="w-4 h-4 animate-spin" />}
          {verifying ? 'Verifying...' : 'Verify'}
        </button>
      </div>
      <p className="text-xs text-gray-500 text-center">Manual verification remains available for QR and external-wallet payments.</p>
    </section>
  );
}
