'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { apiErrorMessage, invoiceApi, isApiUnavailableError, PAYMENT_STATUS_POLL_INTERVAL_MS } from './api';
import { checkTxHash } from './verification';
import {
  PAY_STATES,
  describeVerifyError,
  initialPaymentState,
  normalizePayerDetails,
  paymentReducer,
  shouldPoll,
} from './payment-page-state';
import type { PayPageInvoice, PayPagePaymentInfo } from '@/components/pay-page.types';
import { toast } from 'sonner';
import { useWalletStore } from './store';

export function usePaymentPage(id: string) {
  const [payment, dispatch] = useReducer(paymentReducer, undefined, () => initialPaymentState(null));
  const [loading, setLoading] = useState(true);
  const [paymentInfo, setPaymentInfo] = useState<PayPagePaymentInfo | null>(null);
  const { publicKey, connected } = useWalletStore();
  const [txHash, setTxHash] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
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
      }
    }, paymentInfo?.statusPollingIntervalMs ?? PAYMENT_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [id, payment, paymentInfo?.statusPollingIntervalMs]);

  const verify = async () => {
    const checked = checkTxHash(txHash);
    if (!checked.ok) return toast.error(checked.error);
    const payer = normalizePayerDetails({ payerName, payerEmail });
    if (!payer.ok) return toast.error(payer.error);
    dispatch({ type: 'VERIFY_STARTED' });
    const request = generation.current;
    try {
      const result = await invoiceApi.verify(id, checked.value, payer.value);
      if (request !== generation.current) return;
      dispatch({ type: 'VERIFY_SUCCEEDED', invoice: result?.data ?? null });
      toast.success('Transaction verified!');
      void load();
    } catch (error) {
      if (request !== generation.current) return;
      const message = describeVerifyError(error);
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
    dispatch,
    verify,
    reload: load,
  };
}
