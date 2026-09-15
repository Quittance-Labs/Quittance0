'use client';

import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_REQUIRED_MESSAGE,
  FREIGHTER_WRONG_NETWORK_MESSAGE,
} from '@/lib/freighter-availability';
import { freighterInstallMessage } from '@/lib/freighter-prompt-copy';

const FREIGHTER_TOAST_ID = 'freighter-not-installed';
const FREIGHTER_NETWORK_TOAST_ID = 'freighter-wrong-network';

export interface WalletGateResult {
  status: 'missing' | 'disconnected' | 'wrong_network' | 'ready';
  ready: boolean;
  title: string;
  message: string;
  action: 'install' | 'connect' | 'switch_network' | 'continue' | 'none';
}

const defaultGate: WalletGateResult = {
  status: 'missing',
  ready: false,
  title: 'Install Freighter',
  message: FREIGHTER_REQUIRED_MESSAGE,
  action: 'install',
};

export default function FreighterInstallPrompt({
  gate = defaultGate,
  action,
  compact = false,
  className = '',
}: {
  gate?: WalletGateResult;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`p-6 bg-amber-50 border border-amber-200 rounded-2xl text-center ${className}`}
    >
      <AlertTriangle className="w-10 h-10 text-amber-600 mx-auto mb-3" aria-hidden="true" />
      <h2 className="font-semibold text-lg text-amber-900 mb-2">{gate.title}</h2>
      <p className="text-sm text-amber-800 max-w-md mx-auto mb-4">{gate.message}</p>
      {action ? (
        <div className="flex justify-center">{action}</div>
      ) : gate.action === 'install' ? (
        <a
          href={FREIGHTER_INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary inline-flex items-center gap-2"
        >
          Install Freighter
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

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

export const showFreighterWrongNetworkPrompt = (targetNetwork = 'Testnet') => {
  toast.error('Wrong Stellar network', {
    id: FREIGHTER_NETWORK_TOAST_ID,
    description: FREIGHTER_WRONG_NETWORK_MESSAGE(targetNetwork),
    duration: 8000,
  });
};
