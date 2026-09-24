'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiErrorMessage, invoiceApi, isApiUnavailableError, PAYMENT_STATUS_POLL_INTERVAL_MS, resolveVerificationError } from './api';
import { checkTxHash } from './verification';
import { parsePayReturnSearch } from './pay-return';
import { loadPaySession, savePaySession } from './pay-session';
import {
  HORIZON_OUTAGE_MESSAGE,
  isHorizonOutageError,
} from './horizon-outage';
import { isEdgeLimitError, edgeLimitMessage } from './edge-limit.js';
import {
  PAY_STATES,
  initialPaymentState,
  normalizePayerDetails,
  paymentReducer,
  shouldDropPendingPayment,
  shouldPoll,
} from './payment-page-state';
import type { PayPageInvoice, PayPagePaymentInfo } from '@/components/pay-page.types';
import { toast } from 'sonner';
import { useWalletStore } from './store';

export function usePaymentPage(id: string) {
  const [payment, dispatch] = useReducer(paymentReducer, undefined, () => initialPaymentState(null));
  const [loading, setLoading] = useState(true);
  const [paymentInfo, setPaymentInfo] = useState<PayPagePaymentInfo | null>(null);
  const { publicKey, connected, network } = useWalletStore();
  const [txHash, setTxHash] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const generation = useRef(0);
  // The return URL only matters at mount: a wallet handoff lands here once.
  const searchParams = useSearchParams();
  const [initialSearch] = useState(() => searchParams?.toString() ?? '');
  const walletSessionRef = useRef({ publicKey, network, connected });

  const load = useCallback(async () => {
    const request = generation.current;
    setLoadError(null);

    try {
      const [invoiceResult, infoResult] = await Promise.allSettled([
        invoiceApi.getById(id),
        invoiceApi.getPaymentInfo(id),
      ]);

      if (request !== generation.current) return;
      if (invoiceResult.status === 'rejected') throw invoiceResult.reason;

      dispatch({ type: 'INVOICE_LOADED', invoice: invoiceResult.value.data });
      if (infoResult.status === 'fulfilled') {
        setPaymentInfo(infoResult.value.data);
      } else {
        setLoadError(apiErrorMessage(infoResult.reason));
      }
    } catch (error) {
      if (request !== generation.current) return;
      const message = apiErrorMessage(error, 'Failed to load invoice');
      if (isApiUnavailableError(error)) setLoadError(message);
      toast.error(message);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    generation.current += 1;
    setLoading(true);
    setPaymentInfo(null);
    setTxHash('');
    setResumeAvailable(false);
    dispatch({ type: 'INVOICE_LOADED', invoice: null });

    // Wallet handoff return (issue #516): a same-origin /pay/[id]?tx=<hash>
    // link resumes verification without a paste. Anything else — a foreign
    // return_url, a malformed tx — is ignored by parsePayReturnSearch.
    const returned = parsePayReturnSearch(
      initialSearch,
      typeof window !== 'undefined' ? window.location.origin : ''
    );
    if (returned.txHash) {
      setTxHash(returned.txHash);
      void load().then(() => verify(returned.txHash ?? undefined));
      return () => {
        generation.current += 1;
      };
    }

    // No hash in the URL: offer the resumable session instead — the stored
    // hash only applies to this invoice and is still pasted by the payer.
    const session = loadPaySession();
    if (session.invoiceId === id && session.txHash && checkTxHash(session.txHash).ok) {
      setTxHash(session.txHash);
      setResumeAvailable(true);
    }
    void load();
    return () => {
      generation.current += 1;
    };
    // verify reads only the override argument plus stable refs at mount, so
    // the mount-time instance is the right one and is intentionally excluded.
  }, [id, load]);

  // A wallet switch or disconnect cancels the previous key's in-flight work
  // (issue #508): bump the generation so a load/verify/poll response in flight
  // is dropped, clear the pending hash, and reset the session UI. Terminal
  // states survive — a settled invoice stays settled for whoever is watching.
  useEffect(() => {
    const previous = walletSessionRef.current;
    const next = { publicKey, network, connected };
    walletSessionRef.current = next;
    if (!shouldDropPendingPayment(previous, next, payment.status)) return;
    generation.current += 1;
    setTxHash('');
    dispatch({ type: 'RESET' });
  }, [publicKey, network, connected, payment.status]);

  useEffect(() => {
    if (!shouldPoll(payment)) return;
    const request = generation.current;
    const interval = setInterval(async () => {
      try {
        const result = await invoiceApi.getById(id);
        if (request !== generation.current || result.data.status === 'PENDING') return;
        dispatch({ type: 'POLL_RESULT', invoice: result.data });
        if (result.data.status === 'PAID') toast.success('Payment confirmed!');
      } catch (error) {
        console.error('Invoice status polling failed:', error);
        if (isApiUnavailableError(error)) setLoadError(apiErrorMessage(error));
        else if (isHorizonOutageError(error)) setLoadError(HORIZON_OUTAGE_MESSAGE);
      }
    }, paymentInfo?.statusPollingIntervalMs ?? PAYMENT_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [id, payment, paymentInfo?.statusPollingIntervalMs]);

  const verify = async (hashOverride?: string) => {
    const checked = checkTxHash(hashOverride ?? txHash);
    if (!checked.ok) return toast.error(checked.error);
    const payer = normalizePayerDetails({ payerName, payerEmail });
    if (!payer.ok) return toast.error(payer.error);
    // Persist the non-secret resume pair before the request: if the wallet
    // handoff kills the tab mid-verify, the hash survives for the resume path.
    savePaySession({ invoiceId: id, txHash: checked.value });
    dispatch({ type: 'VERIFY_STARTED' });
    const request = generation.current;
    const sessionKey = connected ? publicKey : null;
    try {
      const result = await invoiceApi.verify(id, checked.value, payer.value);
      if (request !== generation.current) return;
      // A mid-flight wallet switch must not let the previous key's verify
      // complete under the new session, even if the response arrives before
      // the session-change effect runs. A verify started while disconnected
      // carries no key, so a later connect does not invalidate it.
      const latest = useWalletStore.getState();
      const latestKey = latest.connected ? latest.publicKey : null;
      if (sessionKey !== null && latestKey !== sessionKey) return;
      dispatch({ type: 'VERIFY_SUCCEEDED', invoice: result?.data ?? null });
      toast.success('Transaction verified!');
      void load();
    } catch (error) {
      if (request !== generation.current) return;

      // Same guard as the success path: the error belongs to the session
      // that started the verify, not whichever wallet is connected now.
      const latest = useWalletStore.getState();
      const latestKey = latest.connected ? latest.publicKey : null;
      if (sessionKey !== null && latestKey !== sessionKey) return;

      // Edge limits (429 / 413) are retryable and must never look like a
      // memo/amount/destination rejection on the pay page (issue #450).
      if (isEdgeLimitError(error)) {
        const message = edgeLimitMessage(error);
        setLoadError(message);
        dispatch({ type: 'VERIFY_UNAVAILABLE' });
        toast.error(message);
        return;
      }

      // A Horizon or transport failure is not a rejection: keep the session,
      // say it is retryable, and leave the verify control in place.
      if (isHorizonOutageError(error)) {
        setLoadError(HORIZON_OUTAGE_MESSAGE);
        dispatch({ type: 'VERIFY_UNAVAILABLE' });
        toast.error(HORIZON_OUTAGE_MESSAGE);
        return;
      }

      const message = resolveVerificationError(error);
      if (isApiUnavailableError(error)) setLoadError(apiErrorMessage(error));
      dispatch({ type: 'VERIFY_FAILED', error: message });
      toast.error(message);
    }
  };

  return {
    invoice: payment.invoice as PayPageInvoice | null,
    payment,
    loading,
    loadError,
    paymentInfo,
    wallet: connected ? publicKey : null,
    txHash,
    setTxHash,
    payerName,
    setPayerName,
    payerEmail,
    setPayerEmail,
    verifying: payment.status === PAY_STATES.VERIFYING,
    monitoring: shouldPoll(payment),
    resumeAvailable,
    dispatch,
    verify,
    reload: load,
  };
}
