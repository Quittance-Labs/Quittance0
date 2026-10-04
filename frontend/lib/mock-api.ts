// Mock API - Backend olmadan UI test için

import { PUBLIC_INVOICE_FIELDS } from '@shared/invoice';
import { Keypair, Transaction, WebAuth } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, STELLAR_NETWORK, signSellerChallenge } from './stellar';
import { createSellerSessionManager, type SellerSessionToken } from './wallet-session';
import { useWalletStore } from './store';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const MIN_EXPIRY_DAYS = 1;
const MAX_EXPIRY_DAYS = 30;

// This module simulates both sides for local UI demos only. Its ephemeral key
// and opaque tokens are never a production credential or a persisted account.
const mockSigningKey = Keypair.random();
const mockDomain = 'quittance.mock';
const challenges = new Map<string, { account: string; expiresAt: number }>();
const sessions = new Map<string, SellerSessionToken>();
const authError = (code: string, message: string, status = 401): never => {
  throw Object.assign(new Error(message), {
    code, response: { status, data: { success: false, code, error: message } },
  });
};
const publicInvoice = (invoice: any) => Object.fromEntries(
  PUBLIC_INVOICE_FIELDS.filter((key) => invoice[key] !== undefined).map((key) => [key, invoice[key]])
);

export const mockAuthApi = {
  getChallenge: async (account: string, network: string) => {
    if (network !== STELLAR_NETWORK) authError('AUTH_NETWORK_MISMATCH', 'Wrong Stellar network.');
    const transaction = WebAuth.buildChallengeTx(
      mockSigningKey, account, mockDomain, 300, NETWORK_PASSPHRASE, mockDomain
    );
    const tx = new Transaction(transaction, NETWORK_PASSPHRASE);
    const expiresAt = Number(tx.timeBounds?.maxTime);
    for (const [hash, challenge] of challenges) {
      if (challenge.expiresAt * 1000 <= Date.now()) challenges.delete(hash);
    }
    challenges.set(tx.hash().toString('hex'), { account, expiresAt });
    return { success: true, data: {
      transaction, network, networkPassphrase: NETWORK_PASSPHRASE,
      serverSigningKey: mockSigningKey.publicKey(), homeDomain: mockDomain,
      webAuthDomain: mockDomain, expiresAt,
    } };
  },
  createSession: async ({ transaction, network }: { transaction: string; network: string }) => {
    if (network !== STELLAR_NETWORK) authError('AUTH_NETWORK_MISMATCH', 'Wrong Stellar network.');
    let hash: string;
    try {
      hash = new Transaction(transaction, NETWORK_PASSPHRASE).hash().toString('hex');
    } catch {
      return authError('AUTH_INVALID_CHALLENGE', 'Invalid seller challenge.');
    }
    const challenge = challenges.get(hash);
    if (!challenge) return authError('AUTH_CHALLENGE_REPLAYED', 'Challenge is unknown or already used.');
    if (challenge.expiresAt * 1000 <= Date.now()) {
      challenges.delete(hash);
      return authError('AUTH_CHALLENGE_EXPIRED', 'Seller challenge expired.');
    }
    try {
      WebAuth.verifyChallengeTxSigners(transaction, mockSigningKey.publicKey(), NETWORK_PASSPHRASE,
        [challenge.account], mockDomain, mockDomain);
    } catch {
      return authError('AUTH_INVALID_SIGNATURE', 'The seller must sign this challenge.');
    }
    challenges.delete(hash);
    const token = crypto.randomUUID();
    const data = { token, sellerPublicKey: challenge.account, network, expiresAt: Math.floor(Date.now() / 1000) + 3600 };
    sessions.set(token, data);
    return { success: true, data };
  },
};

const mockSellerSessions = createSellerSessionManager({
  getWalletSession: useWalletStore.getState,
  expectedNetwork: STELLAR_NETWORK,
  authenticate: async (wallet, assertCurrent) => {
    const challenge = await mockAuthApi.getChallenge(wallet.publicKey!, wallet.network!);
    assertCurrent();
    const transaction = await signSellerChallenge(challenge.data, wallet.publicKey!);
    assertCurrent();
    const response = await mockAuthApi.createSession({ transaction, network: wallet.network! });
    assertCurrent();
    return response.data;
  },
});
mockSellerSessions.sync();
useWalletStore.subscribe(() => mockSellerSessions.sync());

