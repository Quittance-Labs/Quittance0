'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ServerOff, X } from 'lucide-react';
import { API_CONFIG, apiErrorMessage, healthCheck } from '@/lib/api';

export default function ApiStatusBanner() {
  const [error, setError] = useState<string | null>(API_CONFIG.error);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      await healthCheck();
      setError(null);
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    const offline = () => setError('Your browser is offline. Reconnect, then retry.');
    const online = () => void check();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [check]);

  if (!error) return null;

  return (
    <aside
      role="alert"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:max-w-lg z-[100] bg-red-950 text-white rounded-2xl shadow-2xl p-4"
    >
      <div className="flex items-start gap-3">
        <ServerOff className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">Backend connection problem</p>
          <p className="text-sm text-red-100 mt-1">{error}</p>
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking}
            className="mt-3 text-sm underline underline-offset-4 inline-flex items-center gap-2 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking…' : 'Retry connection'}
          </button>
        </div>
        <button type="button" onClick={() => setError(null)} aria-label="Dismiss backend warning">
          <X className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
