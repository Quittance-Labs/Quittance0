'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ApiErrorStateProps {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}

export default function ApiErrorState({ message, onRetry, compact = false }: ApiErrorStateProps) {
  return (
    <div
      role="alert"
      className={`border border-red-200 bg-red-50 text-red-950 rounded-2xl ${compact ? 'p-4' : 'card py-10 text-center'}`}
    >
      <AlertTriangle className={`${compact ? 'w-5 h-5 inline mr-2' : 'w-12 h-12 mx-auto mb-4'} text-red-600`} />
      <p className="font-semibold">The Quittance API is unavailable</p>
      <p className="text-sm text-red-800 mt-1">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-outline mt-4 inline-flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      )}
    </div>
  );
}
