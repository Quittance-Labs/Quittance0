'use client';

import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_REQUIRED_MESSAGE,
  type WalletGateResult,
} from '@/lib/freighter-availability';

const FREIGHTER_TOAST_ID = 'freighter-not-installed';

const defaultGate: WalletGateResult = {
  status: 'missing',
  ready: false,
  title: 'Install Freighter',
  message: FREIGHTER_REQUIRED_MESSAGE,
  action: 'install',
};

export const showFreighterInstallPrompt = (gate: WalletGateResult = defaultGate) => {
  toast.error(gate.title, {
    id: FREIGHTER_TOAST_ID,
    description: gate.action === 'install' ? (
      <span>
        {gate.message}{' '}
        {/*
          The link is the only way out of this toast, and it opens a new tab.
          Saying so in the accessible name means a screen-reader user is not
          surprised by the context switch (issue #289).
        */}
        <a
          href={FREIGHTER_INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline"
        >
          Install Freighter
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </span>
    ) : (
      gate.message
    ),
    // Ten seconds is short for a message carrying the only actionable link in
    // the flow, so the toast stays until it is dismissed.
    duration: Infinity,
  });
};

interface FreighterInstallPromptProps {
  gate?: WalletGateResult;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export default function FreighterInstallPrompt({
  gate = defaultGate,
  action,
  compact = false,
  className = '',
}: FreighterInstallPromptProps) {
  if (gate.ready) return null;

  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-950 ${
        compact ? 'p-4' : 'p-6 text-center'
      } ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className={`flex ${compact ? 'items-start text-left' : 'flex-col items-center'} gap-3`}>
        <AlertTriangle className="w-6 h-6 text-amber-700 shrink-0" aria-hidden="true" />
        <div className={compact ? 'space-y-2' : 'space-y-3'}>
          <p className={compact ? 'font-semibold' : 'font-display text-2xl'}>{gate.title}</p>
          <p className="text-sm text-amber-900">{gate.message}</p>
          {gate.action === 'install' ? (
            <a
              href={FREIGHTER_INSTALL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary inline-flex items-center justify-center gap-2"
            >
              Install Freighter
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : action ? (
            <div className={compact ? '' : 'flex justify-center'}>{action}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
