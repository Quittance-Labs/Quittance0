'use client';

import { toast } from 'sonner';
import {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_REQUIRED_MESSAGE,
} from '@/lib/freighter-availability';

const FREIGHTER_TOAST_ID = 'freighter-not-installed';

export const showFreighterInstallPrompt = () => {
  toast.error('Freighter wallet not found', {
    id: FREIGHTER_TOAST_ID,
    description: (
      <span>
        {FREIGHTER_REQUIRED_MESSAGE}{' '}
        <a
          href={FREIGHTER_INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline"
        >
          Install Freighter
        </a>
      </span>
    ),
    duration: 10000,
  });
};
