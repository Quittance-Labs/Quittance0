'use client';

import { Loader2 } from 'lucide-react';
import { MAIN_CONTENT_ID } from '@/lib/a11y';

/** Loading state presentation for the pay page. */
export default function PayLoadingState() {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="min-h-screen bg-logo-pattern relative flex items-center justify-center"
    >
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>
      <div className="relative" role="status" aria-live="polite">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full blur-2xl opacity-30"></div>
        <Loader2 className="w-16 h-16 animate-spin text-teal-800 relative z-10" aria-hidden="true" />
        <span className="sr-only">Loading this invoice.</span>
      </div>
    </main>
  );
}
