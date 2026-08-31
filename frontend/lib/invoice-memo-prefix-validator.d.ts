export interface ValidateInvoiceMemoPrefixOptions {
  prefix?: string;
  maxLength?: number | null;
}

export interface ValidateInvoiceMemoPrefixResult {
  valid: boolean;
  error?: string;
  normalized?: string;
}

export function validateInvoiceMemoPrefix(
  value: unknown,
  options?: ValidateInvoiceMemoPrefixOptions
): ValidateInvoiceMemoPrefixResult;
