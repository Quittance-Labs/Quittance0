const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQuittanceProof,
  validateQuittanceProofSchema,
  parseQuittanceProof,
  checkQuittanceProofInvariants,
} = require('../lib/quittance-proof.ts');
const { buildProofMailto } = require('../lib/mailto-delivery.js');
const schema = require('../lib/quittance-proof.schema.json');
const { paidInvoice, pendingInvoice, FIXED_NOW } = require('./fixtures/quittance-proof.fixture.js');

function build(invoice, network = 'testnet') {
  const result = buildQuittanceProof(invoice, { network, now: FIXED_NOW });
  assert.equal(result.ok, true);
  return result.proof;
}

function objectRules(contract, path = []) {
  if (contract.type !== 'object') return [];
  return [
    { path, contract },
    ...Object.entries(contract.properties).flatMap(([key, child]) => objectRules(child, [...path, key])),
  ];
}

function objectAt(doc, path) {
  return path.reduce((value, key) => value[key], doc);
}

for (const [label, invoice] of [['paid', paidInvoice], ['unpaid', pendingInvoice]]) {
  for (const { path, contract } of objectRules(schema)) {
    for (const field of contract.required) {
      const fullPath = [...path, field].join('.');
      test(`${label}: every schema-required field is enforced at ${fullPath}`, () => {
        const proof = build(invoice);
        delete objectAt(proof, path)[field];
        const serialized = JSON.stringify(proof);
        const validation = validateQuittanceProofSchema(proof);
        assert.equal(validation.valid, false);
        assert.ok(validation.errors.some(error => error.includes(fullPath)), 'missing field path must remain actionable');
        assert.equal(parseQuittanceProof(serialized), null);
        assert.ok(checkQuittanceProofInvariants(serialized).includes(`REQUIRED_FIELD_${fullPath}`));
      });
    }

    test(`${label}: the schema closes ${path.join('.') || 'root'} against extra fields`, () => {
      assert.equal(contract.additionalProperties, false);
      const proof = build(invoice);
      objectAt(proof, path).undeclaredPrivateField = 'private-fixture@example.invalid';
      const validation = validateQuittanceProofSchema(proof);
      assert.equal(validation.valid, false);
      assert.ok(validation.errors.some(error => error.includes([...path, 'undeclaredPrivateField'].join('.'))));
      assert.equal(parseQuittanceProof(JSON.stringify(proof)), null);
    });
  }

  test(`${label}: optional verification fields remain optional`, () => {
    const proof = build(invoice);
    delete proof.verification.settlementContext;
    delete proof.verification.latePaymentWarningCode;
    assert.equal(validateQuittanceProofSchema(proof).valid, true);
    assert.deepEqual(parseQuittanceProof(JSON.stringify(proof)), proof);
    assert.deepEqual(checkQuittanceProofInvariants(JSON.stringify(proof)), []);
  });
}

for (const [field, value] of [
  ['settlementContext', 'INVENTED_CONTEXT'],
  ['settlementContext', 1],
  ['settlementContext', {}],
  ['latePaymentWarningCode', { privateData: 'fixture' }],
  ['latePaymentWarningCode', []],
]) {
  test(`rejects invalid optional verification.${field}: ${JSON.stringify(value)}`, () => {
    const proof = build(paidInvoice);
    proof.verification[field] = value;
    assert.equal(validateQuittanceProofSchema(proof).valid, false);
    assert.equal(parseQuittanceProof(JSON.stringify(proof)), null);
  });
}

test('accepts every declared settlement context and null warning values', () => {
  for (const settlementContext of schema.properties.verification.properties.settlementContext.enum) {
    const proof = build(paidInvoice);
    proof.verification.settlementContext = settlementContext;
    proof.verification.latePaymentWarningCode = null;
    assert.equal(validateQuittanceProofSchema(proof).valid, true);
  }
});

test('inherited required fields do not satisfy the document contract', () => {
  assert.equal(validateQuittanceProofSchema(Object.create(build(paidInvoice))).valid, false);
});

for (const value of [1, 'text', true, [], null, 0]) {
  test(`invalid JSON document shape ${JSON.stringify(value)} reports violations without throwing`, () => {
    const serialized = JSON.stringify(value);
    assert.equal(validateQuittanceProofSchema(value).valid, false);
    assert.equal(parseQuittanceProof(serialized), null);
    let violations;
    assert.doesNotThrow(() => { violations = checkQuittanceProofInvariants(serialized); });
    assert.ok(violations.length > 0);
  });
}

for (const status of ['PENDING', 'EXPIRED', 'CANCELLED']) {
  test(`${status} canonical documents cannot bypass payment-proof email eligibility`, () => {
    const invoice = { ...pendingInvoice, status, customerEmail: 'recipient@example.invalid' };
    const proof = build(invoice);
    assert.equal(validateQuittanceProofSchema(proof).valid, true, 'unpaid documents remain valid exports');
    for (const input of [invoice, proof]) {
      assert.throws(() => buildProofMailto(input, 'https://example.invalid', 'recipient@example.invalid'), /Payment proof is (available only after|unavailable because)/);
    }
  });
}

for (const network of ['testnet', 'public']) {
  test(`paid canonical documents still produce the ${network} proof email without source email metadata`, () => {
    const proof = build(paidInvoice, network);
    const mail = decodeURIComponent(buildProofMailto(proof, 'https://example.invalid', 'recipient@example.invalid'));
    assert.ok(mail.includes(proof.invoiceId));
    assert.ok(mail.includes(proof.payment.amount));
    assert.ok(mail.includes(proof.payment.txHash));
    assert.ok(mail.includes(`/explorer/${network}/tx/`));
    assert.ok(mail.includes('Verified on Stellar Blockchain'));
  });
}
