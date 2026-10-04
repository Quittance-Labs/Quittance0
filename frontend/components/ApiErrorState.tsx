'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ApiErrorStateProps {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}

export default function ApiErrorState({ message, onRetry, compact = false }: ApiErrorStateProps) {
  // Horizon / VERIFY_UNAVAILABLE already carries the full payer-facing sentence.
  // Do not invent a second title alongside it (issue #556).
  const isHorizonOutage =
    /verification is temporarily unavailable|stellar|horizon|outage/i.test(message);
  const title = isHorizonOutage
    ? null
    : /quittance api|unreachable|connection/i.test(message)
      ? 'The Quittance API is unavailable'
      : null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={`border border-red-200 bg-red-50 text-red-950 rounded-2xl ${compact ? 'p-4' : 'card py-10 text-center'}`}
    >
      <AlertTriangle className={`${compact ? 'w-5 h-5 inline mr-2' : 'w-12 h-12 mx-auto mb-4'} text-red-600`} aria-hidden="true" />
      {title ? <p className="font-semibold">{title}</p> : null}
      <p className={`${title ? 'text-sm text-red-800 mt-1' : 'font-semibold'}`}>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label="Retry request"
          className="btn btn-outline mt-4 inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}
