'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { apiErrorMessage, invoiceApi, isApiUnavailableError, PAYMENT_STATUS_POLL_INTERVAL_MS, resolveVerificationError } from './api';
import { checkTxHash } from './verification';
import {
  HORIZON_OUTAGE_MESSAGE,
  isHorizonOutageError,
} from './horizon-outage';
import {
  PAY_STATES,
  initialPaymentState,
  normalizePayerDetails,
  paymentReducer,
  shouldPoll,
} from './payment-page-state';
import { normalizeWalletSession, shouldResetPaySession } from './wallet-session';
import type { PayPageInvoice, PayPagePaymentInfo } from '@/components/pay-page.types';
import { toast } from 'sonner';
import { useWalletStore } from './store';

/**
 * State and lifecycle hook for the payment surface.
 *
 * @param id The unique identifier of the invoice being paid.
 * @returns State, dispatchers, and action handlers for the payment page.
 */
export function usePaymentPage(id: string) {
  const [payment, dispatch] = useReducer(paymentReducer, undefined, () => initialPaymentState(null));
  const [loading, setLoading] = useState(true);
  const [paymentInfo, setPaymentInfo] = useState<PayPagePaymentInfo | null>(null);
  const { publicKey, connected, network, freighterAvailable } = useWalletStore();
  const session = normalizeWalletSession({ publicKey, connected, network, freighterAvailable });
  const activePublicKey = session.publicKey;

  const [txHash, setTxHash] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const generation = useRef(0);
  const previousSession = useRef<ReturnType<typeof normalizeWalletSession> | null>(null);
  const boundPublicKey = useRef<string | null>(activePublicKey);
  const verifyAbortController = useRef<AbortController | null>(null);
  const fetchAbortController = useRef<AbortController | null>(null);

  useEffect(() => {
    const previous = previousSession.current;
    if (previous !== null && shouldResetPaySession(previous, session)) {
      verifyAbortController.current?.abort();
      verifyAbortController.current = null;

      fetchAbortController.current?.abort();
      generation.current += 1;

      setTxHash('');
      dispatch({ type: 'WALLET_SWITCHED' });
    }
    previousSession.current = session;
    boundPublicKey.current = activePublicKey;
  }, [activePublicKey, session]);

  useEffect(() => {
    return () => {
      verifyAbortController.current?.abort();
      fetchAbortController.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    fetchAbortController.current?.abort();
    const controller = new AbortController();
    fetchAbortController.current = controller;
    const request = generation.current;
    setLoadError(null);

    try {
      const [invoiceResult, infoResult] = await Promise.allSettled([
        invoiceApi.getById(id, { signal: controller.signal }),
        invoiceApi.getPaymentInfo(id, { signal: controller.signal }),
      ]);

      if (request !== generation.current || controller.signal.aborted) return;
      if (invoiceResult.status === 'rejected') throw invoiceResult.reason;

      dispatch({ type: 'INVOICE_LOADED', invoice: invoiceResult.value.data });
      if (infoResult.status === 'fulfilled') {
        setPaymentInfo(infoResult.value.data);
      } else {
        setLoadError(apiErrorMessage(infoResult.reason));
      }
    } catch (error: any) {
      if (
        request !== generation.current ||
        controller.signal.aborted ||
        error?.name === 'CanceledError' ||
        error?.name === 'AbortError'
      ) {
        return;
      }
      const message = apiErrorMessage(error, 'Failed to load invoice');
      if (isApiUnavailableError(error)) setLoadError(message);
      toast.error(message);
    } finally {
      if (request === generation.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    generation.current += 1;
    setLoading(true);
    setPaymentInfo(null);
    setTxHash('');
    dispatch({ type: 'INVOICE_LOADED', invoice: null });
    void load();
    return () => {
      generation.current += 1;
    };
  }, [id, load]);

  useEffect(() => {
    if (!shouldPoll(payment)) return;
    const request = generation.current;
    const interval = setInterval(async () => {
      try {
        const result = await invoiceApi.getById(id);
        if (request !== generation.current || result.data.status === 'PENDING') return;
        dispatch({ type: 'POLL_RESULT', invoice: result.data });
        if (result.data.status === 'PAID') toast.success('Payment confirmed!');
      } catch (error: any) {
        if (request !== generation.current || error?.name === 'CanceledError' || error?.name === 'AbortError') return;
        console.error('Invoice status polling failed:', error);
        if (isApiUnavailableError(error)) setLoadError(apiErrorMessage(error));
        else if (isHorizonOutageError(error)) setLoadError(HORIZON_OUTAGE_MESSAGE);
      }
    }, paymentInfo?.statusPollingIntervalMs ?? PAYMENT_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [id, payment, paymentInfo?.statusPollingIntervalMs]);

  const verify = async () => {
    const checked = checkTxHash(txHash);
    if (!checked.ok) return toast.error(checked.error);
    const payer = normalizePayerDetails({ payerName, payerEmail });
    if (!payer.ok) return toast.error(payer.error);

    verifyAbortController.current?.abort();
    const controller = new AbortController();
    verifyAbortController.current = controller;
    const startingKey = activePublicKey;
    const request = generation.current;

    dispatch({ type: 'VERIFY_STARTED' });
    try {
      const result = await invoiceApi.verify(id, checked.value, payer.value, {
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        request !== generation.current ||
        boundPublicKey.current !== startingKey
      ) {
        return;
      }
      dispatch({ type: 'VERIFY_SUCCEEDED', invoice: result?.data ?? null });
      toast.success('Transaction verified!');
      void load();
    } catch (error: any) {
      if (
        controller.signal.aborted ||
        request !== generation.current ||
        boundPublicKey.current !== startingKey ||
        error?.name === 'CanceledError' ||
        error?.name === 'AbortError'
      ) {
        return;
      }

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
    } finally {
      if (verifyAbortController.current === controller) {
        verifyAbortController.current = null;
      }
    }
  };

  return {
    invoice: payment.invoice as PayPageInvoice | null,
    payment,
    loading,
    loadError,
    paymentInfo,
    wallet: session.connected ? activePublicKey : null,
    txHash,
    setTxHash,
    payerName,
    setPayerName,
    payerEmail,
    setPayerEmail,
    verifying: payment.status === PAY_STATES.VERIFYING,
    monitoring: shouldPoll(payment),
    dispatch,
    verify,
    reload: load,
  };
}
