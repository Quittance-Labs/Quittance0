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
import type { WalletGateResult } from '@/lib/freighter-availability';

const FREIGHTER_TOAST_ID = 'freighter-not-installed';
const FREIGHTER_NETWORK_TOAST_ID = 'freighter-wrong-network';

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

export const showFreighterWrongNetworkPrompt = (targetNetwork = 'Testnet') => {
  toast.error('Wrong Stellar network', {
    id: FREIGHTER_NETWORK_TOAST_ID,
    description: FREIGHTER_WRONG_NETWORK_MESSAGE(targetNetwork),
    duration: 8000,
  });
};

interface FreighterInstallPromptProps {
  gate?: WalletGateResult;
  /** The control the caller wants beside the message, usually WalletConnect. */
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

/**
 * The prompt three pages render when the wallet cannot act.
 *
 * It renders nothing once the gate is ready: the pages guard it themselves,
 * but a component that disappears when its reason is gone cannot be left on
 * screen by a stale prop. The caller owns the call to action, this component
 * owns the explanation, and both come from the same gate.
 */
export default function FreighterInstallPrompt({
  gate = defaultGate,
  action,
  compact = false,
  className = '',
}: FreighterInstallPromptProps) {
  if (gate.ready) return null;

  return (
    <div
      role="status"
      data-gate-status={gate.status}
      className={[compact ? 'text-xs' : 'text-sm', className].filter(Boolean).join(' ')}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-semibold">{gate.title}</p>
          <p className="mt-0.5 text-gray-600">{gate.message}</p>
          {gate.action === 'install' && (
            <a
              href={FREIGHTER_INSTALL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block font-semibold underline"
            >
              Install Freighter
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      </div>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
