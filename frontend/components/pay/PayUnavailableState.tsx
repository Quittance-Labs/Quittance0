'use client';

import ApiErrorState from '@/components/ApiErrorState';
import { MAIN_CONTENT_ID } from '@/lib/a11y';

interface PayUnavailableStateProps {
  error?: string | null;
  onRetry?: () => void;
}

/**
 * Unavailable or missing invoice presentation for the pay page.
 */
export default function PayUnavailableState({ error, onRetry }: PayUnavailableStateProps) {
  if (error && onRetry) {
    return (
      <div className="min-h-screen bg-logo-pattern flex items-center justify-center px-4">
        <div className="max-w-lg w-full">
          <ApiErrorState message={error} onRetry={onRetry} />
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
          {error ?? 'The invoice you are looking for does not exist.'}
        </p>
      </div>
    </main>
  );
}
