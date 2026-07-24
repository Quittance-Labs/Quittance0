import { describe, it, expect } from 'vitest';
import {
  interactiveStatus,
  paymentCompleted,
  STATUS_META,
  type InvoiceStatus,
} from './utils';

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
});

/**
 * #19 followup #3 — typed-status contract end-to-end.
 *
 * Contract: `paymentCompleted(status)` is true iff `status === 'PAID'`.
 * Mirrors the backend `markAsPaid` invariant — see PR #1 commit `2007bc4`.
 */
describe('paymentCompleted (#19 followup #3)', () => {
  it.each<[InvoiceStatus, boolean]>([
    ['PAID', true],
    ['PENDING', false],
    ['EXPIRED', false],
    ['CANCELLED', false],
  ])('%s → paid = %s', (status, expected) => {
    expect(paymentCompleted(status)).toBe(expected);
  });
});

/**
 * #19 followup — `STATUS_META.chipClassName` is the typed chip-variant
 * lookup that replaced the prior `getStatusColor` function. Consolidates
 * the chip color pair (bg + text) into the same `Record<InvoiceStatus, …>`
 * that powers `<StatusBadge variant="chip" />` in `InvoiceCard.tsx`.
 *
 * Adding a new `InvoiceStatus` union member surfaces at tsc — the
 * matrix below (and the `STATUS_META` initializer in `@/lib/utils`)
 * both fail to compile until the new status is fully defined.
 */
describe('STATUS_META.chipClassName (#19 followup — typed chip variant)', () => {
  it.each<[InvoiceStatus, string]>([
    ['PAID', 'text-green-600 bg-green-50'],
    ['PENDING', 'text-yellow-600 bg-yellow-50'],
    ['EXPIRED', 'text-red-600 bg-red-50'],
    ['CANCELLED', 'text-gray-600 bg-gray-50'],
  ])('%s → chipClassName = %s', (status, expected) => {
    expect(STATUS_META[status].chipClassName).toBe(expected);
  });
});

/**
 * Sanity invariant (#19 followup #3): neither predicate returns true
 * simultaneously. Catches drift if `interactiveStatus` is widened to
 * cover PAID (or vice versa). NOT a XOR — terminal statuses (EXPIRED,
 * CANCELLED) return false from BOTH.
 */
describe('interactiveStatus AND paymentCompleted are mutually exclusive (#19 followup #3)', () => {
  it.each<[InvoiceStatus]>([
    ['PENDING'], ['PAID'], ['EXPIRED'], ['CANCELLED'],
  ])('%s', (status) => {
    expect(interactiveStatus(status) && paymentCompleted(status)).toBe(false);
  });
});
