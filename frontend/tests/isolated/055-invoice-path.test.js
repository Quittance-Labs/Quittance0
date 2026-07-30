const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal in-file helper
function buildInvoicePath(id) {
    if (id === undefined || id === null || id === '') {
        throw new Error('Invoice ID is required');
    }
    return `/invoice/${encodeURIComponent(id)}`;
}

test('buildInvoicePath generates correct path for valid ID', () => {
    const path = buildInvoicePath('12345');
    assert.strictEqual(path, '/invoice/12345');
});

test('buildInvoicePath correctly encodes special characters', () => {
    const path = buildInvoicePath('123/456?abc');
    assert.strictEqual(path, '/invoice/123%2F456%3Fabc');
});

test('buildInvoicePath throws error for empty ID', () => {
    assert.throws(() => {
        buildInvoicePath('');
    }, /Invoice ID is required/);
});
