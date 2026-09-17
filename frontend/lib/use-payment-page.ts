'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  apiErrorMessage,
  invoiceApi,
  isApiUnavailableError,
  PAYMENT_STATUS_POLL_INTERVAL_MS,
} from './api';
import {
  HORIZON_OUTAGE_MESSAGE,
  isHorizonOutageError,
} from './horizon-outage';
import {
  PAY_STATES,
  initialPaymentState,
  paymentReducer,
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
 * Orchestrator hook managing invoice fetching, payment state, verification lifecycle, and polling.
 */
export function usePaymentPage(id: string): PayPageSession {
  const [payment, dispatch] = useReducer(
    paymentReducer,
    undefined,
    () => initialPaymentState(null)
  );
  const [loading, setLoading] = useState(true);
  const [paymentInfo, setPaymentInfo] = useState<PayPagePaymentInfo | null>(null);
  const { publicKey, connected } = useWalletStore();
  const [txHash, setTxHash] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const generation = useRef(0);

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
      } catch (error) {
        console.error('Invoice status polling failed:', error);
        if (isApiUnavailableError(error)) setLoadError(apiErrorMessage(error));
        else if (isHorizonOutageError(error)) setLoadError(HORIZON_OUTAGE_MESSAGE);
      }
    }, paymentInfo?.statusPollingIntervalMs ?? PAYMENT_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [id, payment, paymentInfo?.statusPollingIntervalMs]);

  const verify = async () => {
    const request = generation.current;
    const result = await executePaymentVerification({
      invoiceId: id,
      txHash,
      payerName,
      payerEmail,
      verifyFn: invoiceApi.verify,
      dispatch: (event) => {
        if (request === generation.current) {
          dispatch(event);
        }
      },
    });

    if (request !== generation.current) return;

    if (result.ok) {
      toast.success('Transaction verified!');
      void load();
    } else if (result.kind === 'outage') {
      setLoadError(result.message);
      toast.error(result.message);
    } else if (result.kind === 'validation') {
      toast.error(result.error);
    } else {
      if (result.isApiUnavailable) setLoadError(result.message);
      toast.error(result.message);
    }
  };

  const copy = useCallback(async (value: string, label: string) => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopiedKey(label);
      toast.success(`${label} copied`);
      dispatch({ type: 'COPIED', key: label });
      setTimeout(() => {
        setCopiedKey((curr) => (curr === label ? null : curr));
      }, 2000);
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
    view,
    dispatch,
    verify,
    reload: load,
    copy,
    copiedKey,
  };
}
