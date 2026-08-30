import { InvoiceMemoryService } from '../services/invoice-memory.service';
import { CreateInvoiceInput } from '../utils/validation';
import type { InvoiceStats } from './invoice-stats';
import type { InvoiceStorage, PayerInfo, StoredInvoice } from './invoice-storage';

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

  async cancelInvoice(id: string): Promise<StoredInvoice> {
    return this.service.cancelInvoice(id);
  }

  async markAsPaid(
    id: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: PayerInfo
  ): Promise<StoredInvoice> {
    return this.service.markAsPaid(id, txHash, payerPublicKey, payerInfo);
  }

  async getInvoiceStats(sellerPublicKey: string): Promise<InvoiceStats[]> {
    return this.service.getInvoiceStats(sellerPublicKey);
  }

  async markExpiredInvoices(now?: Date): Promise<number> {
    return this.service.markExpiredInvoices(now);
  }
}

export default new MemoryInvoiceStorage();
