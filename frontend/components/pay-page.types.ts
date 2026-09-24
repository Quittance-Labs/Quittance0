import type { InvoiceDto } from '../../shared/invoice';
import type { PaymentInfoResult } from '../../shared/invoice-contract';

/**
 * Pay-page invoice shape. One shared DTO with the API client (issue #446).
 * Seller-only fields are optional and absent on anonymous pay responses.
 */
export type PayPageInvoice = InvoiceDto;

/** Payment instructions returned beside the invoice on the pay page. */
export type PayPagePaymentInfo = PaymentInfoResult;
