'use client';

import { toast } from 'sonner';
import {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_REQUIRED_MESSAGE,
  FREIGHTER_WRONG_NETWORK_MESSAGE,
} from '@/lib/freighter-availability';

const FREIGHTER_TOAST_ID = 'freighter-not-installed';
const FREIGHTER_NETWORK_TOAST_ID = 'freighter-wrong-network';

export const showFreighterInstallPrompt = () => {
  toast.error('Freighter wallet not found', {
    id: FREIGHTER_TOAST_ID,
    description: (
      <span>
        {FREIGHTER_REQUIRED_MESSAGE}{' '}
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
