import { describe, it, expect } from 'vitest';
import { interactiveStatus, type InvoiceStatus } from './utils';

/**
 * Single source of truth for `#19` ("Hide QR and Pay controls on EXPIRED
 * invoices only") — see `.session-notes/issue-19-design.md` §3.
 *
 * Contract: render interactive payment controls (QR, Pay button, Copy link)
 * iff status === 'PENDING'. Any other status hides them.
 */
describe('interactiveStatus (#19 contract)', () => {
  it.each<[InvoiceStatus, boolean]>([
    ['PENDING', true],
    ['EXPIRED', false],
    ['PAID', false],
    ['CANCELLED', false],
  ])('%s → show controls = %s', (status, expected) => {
    expect(interactiveStatus(status)).toBe(expected);
  });

  it('defaults to hiding controls for unknown statuses (safe fallback)', () => {
    expect(interactiveStatus('REJECTED')).toBe(false);
    expect(interactiveStatus('')).toBe(false);
    expect(interactiveStatus('pending')).toBe(false); // case-sensitive: only 'PENDING'
  });
});
