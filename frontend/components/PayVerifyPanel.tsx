'use client';

import { Loader2 } from 'lucide-react';

interface PayVerifyPanelProps {
  txHash: string;
  verifying: boolean;
  resumeHint?: boolean;
  onChange: (value: string) => void;
  onVerify: () => void;
}

export default function PayVerifyPanel({ txHash, verifying, resumeHint, onChange, onVerify }: PayVerifyPanelProps) {
  return (
    <section aria-labelledby="verify-title" className="card" aria-busy={verifying}>
      <h3 id="verify-title" className="text-lg font-semibold text-center mb-4">Already paid? Verify your transaction</h3>
      <p className="text-sm text-gray-600 text-center mb-2">Enter the 64-character Stellar transaction hash.</p>
      {resumeHint && (
        <p className="text-sm text-teal-800 text-center mb-2" role="status">
          Welcome back — the transaction hash from your last visit is filled in below.
        </p>
      )}
      <div className="flex items-center gap-2 mb-4">
        <label htmlFor="verify-tx-hash" className="sr-only">Stellar transaction hash</label>
        <input
          id="verify-tx-hash"
          aria-label="Transaction hash"
          value={txHash}
          onChange={(event) => onChange(event.target.value)}
          maxLength={64}
          className="input flex-1 font-mono text-sm"
          placeholder="64-character transaction hash"
          disabled={verifying}
        />
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying}
          aria-busy={verifying}
          aria-label={verifying ? 'Verifying payment on Stellar network' : 'Verify transaction on Stellar network'}
          className="btn btn-primary flex items-center gap-2"
        >
          {verifying && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          <span>{verifying ? 'Verifying...' : 'Verify'}</span>
        </button>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {verifying ? 'Verifying your payment on the Stellar network. Please wait...' : ''}
      </div>
      <p className="text-xs text-gray-500 text-center">Manual verification remains available for QR and external-wallet payments.</p>
    </section>
  );
}
