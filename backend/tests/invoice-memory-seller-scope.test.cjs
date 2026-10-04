/** Focused service-boundary checks; storage and unused imports are collaborators. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const filename = process.env.INVOICE_MEMORY_SOURCE ||
  path.resolve(__dirname, '../src/services/invoice-memory.service.ts');
const loaded = new Module(filename, module);
const unused = () => { throw new Error('Unexpected collaborator invocation'); };
const imports = {
  '../domain/payment-attribution': { InvoiceIdCollisionError: Error, MemoCollisionError: Error },
  '../utils/memo': { generateInvoiceMemo: unused },
  '../utils/memory-public-id': { generatePublicInvoiceId: unused },
  '../storage/memory-storage': { __esModule: true, default: {} },
  '../domain/invoice-expiry': { calculateInvoiceExpiry: unused },
};
loaded.require = (id) => {
  if (!Object.hasOwn(imports, id)) throw new Error(`Unexpected import: ${id}`);
  return imports[id];
};
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { InvoiceMemoryService } = loaded.exports;

function setup() {
  const rows = [
    { id: 'a-new', sellerPublicKey: 'seller-a', status: 'PENDING' },
    { id: 'b-new', sellerPublicKey: 'seller-b', status: 'PENDING' },
    { id: 'a-old', sellerPublicKey: 'seller-a', status: 'PAID' },
  ];
  const calls = { list: 0, stats: 0 };
  const storage = {
    getAllInvoices(filter) {
      calls.list++;
      return rows.filter((row) => !filter?.status || row.status === filter.status);
    },
    getStats(seller) {
      calls.stats++;
      return { total_invoices: rows.filter((row) => row.sellerPublicKey === seller).length };
    },
    markExpiredInvoices: () => 0,
  };
  return { service: new InvoiceMemoryService(storage), calls };
}

for (const method of ['getInvoicesBySeller', 'getInvoiceStats']) {
  for (const [label, seller] of [['empty', ''], ['undefined', undefined], ['null', null]]) {
    test(`${method} rejects ${label} seller before accessing storage`, async () => {
      const { service, calls } = setup();
      await assert.rejects(service[method](seller), { message: 'Seller public key is required' });
      assert.deepEqual(calls, { list: 0, stats: 0 });
    });
  }
}

test('valid seller listing retains isolation, status filter and pagination', async () => {
  const { service } = setup();
  assert.deepEqual((await service.getInvoicesBySeller('seller-a')).map((r) => r.id), ['a-new', 'a-old']);
  assert.deepEqual((await service.getInvoicesBySeller('seller-a', 'PENDING')).map((r) => r.id), ['a-new']);
  assert.deepEqual((await service.getInvoicesBySeller('seller-a', undefined, 1, 1)).map((r) => r.id), ['a-old']);
});

test('valid and unknown seller stats retain their existing result shape', async () => {
  const { service } = setup();
  assert.deepEqual(await service.getInvoiceStats('seller-a'), [{ total_invoices: 2 }]);
  assert.deepEqual(await service.getInvoiceStats('not-present'), [{ total_invoices: 0 }]);
});

test('unknown nonempty seller listing remains empty', async () => {
  const { service } = setup();
  assert.deepEqual(await service.getInvoicesBySeller('not-present'), []);
});

test('the deliberately unscoped pending-monitor method remains available', async () => {
  const { service } = setup();
  assert.deepEqual((await service.listPendingInvoices()).map((r) => r.id), ['a-new', 'b-new']);
  assert.deepEqual((await service.listPendingInvoices('seller-a')).map((r) => r.id), ['a-new']);
});
