import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('./payment-page-state.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const compiledModuleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
const {
  isExpiredInvoice,
  shouldShowPaymentControls,
} = await import(compiledModuleUrl);

test('identifies an expired invoice', () => {
  assert.equal(isExpiredInvoice('EXPIRED'), true);
  assert.equal(isExpiredInvoice('PENDING'), false);
});

test('hides payment controls for an expired invoice', () => {
  assert.equal(shouldShowPaymentControls('EXPIRED'), false);
});

test('keeps payment controls available for an unpaid pending invoice', () => {
  assert.equal(shouldShowPaymentControls('PENDING'), true);
  assert.equal(shouldShowPaymentControls('PENDING', 'existing-transaction'), false);
});
