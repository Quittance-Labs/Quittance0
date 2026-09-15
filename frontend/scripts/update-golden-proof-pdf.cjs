const fs = require('node:fs');
const path = require('node:path');
const { jsPDF } = require('jspdf');
const { createQuittanceProofPdf, buildQuittanceProof } = require('../lib/quittance-proof.ts');
const { NETWORK, FIXED_NOW, paidInvoice } = require('../tests/fixtures/quittance-proof.fixture');

const result = buildQuittanceProof(paidInvoice, { network: NETWORK, now: FIXED_NOW });
if (!result.ok) {
  throw new Error(`Cannot build golden proof: ${result.code}: ${result.message}`);
}

const doc = createQuittanceProofPdf(result.proof, jsPDF);
const outputPath = path.join(__dirname, '..', 'tests', 'fixtures', 'golden-proof.pdf');
fs.writeFileSync(outputPath, Buffer.from(doc.output('arraybuffer')));
console.log(`Updated ${path.relative(process.cwd(), outputPath)}`);
