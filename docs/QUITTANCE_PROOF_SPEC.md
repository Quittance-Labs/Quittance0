# Quittance Proof Document Model & Generation Specification

## 1. Overview
This document specifies the canonical settlement proof document (`quittance.v1`) and its integration into the PDF generation and export pipeline for Quittance (#376).

The canonical proof model defines a deterministic, auditable record of settlement on Stellar Horizon. It replaces unstructured receipt rendering with a schema-governed document that guarantees cryptographic counterparty integrity and prevents sensitive data leaks.

---

## 2. Canonical Schema Definition (`quittance.v1`)

The formal schema definition resides at `frontend/lib/quittance-proof.schema.json`.

### Top-Level Document Structure
| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `string` | Pinned to `"quittance.v1"`. |
| `invoiceId` | `string` | Unique identifier of the invoice. |
| `network` | `'testnet' \| 'public'` | Stellar network on which payment settled. |
| `status` | `'PAID' \| 'PENDING' \| 'EXPIRED' \| 'CANCELLED'` | Lifecycle settlement status. |
| `issuedAt` | `string` | ISO-8601 UTC timestamp of creation. |
| `dueAt` | `string` | ISO-8601 UTC timestamp of expiration. |
| `settledAt` | `string \| null` | ISO-8601 UTC ledger close time of the settlement transaction, or null. |
| `seller` | `string` | Stellar public key (`G...`) of payee. |
| `payer` | `string \| null` | Stellar public key (`G...`) of payer, or null if unrecorded. |
| `payment` | `object` | Settlement transaction details (hash, memo, amount, asset, explorer). |
| `verification` | `object` | Verification status, method, audit timestamp (`checkedAt`), `settlementContext` (`'ON_TIME' \| 'AFTER_EXPIRY' \| 'AFTER_CANCEL' \| null`), and `latePaymentWarningCode` (`string \| null`). |
| `document` | `object` | Generation metadata (UTC timestamp and issuing client). |

---

## 3. The Seven Core Invariants

All serialization, exports, HTML renderings, and PDF buffers must strictly satisfy the following seven invariants.

### Invariant 1: Versioned
Every proof document must declare an explicit `schemaVersion` matching `quittance.v1`. Consumers must reject missing or unrecognized schema versions.

### Invariant 2: Amounts Are Strings
Amounts must be represented strictly as decimal strings with at most 7 decimal places (e.g., `"250.5000000"`). Floating-point representations are forbidden across all storage and serialization interfaces to prevent IEEE-754 precision loss.

### Invariant 3: UTC Timestamps
All timestamps (`issuedAt`, `dueAt`, `settledAt`, `checkedAt`, `generatedAtUtc`) must be formatted as ISO-8601 UTC strings terminating with the literal `Z` suffix. Local offsets are prohibited.

### Invariant 4: Deterministic Representation
Given identical inputs and clock injection, the serialization output must be byte-for-byte identical across runs:
- Field keys are ordered deterministically according to `QUITTANCE_PROOF_FIELDS`.
- PDF generation utilizes fixed creation dates and deterministic file identifiers (`setFileId('00000000000000000000000000000000')`).

### Invariant 5: Single Counterparty
Settlement records link exactly one payer account (`G...`) to one recipient seller account (`G...`). Multi-party or list structures for payers are rejected.

### Invariant 6: Anti-Leak / Zero-PII
Proof documents, mailto bodies, payment-event payloads, and structured logs must never contain:
- Stellar secret keys (matching regex `S[A-Z2-7]{55}`).
- Personally Identifiable Information (client email, payer email, payer name, seller profile fields).

Issue #559: `PUBLIC_INVOICE_FIELDS` in `shared/invoice.ts` is the single allowlist for anonymous pay, payment-info, and verify responses. `SELLER_ONLY_INVOICE_FIELDS` names the identity keys that must stay off those surfaces, proof HTML, mailto bodies, and redacted event/log payloads. Seller workspace reads gated by the invoice Freighter wallet remain the only path that returns client contact.

### Invariant 7: No Inferred Ownership
Unsettled invoices or invoices lacking explicit payer keys must have `payer: null`. The system must never guess, infer, or populate default payer addresses.

---

## 4. PDF Generation Architecture: Client vs. Server Tradeoffs

Issue #376 requires a formal recommendation regarding client-side versus server-side PDF generation.

### Comparison Matrix

| Dimension | Client-Side Generation (Current) | Server-Side Generation (Recommended Hardening) |
|---|---|---|
| **Mechanism** | In-browser rendering via `window.print()` / `jsPDF` | Headless Chromium / Node PDF engine (e.g. Playwright, PDFKit) |
| **Compute Overhead** | Zero server load; client device handles rendering | Server CPU and memory consumption per export |
| **Determinism** | Dependent on browser rendering engine and font rasterization | Completely deterministic environment in CI/container |
| **Asynchronous Delivery** | Impossible without active client session | Enables automated email attachments and background webhook receipts |
| **Audit Trails & Archival** | ephemeral client download | Immutable storage (S3/GCS/IPFS) with cryptographic hashing |
| **Offline Proof Verification**| High user friction | Pre-generated, signable static binary artifact |

### Architectural Recommendation

1. **Short-Term (Implemented in #376):** Maintain client-side generation via `renderQuittanceProofHtml` and `createQuittanceProofPdf`. This preserves instant user feedback in the web dashboard, avoids introducing heavy headless browser containers into the MVP server, and provides zero-cost PDF saving for interactive users.
2. **Long-Term Production Hardening:** Introduce a server-side PDF compilation worker. When an invoice status transitions to `PAID`, the backend payment monitor should compile the canonical proof PDF, compute its SHA-256 hash, store the artifact in cold object storage, and include the download URL in outbound settlement webhooks and emails.

---

## 5. Regression Test Plan & Golden Fixtures

The test suite enforces stability via golden file comparisons and assertion suites:

1. **Golden JSON Fixture (`goldenProofJson`):** Pinned serialized JSON in `frontend/tests/fixtures/quittance-proof.fixture.js`.
2. **Golden HTML Fixture (`golden-proof.html`):** Pinned print-ready HTML in `frontend/tests/fixtures/golden-proof.html`.
3. **Golden PDF Binary Fixture (`golden-proof.pdf`):** Deterministic PDF binary in `frontend/tests/fixtures/golden-proof.pdf`.
4. **Automated Test Coverage:**
   - `frontend/tests/quittance-proof.test.js`: Verifies invariant enforcement, golden JSON match, golden HTML match, byte-for-byte golden PDF match, and type guards.
   - `tests/export.test.mjs`: Verifies `generateInvoicePDF` and `generateQuittanceProofPDF` handle `QuittanceProof` without drift against legacy invoice exports.
