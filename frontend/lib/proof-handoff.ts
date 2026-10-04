import { resolveApiConfig } from './api-runtime.js';
import { createBrowserRequestId } from './request-correlation-id.ts';

export type ProofHandoff =
  | { proofFormat: 'pdf'; handoff: 'print-window' }
  | { proofFormat: 'text'; handoff: 'download' };

/**
 * Observe a completed browser handoff without delaying or failing the proof.
 * A print window or dispatched download cannot prove that the user saved a file.
 * No retry, wallet data, proof contents, or client-supplied log references travel.
 */
export async function reportProofHandoff(
  invoiceId: string,
  handoff: ProofHandoff
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (typeof window === 'undefined' || typeof fetch !== 'function' || !invoiceId) return false;
    const config = resolveApiConfig(process.env.NEXT_PUBLIC_API_URL, process.env.NODE_ENV);
    if (!config.configured) return false;

    const requestId = createBrowserRequestId();
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`${config.baseUrl}/invoices/${encodeURIComponent(invoiceId)}/proof-handoff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
        'X-Correlation-Id': requestId,
      },
      body: JSON.stringify({ proofFormat: handoff.proofFormat, handoff: handoff.handoff }),
      credentials: 'omit',
      cache: 'no-store',
      keepalive: true,
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
