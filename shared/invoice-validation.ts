/**
 * The create-invoice rules, shared by the API and the form.
 *
 * Before this module the rules lived twice and disagreed in the ways that
 * matter least visibly: the API validated with Zod and answered a 400 whose
 * message was a serialised issue list, while the form re-checked two of the
 * same fields inline and showed the others as toasts. So a payload could pass
 * the form and still be refused by the server, and the payer's screen named no
 * field when that happened.
 *
 * What lives here is the rule set and the sentences that go with it - not the
 * storage shape, and not the HTTP envelope. The API keeps Zod as its runtime
 * validator and builds its messages from these constants; the client imports
 * the same predicates so pre-flight and server refusal cannot drift.
 *
 * Bounds that also exist on the backend (expiry days, the native asset code,
 * the supported networks) are declared here and re-exported by the modules
 * that used to own them, so there is one definition rather than two that must
 * be kept equal by hand.
 */

/** Stellar's native asset has no issuer; every other code must carry one. */
export const NATIVE_ASSET_CODE = 'XLM';

export const MIN_INVOICE_EXPIRY_DAYS = 1;
export const MAX_INVOICE_EXPIRY_DAYS = 30;
export const DEFAULT_INVOICE_EXPIRY_DAYS = 7;

export const SUPPORTED_STELLAR_NETWORKS = ['TESTNET', 'PUBLIC'] as const;

export const MAX_INVOICE_AMOUNT = 1_000_000_000;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_NAME_LENGTH = 255;

export const STELLAR_PUBLIC_KEY_LENGTH = 56;
/** Base32 alphabet, 56 characters, always starting with G. */
export const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One sentence per rule, used by the API's validator and by the form, so the
 * same invalid payload produces the same words on both sides.
 */
export const CREATE_INVOICE_MESSAGES = {
  payload: 'Invoice payload must be an object',
  sellerPublicKeyRequired:
    'A valid Stellar public key is required to say which wallet owns this invoice',
  publicKeyFormat: 'Invalid Stellar public key format',
  amountRequired: 'Enter an amount',
  amountNotNumber: 'Amount must be a number',
  amountNotFinite: 'Amount must be a finite number',
  amountPositive: 'Amount must be greater than zero',
  amountTooLarge: 'Amount is too large for a single invoice',
  amountPrecision: 'Amount must have at most 7 decimal places',
  assetIssuerRequired:
    'assetIssuer is required for issued assets; only XLM may omit it. An asset is identified by its code and issuer together.',
  assetIssuerNotAllowed:
    'XLM is the native asset and must not carry an issuer.',
  description: 'Description must be ' + MAX_DESCRIPTION_LENGTH + ' characters or fewer',
  customerName: 'Client name must be ' + MAX_NAME_LENGTH + ' characters or fewer',
  sellerName: 'Your name must be ' + MAX_NAME_LENGTH + ' characters or fewer',
  customerEmail: 'Client email is invalid',
  sellerEmail: 'Your email is invalid',
  expiresInDays:
    'Payment window must be a whole number of days between ' +
    MIN_INVOICE_EXPIRY_DAYS +
    ' and ' +
    MAX_INVOICE_EXPIRY_DAYS,
  network: 'Unsupported Stellar network',
} as const;

export type CreateInvoiceField =
  | 'sellerPublicKey'
  | 'amount'
  | 'assetIssuer'
  | 'description'
  | 'customerName'
  | 'sellerName'
  | 'customerEmail'
  | 'sellerEmail'
  | 'network'
  | 'expiresInDays'
  | 'form';

/** True for a well-formed Stellar account id. */
export function isStellarPublicKey(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length === STELLAR_PUBLIC_KEY_LENGTH &&
    STELLAR_PUBLIC_KEY_PATTERN.test(value)
  );
}

/** True when the code names a credit asset, which must carry an issuer. */
export function requiresAssetIssuer(assetCode?: string | null): boolean {
  const code = (assetCode ?? '').trim();
  return code.length > 0 && code !== NATIVE_ASSET_CODE;
}

export function isNativeAsset(assetCode?: string | null): boolean {
  return (assetCode ?? '').trim() === NATIVE_ASSET_CODE;
}

export function isValidEmail(value: unknown): boolean {
  return typeof value === 'string' && EMAIL_PATTERN.test(value);
}

/**
 * Check the received number's decimal representation without rounding it.
 * Scaling by 1e7 can introduce floating-point error or exceed safe integer
 * precision for amounts that are otherwise within the invoice ceiling.
 */