async function requireMockSeller(sellerPublicKey?: string | null, delayMs = 500) {
  const context = mockSellerSessions.contextFor(sellerPublicKey);
  const token = await mockSellerSessions.getToken(context);
  await delay(delayMs);
  mockSellerSessions.assertCurrent(context);
  const session = sessions.get(token);
  if (!session || session.expiresAt * 1000 <= Date.now()) {
    return authError('AUTH_SESSION_EXPIRED', 'Seller session expired.');
  }
  if (sellerPublicKey && sellerPublicKey !== session.sellerPublicKey) {
    return authError('AUTH_SELLER_MISMATCH', 'The seller does not match the session.', 403);
  }
  return session;
}

function requireMockOwner(invoice: any, session: SellerSessionToken) {
  if (!invoice) throw new Error('Invoice not found');
  if (invoice.sellerPublicKey !== session.sellerPublicKey) {
    authError('AUTH_SELLER_MISMATCH', 'This invoice belongs to another seller.', 403);
  }
}

// Mock invoice data
const mockInvoices = [
  {
    id: '1',
    amount: 100.50,
    assetCode: 'XLM',
    description: 'Web geliştirme hizmeti',
    customerName: 'Ahmet Yılmaz',
    customerEmail: 'ahmet@example.com',
    status: 'PAID',
    memo: 'INV-DEMO-001',
    sellerPublicKey: 'GABC123EXAMPLE456',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    paidAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    paymentTxHash: 'abc123def456ghi789',
    payerPublicKey: 'GXYZ789EXAMPLE123',
  },
  {
    id: '2',
    amount: 250.00,
    assetCode: 'XLM',
    description: 'Logo tasarımı',
    customerName: 'Ayşe Kaya',
    status: 'PENDING',
    memo: 'INV-DEMO-002',
    sellerPublicKey: 'GABC123EXAMPLE456',
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '3',
    amount: 75.25,
    assetCode: 'XLM',
    description: 'Danışmanlık ücreti',
    customerName: 'Mehmet Demir',
    status: 'PENDING',
    memo: 'INV-DEMO-003',
    sellerPublicKey: 'GABC123EXAMPLE456',
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 6.8 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '4',
    amount: 500.00,
    assetCode: 'USDC',
    description: 'Mobil uygulama geliştirme',
    customerName: 'Fatma Şahin',
    status: 'EXPIRED',
    memo: 'INV-DEMO-004',
    sellerPublicKey: 'GABC123EXAMPLE456',
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

function expirePendingInvoices(now = Date.now()) {
  mockInvoices.forEach((invoice) => {
    if (
      invoice.status === 'PENDING' &&
      Number.isFinite(new Date(invoice.expiresAt).getTime()) &&
      new Date(invoice.expiresAt).getTime() <= now
    ) {
      invoice.status = 'EXPIRED';
    }
  });
}

function payableMockInvoice(invoice: any) {
  expirePendingInvoices();
  if (invoice?.status === 'EXPIRED') {
    throw Object.assign(new Error('Invoice has expired and can no longer accept payment'), {
      code: 'INVOICE_EXPIRED',
    });
  }
  if (invoice?.status !== 'PENDING') throw new Error('Invoice is not pending');
}

export const mockInvoiceApi = {
  create: async (data: any) => {
    const session = await requireMockSeller(data.sellerPublicKey, 1000);
    if (data.network && data.network !== session.network) {
      authError('AUTH_NETWORK_MISMATCH', 'Wrong Stellar network.', 403);
    }
    const expiresInDays = data.expiresInDays ?? 7;
    if (!Number.isInteger(expiresInDays) || expiresInDays < MIN_EXPIRY_DAYS || expiresInDays > MAX_EXPIRY_DAYS) {
      throw new Error('Invoice expiry must be an integer between 1 and 30 days');
    }
    
    const newInvoice = {
      id: Math.random().toString(36).substr(2, 9),
      ...data,
      status: 'PENDING',
      memo: `INV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
      sellerPublicKey: session.sellerPublicKey,
      network: session.network,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
    };

    mockInvoices.unshift(newInvoice);

    const paymentUrl = `${window.location.origin}/pay/${newInvoice.id}`;
    const qrCode = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    return {
      success: true,
      data: {
        invoice: newInvoice,
        paymentUrl,
        qrCode,
        stellarQrCode: qrCode,
        stellarUri: undefined,
        copyValue: paymentUrl,
        stellarQrEncodesUri: false,
      },
    };
  },

  getById: async (id: string, sellerPublicKey?: string | null) => {
    const session = sellerPublicKey ? await requireMockSeller(sellerPublicKey) : null;
    if (!session) await delay(500);
    expirePendingInvoices();
    const invoice = mockInvoices.find(inv => inv.id === id);
    
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (!session || session.sellerPublicKey !== invoice.sellerPublicKey) {
      return {
        success: true,
        data: publicInvoice(invoice),
      };
    }

    return {
      success: true,
      data: invoice,
    };
  },

  getAll: async (params?: any) => {
    const session = await requireMockSeller(params?.sellerPublicKey, 700);
    expirePendingInvoices();
    let filtered = mockInvoices.filter((invoice) => invoice.sellerPublicKey === session.sellerPublicKey);

    if (params?.status && params.status !== 'ALL') {
      filtered = filtered.filter(inv => inv.status === params.status);
    }

    return {
      success: true,
      data: filtered,
      pagination: {
        limit: params?.limit || 50,
        offset: params?.offset || 0,
        total: filtered.length,
      },
    };
  },

  getPaymentInfo: async (id: string) => {
    await delay(500);
    expirePendingInvoices();
    const invoice = mockInvoices.find(inv => inv.id === id);
    
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    const paymentUrl = `${window.location.origin}/pay/${invoice.id}`;
    const qrCode = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    return {
      success: true,
      data: {
        paymentUrl,
        paymentAvailable: invoice.status === 'PENDING',
        qrCode: invoice.status === 'PENDING' ? qrCode : null,
        stellarQrCode: invoice.status === 'PENDING' ? qrCode : null,
        stellarUri: undefined,
        copyValue: paymentUrl,
        stellarQrEncodesUri: false,
        invoice: publicInvoice(invoice),
      },
    };
  },

  getPaymentEvents: async (id: string, sellerPublicKey: string) => {
    const session = await requireMockSeller(sellerPublicKey);
    requireMockOwner(mockInvoices.find((invoice) => invoice.id === id), session);
    return { success: true, data: [] };
  },

  cancel: async (id: string, sellerPublicKey: string) => {
    const session = await requireMockSeller(sellerPublicKey);
    const invoice = mockInvoices.find(inv => inv.id === id);
    requireMockOwner(invoice, session);
    payableMockInvoice(invoice);
    if (invoice) {
      invoice.status = 'CANCELLED';
    }

    return {
      success: true,
      data: invoice,
    };
  },

  verify: async (id: string, txHash: string) => {
    await delay(1000);
    const invoice = mockInvoices.find(inv => inv.id === id);
    
    payableMockInvoice(invoice);
    if (invoice) {
      invoice.status = 'PAID';
      invoice.paymentTxHash = txHash;
      invoice.paidAt = new Date().toISOString();
    }

    return {
      success: true,
      data: publicInvoice(invoice),
    };
  },

  getStats: async (sellerPublicKey: string) => {
    const session = await requireMockSeller(sellerPublicKey);
    expirePendingInvoices();
    const sellerInvoices = mockInvoices.filter((invoice) => invoice.sellerPublicKey === session.sellerPublicKey);
    const revenueByAsset = sellerInvoices
      .filter(invoice => invoice.status === 'PAID')
      .reduce<Record<string, number>>((revenue, invoice) => {
        revenue[invoice.assetCode] = (revenue[invoice.assetCode] || 0) + invoice.amount;
        return revenue;
      }, {});

    const stats = {
      total_invoices: sellerInvoices.length,
      paid_invoices: sellerInvoices.filter(inv => inv.status === 'PAID').length,
      pending_invoices: sellerInvoices.filter(inv => inv.status === 'PENDING').length,
      actionable_invoices: sellerInvoices.filter(inv => inv.status === 'PENDING').length,
      expired_invoices: sellerInvoices.filter(inv => inv.status === 'EXPIRED').length,
      revenue_by_asset: revenueByAsset,
    };

    return {
      success: true,
      data: [stats],
    };
  },
};

export const mockStellarApi = {
  getAccount: async (publicKey?: string) => {
    await delay(500);
    return {
      success: true,
      data: {
        publicKey: publicKey || 'GABC123EXAMPLE456',
        balances: [
          { assetCode: 'XLM', balance: '1234.5678900' },
          { assetCode: 'USDC', balance: '500.00' },
        ],
        sequence: '123456789',
        subentryCount: 5,
      },
    };
  },

  getPayments: async (publicKey?: string, limit?: number) => {
    await delay(500);
    return {
      success: true,
      data: [],
    };
  },

  getTransaction: async (hash: string) => {
    await delay(500);
    return {
      success: true,
      data: {
        transaction: {
          hash,
          memo: 'INV-DEMO-001',
          successful: true,
        },
        operations: [],
      },
    };
  },

  verifyPayment: async (txHash: string, memo: string, amount: string) => {
    await delay(500);
    return {
      success: true,
      data: {
        isValid: true,
        txHash,
        memo,
        amount,
      },
    };
  },
};

export const mockHealthCheck = async () => {
  await delay(200);
  return {
    status: 'ok (MOCK MODE)',
    timestamp: new Date().toISOString(),
    service: 'Quittance API (Mock)',
  };
};
