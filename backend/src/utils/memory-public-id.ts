// In-memory / MVP invoice public ID helper.
//
// Invoices in the MVP and memory storage layers require unique public identifiers
// conforming to standard UUID v4 format. This module provides a centralized generator,
// validator, and normalizer for invoice public IDs.

import { v4 as uuidv4, validate as uuidValidate } from 'uuid';

/**
 * Standard string length for canonical hyphenated UUID representations.
 */
export const PUBLIC_INVOICE_ID_LENGTH = 36;

/**
 * Regular expression matching canonical UUID v4 format.
 */
export const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generate a new public invoice ID using UUID v4.
 *
 * @returns A unique canonical UUID v4 string.
 */
export function generatePublicInvoiceId(): string {
  return uuidv4();
}

/**
 * Validate whether a given value is a valid public invoice UUID string.
 *
 * @param id The value to validate.
 * @returns True if id is a valid UUID string, false otherwise.
 */
export function isValidPublicInvoiceId(id: unknown): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  const trimmed = id.trim();
  if (trimmed.length !== PUBLIC_INVOICE_ID_LENGTH) {
    return false;
  }
  return uuidValidate(trimmed);
}

/**
 * Normalize a public invoice identifier by trimming whitespace and lowercasing.
 * Returns null if the provided value is not a valid UUID string.
 *
 * @param id The candidate identifier.
 * @returns Normalized lowercase UUID string, or null if invalid.
 */
export function normalizePublicInvoiceId(id: unknown): string | null {
  if (typeof id !== 'string') {
    return null;
  }
  const trimmed = id.trim().toLowerCase();
  if (!isValidPublicInvoiceId(trimmed)) {
    return null;
  }
  return trimmed;
}

export default {
  generatePublicInvoiceId,
  isValidPublicInvoiceId,
  normalizePublicInvoiceId,
  PUBLIC_INVOICE_ID_LENGTH,
  UUID_V4_REGEX,
};