export function hasStellarAmountPrecision(amount: number): boolean {
  if (!Number.isFinite(amount)) return false;
  const [mantissa, exponent = '0'] = String(amount).split('e');
  const fractionalDigits = mantissa.split('.')[1]?.length ?? 0;
  return fractionalDigits - Number(exponent) <= 7;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Every rule the create endpoint enforces, keyed by the payload field that
 * broke it. An empty object means the payload is acceptable.
 *
 * Returns all failures rather than the first so a form can mark every field in
 * one pass instead of one round trip per mistake.
 */
export function collectCreateInvoiceFieldErrors(
  payload: unknown
): Record<string, string> {
  if (!isPlainObject(payload)) {
    return { form: CREATE_INVOICE_MESSAGES.payload };
  }

  const errors: Record<string, string> = {};
  const sellerPublicKey = payload.sellerPublicKey;

  if (
    sellerPublicKey === undefined ||
    sellerPublicKey === null ||
    sellerPublicKey === ''
  ) {
    errors.sellerPublicKey = CREATE_INVOICE_MESSAGES.sellerPublicKeyRequired;
  } else if (!isStellarPublicKey(sellerPublicKey)) {
    errors.sellerPublicKey = CREATE_INVOICE_MESSAGES.publicKeyFormat;
  }

  const amount = payload.amount;
  if (amount === undefined || amount === null || amount === '') {
    errors.amount = CREATE_INVOICE_MESSAGES.amountRequired;
  } else if (typeof amount !== 'number') {
    errors.amount = CREATE_INVOICE_MESSAGES.amountNotNumber;
  } else if (!Number.isFinite(amount)) {
    errors.amount = CREATE_INVOICE_MESSAGES.amountNotFinite;
  } else if (amount <= 0) {
    errors.amount = CREATE_INVOICE_MESSAGES.amountPositive;
  } else if (amount > MAX_INVOICE_AMOUNT) {
    errors.amount = CREATE_INVOICE_MESSAGES.amountTooLarge;
  } else if (!hasStellarAmountPrecision(amount)) {
    errors.amount = CREATE_INVOICE_MESSAGES.amountPrecision;
  }

  const assetCode = optionalString(payload.assetCode);
  const assetIssuer = optionalString(payload.assetIssuer);

  if (assetIssuer !== null && assetIssuer !== '' && !isStellarPublicKey(assetIssuer)) {
    errors.assetIssuer = CREATE_INVOICE_MESSAGES.publicKeyFormat;
  } else if (requiresAssetIssuer(assetCode) && !assetIssuer) {
    errors.assetIssuer = CREATE_INVOICE_MESSAGES.assetIssuerRequired;
  } else if (isNativeAsset(assetCode) && assetIssuer) {
    errors.assetIssuer = CREATE_INVOICE_MESSAGES.assetIssuerNotAllowed;
  }

  const description = optionalString(payload.description);
  if (description !== null && description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = CREATE_INVOICE_MESSAGES.description;
  }

  const customerName = optionalString(payload.customerName);
  if (customerName !== null && customerName.length > MAX_NAME_LENGTH) {
    errors.customerName = CREATE_INVOICE_MESSAGES.customerName;
  }

  const sellerName = optionalString(payload.sellerName);
  if (sellerName !== null && sellerName.length > MAX_NAME_LENGTH) {
    errors.sellerName = CREATE_INVOICE_MESSAGES.sellerName;
  }

  const customerEmail = optionalString(payload.customerEmail);
  if (customerEmail !== null && customerEmail !== '' && !isValidEmail(customerEmail)) {
    errors.customerEmail = CREATE_INVOICE_MESSAGES.customerEmail;
  }

  const sellerEmail = optionalString(payload.sellerEmail);
  if (sellerEmail !== null && sellerEmail !== '' && !isValidEmail(sellerEmail)) {
    errors.sellerEmail = CREATE_INVOICE_MESSAGES.sellerEmail;
  }

  if (payload.network !== undefined && payload.network !== null) {
    const network = String(payload.network);
    if (!(SUPPORTED_STELLAR_NETWORKS as readonly string[]).includes(network)) {
      errors.network = CREATE_INVOICE_MESSAGES.network;
    }
  }

  if (payload.expiresInDays !== undefined && payload.expiresInDays !== null) {
    const days = payload.expiresInDays;
    if (
      typeof days !== 'number' ||
      !Number.isInteger(days) ||
      days < MIN_INVOICE_EXPIRY_DAYS ||
      days > MAX_INVOICE_EXPIRY_DAYS
    ) {
      errors.expiresInDays = CREATE_INVOICE_MESSAGES.expiresInDays;
    }
  }

  return errors;
}

/** The first message in field order, for the envelope's single error string. */
export function firstCreateInvoiceMessage(
  errors: Record<string, string>
): string | null {
  const fields: CreateInvoiceField[] = [
    'sellerPublicKey',
    'amount',
    'assetIssuer',
    'customerEmail',
    'sellerEmail',
    'description',
    'customerName',
    'sellerName',
    'expiresInDays',
    'network',
  ];

  for (const field of fields) {
    if (errors[field]) return errors[field];
  }

  return Object.values(errors)[0] ?? null;
}
