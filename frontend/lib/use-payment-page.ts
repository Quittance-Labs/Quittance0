'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  apiErrorMessage,
  invoiceApi,
  isApiUnavailableError,
  PAYMENT_STATUS_POLL_INTERVAL_MS,
} from './api';
import { checkTxHash } from './verification';
import { parsePayReturnSearch } from './pay-return';
import { loadPaySession, savePaySession } from './pay-session';
import {
  HORIZON_OUTAGE_MESSAGE,
  isHorizonOutageError,
} from './horizon-outage';
import {
  PAY_STATES,
  initialPaymentState,
  paymentReducer,
  shouldDropPendingPayment,
  shouldPoll,
  getPayPageView,
} from './payment-page-state';
import { deriveSessionStatus } from './payment-session';
import { executePaymentVerification } from './pay-verify-controller';
import { copyToClipboard } from './utils';
import type { PayPageInvoice, PayPagePaymentInfo, PayPageSession } from '@/components/pay-page.types';
import { toast } from 'sonner';
import { useWalletStore } from './store';

/**
 * Orchestrator hook: invoice load, polling, resume, wallet-switch isolation,
 * and verify/outage via the shared controller (issue #445).
 */
export function usePaymentPage(id: string): PayPageSession {
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
    // link resumes verification without a paste.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, load]);

  // A wallet switch or disconnect cancels the previous key's in-flight work
  // (issue #508).
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
    const hash = hashOverride ?? txHash;
    const checked = checkTxHash(hash);
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }

    // Persist the non-secret resume pair before the request (issue #516).
    savePaySession({ invoiceId: id, txHash: checked.value });

    const request = generation.current;
    const sessionKey = connected ? publicKey : null;

    const result = await executePaymentVerification({
      invoiceId: id,
      txHash: checked.value,
      payerName,
      payerEmail,
      verifyFn: invoiceApi.verify,
      dispatch: (event) => {
        if (request !== generation.current) return;
        // Mid-flight wallet switch must not complete under the new session.
        const latest = useWalletStore.getState();
        const latestKey = latest.connected ? latest.publicKey : null;
        if (sessionKey !== null && latestKey !== sessionKey) return;
        dispatch(event as Parameters<typeof dispatch>[0]);
      },
    });

    if (request !== generation.current) return;

    const latest = useWalletStore.getState();
    const latestKey = latest.connected ? latest.publicKey : null;
    if (sessionKey !== null && latestKey !== sessionKey) return;

    if (result.ok) {
      toast.success('Transaction verified!');
      void load();
      return;
    }

    if (result.kind === 'validation') {
      toast.error(result.error);
      return;
    }

    if (result.kind === 'outage') {
      setLoadError(result.message);
      toast.error(result.message);
      return;
    }

    if (result.isApiUnavailable) setLoadError(result.message);
    toast.error(result.message);
  };

  const copy = useCallback(async (value: string, label: string) => {
    if (await copyToClipboard(value)) {
      toast.success(`${label} copied`);
      dispatch({ type: 'COPIED', key: label });
    }
  }, []);

  const invoice = payment.invoice as PayPageInvoice | null;
  const view = getPayPageView(invoice);
  const status = deriveSessionStatus({
    loading,
    invoice,
    paymentStatus: payment.status,
    loadError,
  });

  return {
    invoice,
    payment,
    status,
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
    verifying: payment.status === PAY_STATES.VERIFYING || status === 'verifying',
    monitoring: shouldPoll(payment),
    resumeAvailable,
    view,
    dispatch: dispatch as PayPageSession['dispatch'],
    verify,
    reload: load,
    copy,
  };
}
