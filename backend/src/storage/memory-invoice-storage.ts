import { InvoiceMemoryService } from '../services/invoice-memory.service';
import { CreateInvoiceInput } from '../utils/validation';
import type { InvoiceStats } from './invoice-stats';
import type {
  InvoiceStorage,
  MarkAsPaidOptions,
  PaymentEventRecord,
  PayerInfo,
  StoredInvoice,
} from './invoice-storage';

export class MemoryInvoiceStorage implements InvoiceStorage {
  readonly mode = 'in-memory';

  constructor(private readonly service: InvoiceMemoryService = new InvoiceMemoryService()) {}

  async createInvoice(input: CreateInvoiceInput): Promise<StoredInvoice> {
    return this.service.createInvoice(input);
  }

  async getInvoiceById(id: string): Promise<StoredInvoice | null> {
    const invoice = await this.service.getInvoiceById(id);
    return invoice ?? null;
  }

  async getInvoicesBySeller(
    sellerPublicKey: string,
    status?: string,
    limit = 50,
    offset = 0
  ): Promise<StoredInvoice[]> {
    return this.service.getInvoicesBySeller(sellerPublicKey, status, limit, offset);
  }

  async cancelInvoice(id: string, sellerPublicKey?: string): Promise<StoredInvoice> {
    return this.service.cancelInvoice(id, sellerPublicKey);
  }

  async markAsPaid(
    id: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: PayerInfo,
    options?: MarkAsPaidOptions
  ): Promise<StoredInvoice> {
    return this.service.markAsPaid(id, txHash, payerPublicKey, payerInfo, options);
  }

  async getInvoiceStats(sellerPublicKey: string): Promise<InvoiceStats[]> {
    return this.service.getInvoiceStats(sellerPublicKey);
  }

  async markExpiredInvoices(now?: Date): Promise<number> {
    return this.service.markExpiredInvoices(now);
  }

  async countInvoices(): Promise<number> {
    return this.service.countInvoices();
  }

  async getPaymentEvents(invoiceId: string): Promise<PaymentEventRecord[]> {
    const events = await this.service.getPaymentEvents(invoiceId);
    return events.map((event) => ({
      id: event.id,
      invoiceId: event.invoiceId,
      eventType: event.eventType,
      eventData: (event.eventData ?? null) as Record<string, unknown> | null,
      createdAt: event.createdAt,
    }));
  }

  async logPaymentEvent(
    invoiceId: string,
    eventType: string,
    eventData?: Record<string, unknown> | null
  ): Promise<void> {
    return this.service.logPaymentEvent(invoiceId, eventType, eventData);
  }
}

export default new MemoryInvoiceStorage();
