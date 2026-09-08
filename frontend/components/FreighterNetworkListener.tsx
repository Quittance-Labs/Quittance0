'use client';

import { useEffect, useRef } from 'react';
import { useWalletStore } from '@/lib/store';
import {
  NETWORK_DISPLAY_NAME,
  watchFreighterNetwork,
} from '@/lib/stellar';
import { showFreighterWrongNetworkPrompt } from './FreighterInstallPrompt';

export default function FreighterNetworkListener() {
  const { connected, publicKey, setNetwork, setIsWrongNetwork } = useWalletStore();
  const prevWrongRef = useRef(false);

  useEffect(() => {
    if (!connected && !publicKey) return;

    const unsubscribe = watchFreighterNetwork((details) => {
      if (!details) return;

      setNetwork(details.network, details.networkPassphrase);
      setIsWrongNetwork(details.isWrongNetwork);

      if (details.isWrongNetwork && !prevWrongRef.current) {
        showFreighterWrongNetworkPrompt(NETWORK_DISPLAY_NAME);
      }
      prevWrongRef.current = details.isWrongNetwork;
    });

    return () => {
      unsubscribe();
    };
  }, [connected, publicKey, setNetwork, setIsWrongNetwork]);

  return null;
}
