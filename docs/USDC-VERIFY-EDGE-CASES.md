# USDC Trustline and Path-Payment Verification Edge Cases

Specification, verification invariants, edge-case matrix, and testnet fixtures for USDC and path payments within Quittance.

---

## 1. Executive Summary and Demo Priority

Quittance enforces an **XLM-first** priority for all demo, MVP, and automated verification workflows as defined in `PLAN.md`. 

Stellar Lumens (XLM) are native to the Stellar protocol:
- Every active Stellar account holds native XLM by default.
- XLM transactions require no trustlines, no issuing account verification, and zero account pre-configuration.
- Demo flows and reviewer test packs execute with zero friction using native XLM.

USDC on Stellar is a credit asset issued under the `credit_alphanum4` asset type. Supporting USDC requires:
1. Validating the asset identifier tuple `(code, issuer)`, never the code alone.
2. Account trustline pre-conditions: an account cannot receive USDC without an established trustline.
3. Recognizing multi-hop and path payment operations where the payer sends XLM or another asset and the seller receives USDC.
4. Deterministic decimal and stroop comparison without binary floating-point arithmetic.

---

## 2. Supported Horizon Payment Shapes

A transaction submitted to the Stellar network can fulfill an invoice through one of three payment-delivering operation types. Any transaction containing only non-payment operations (such as `change_trust`, `set_options`, or `manage_data`) produces `NO_PAYMENT_OPERATION`.

### 2.1 Standard Payment (`payment`)

The standard payment operation transfers an asset directly from the source to the destination account.

```json
{
  "type": "payment",
  "from": "GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU",
  "to": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "amount": "20.0000000",
  "asset_type": "credit_alphanum4",
  "asset_code": "USDC",
  "asset_issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
}
```

Verification mapping:
- Destination: `operation.to`
- Amount delivered: `operation.amount`
- Asset code: `operation.asset_code`
- Asset issuer: `operation.asset_issuer`

### 2.2 Path Payment Strict Receive (`path_payment_strict_receive`)

The payer specifies the exact destination amount and asset to deliver. The network determines the source amount deducted from the sender's account.

```json
{
  "type": "path_payment_strict_receive",
  "from": "GCUXM6OT4H6PD7R6YUS632SDK36BYKDESGS4BSHTPTPDXBCYTE6JUEJE",
  "to": "GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU",
  "amount": "20.0000000",
  "asset_type": "credit_alphanum4",
  "asset_code": "USDC",
  "asset_issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "source_amount": "160.0000000",
  "source_max": "170.0000000",
  "source_asset_type": "native",
  "path": []
}
```

Verification mapping:
- Destination: `operation.to`
- Amount delivered: `operation.amount`
- Asset code: `operation.asset_code`
- Asset issuer: `operation.asset_issuer`

### 2.3 Path Payment Strict Send (`path_payment_strict_send`)

The payer specifies the exact source amount sent. Horizon reports what the destination receives in `amount` and `asset_*`; `source_amount` and `source_asset_*` describe the sender. The verifier also accepts the legacy synthetic `dest_*` aliases retained by the original fixture matrix.

```json
{
  "type": "path_payment_strict_send",
  "from": "GCUXM6OT4H6PD7R6YUS632SDK36BYKDESGS4BSHTPTPDXBCYTE6JUEJE",
  "to": "GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU",
  "source_amount": "200.0000000",
  "source_asset_type": "native",
  "amount": "25.0000000",
  "destination_min": "24.5000000",
  "asset_type": "credit_alphanum4",
  "asset_code": "USDC",
  "asset_issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "path": []
}
```

Verification mapping:
- Destination: `operation.to`
- Amount delivered: `operation.amount`
- Asset code: `operation.asset_code`
- Asset issuer: `operation.asset_issuer`

---

## 3. Trustline Mechanics and Edge Cases

On Stellar, non-native assets require trustlines (`ChangeTrust` operation). This constraint impacts verification at three stages:

### 3.1 Seller Lacks Trustline (Seller Ineligibility)
- If a seller creates an invoice for USDC without establishing a trustline on their Stellar account, the account cannot receive USDC.
- Any transaction attempting to deliver USDC to that seller fails at transaction submission with result code `tx_failed` and operation result `op_no_trust`.
- The transaction never reaches the ledger. When the payment page attempts to verify the transaction hash via Horizon, Horizon returns HTTP 404, resulting in `TRANSACTION_NOT_FOUND`.

### 3.2 Payer Lacks Trustline (Payer Conversion)
- If a payer holds XLM but lacks a USDC trustline, the payer can execute a `path_payment_strict_receive` operation.
- The payer sends XLM, Stellar Decentralized Exchange (DEX) converts the XLM to USDC, and the destination receives USDC.
- The transaction succeeds on-chain and satisfies verification because the seller receives the required USDC amount and issuer.

### 3.3 Counterfeit / Wrong Issuer USDC
- Anyone on Stellar can issue an asset with code `USDC`.
- A transaction paying `USDC` issued by an unauthorized key fails verification with `ASSET_MISMATCH`.
- Quittance validates the issuer against the configured Circle Testnet issuer:
  `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`

---

## 4. Edge-Case Matrix

The canonical check pipeline executes in fixed order:
1. Transaction hash format (`checkTxHash`)
2. Stellar network match (`NETWORK_MISMATCH`)
3. Payment operation presence (`NO_PAYMENT_OPERATION`)
4. Memo match (`MEMO_MISMATCH`)
5. Destination match (`DESTINATION_MISMATCH`)
6. Amount match (`AMOUNT_TOO_LOW` / `AMOUNT_TOO_HIGH`, `AMOUNT_MISMATCH` when unparseable)
7. Asset identity match (`ASSET_MISMATCH`)

| Scenario | Horizon Operation Shape | Invoice Expectation | Verify Outcome | Code | Rationale |
|---|---|---|---|---|---|
| Exact USDC Payment | `payment` (20.0000000 USDC, Circle issuer) | 20.0000000 USDC, Circle issuer | Accepted | - | Matches all criteria |
| Path Payment Strict Receive | `path_payment_strict_receive` (dest: 20 USDC) | 20.0000000 USDC, Circle issuer | Accepted | - | Delivered amount and asset match |
| Path Payment Strict Send | `path_payment_strict_send` (dest: 25 USDC) | 25.0000000 USDC, Circle issuer | Accepted | - | Delivered dest_amount matches |
| Rogue / Fake Issuer USDC | `payment` (20 USDC, Rogue issuer) | 20.0000000 USDC, Circle issuer | Rejected | `ASSET_MISMATCH` | Issuer does not match Circle testnet key |
| Underpayment | `payment` (20.0000000 USDC) | 25.0000000 USDC | Rejected | `AMOUNT_TOO_LOW` | Delivered amount is less than expected |
| Overpayment | `payment` (100.0000000 USDC) | 50.0000000 USDC | Rejected | `AMOUNT_TOO_HIGH` | Exact-amount contract rejects excess funds instead of settling |
| Sub-Stroop Dust (< 0.5 stroop) | `payment` (10.00000004 USDC) | 10.0000000 USDC | Accepted | - | 8th decimal < 5 rounds to zero delta |
| Sub-Stroop Dust (>= 0.5 stroop) | `payment` (10.00000005 USDC) | 10.0000000 USDC | Rejected | `AMOUNT_TOO_HIGH` | 8th decimal >= 5 rounds to a 1 stroop excess |
| Wrong Destination | `payment` (to: other account) | to: seller account | Rejected | `DESTINATION_MISMATCH` | Funds delivered to incorrect wallet |
| Memo Mismatch | `payment` (memo: 'WRONG') | memo: 'EXPECTED' | Rejected | `MEMO_MISMATCH` | Evaluated before destination and amount |
| Network Mismatch | `payment` observed on TESTNET | invoice network PUBLIC | Rejected | `NETWORK_MISMATCH` | Evaluated before payment operations |
| Trustline Only Tx | `change_trust` operation | any payment expectation | Rejected | `NO_PAYMENT_OPERATION` | No payment-delivering operation found |
| Missing Trustline (Failed Tx) | Transaction fails with `op_no_trust` | any payment expectation | Rejected | `TRANSACTION_NOT_FOUND` | Failed tx never confirmed on Horizon |

---

## 5. Safe Amount Comparison Contract (No Float)

Stellar amounts operate with 7 decimal places (1 unit = 10,000,000 stroops). JavaScript numbers are IEEE 754 double-precision floats, which introduce precision loss (e.g. `0.1 + 0.2 !== 0.3`).

The `safe-amount-compare.ts` module implements exact string decimal and BigInt arithmetic.

### 5.1 Helper API Contract

```typescript
export const STROOP_DECIMALS = 7;
export const STROOPS_PER_UNIT = 10_000_000n;

export function parseStroops(value: unknown): bigint | null;
export function formatStroops(stroops: bigint): string;
export function compareAmounts(expected: unknown, actual: unknown, toleranceStroops?: number | bigint): boolean;
export function isUnderpaid(expected: unknown, actual: unknown, toleranceStroops?: number | bigint): boolean;
export function isOverpaid(expected: unknown, actual: unknown, toleranceStroops?: number | bigint): boolean;
export function describeAmountDelta(expected: unknown, actual: unknown): AmountDelta;
```

### 5.2 Algorithm
1. Value is stringified, trimmed, and validated against `/^\d+(\.\d+)?$/`.
2. Input is split at the decimal point into integer and fractional parts.
3. Fractional part is truncated or padded to exactly 7 digits.
4. If fractional part exceeds 7 digits, the 8th digit is evaluated (half-up rounding to nearest stroop).
5. Exact integer stroops are calculated via BigInt:
   $$\text{stroops} = \text{BigInt}(\text{integerPart}) \times 10{,}000{,}000\text{n} + \text{BigInt}(\text{paddedFraction})$$
6. Difference is calculated as $|\text{expectedStroops} - \text{actualStroops}| \le \text{toleranceStroops}$.

---

## 6. Real Testnet Transaction Fixtures

The test fixture suite in `backend/tests/fixtures/usdc-verify-edge-cases.fixture.ts` exercises the verification pipeline using real on-chain transaction records from Stellar Testnet Horizon.

| Tx Hash | Asset | Amount | Destination | Explorer Link |
|---|---|---|---|---|
| `2a4261f890848f037bd45bc9860d6065757f6d8389e030945b148a0e625cf7bd` | USDC | 20.0000000 | `GBBD47...` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/2a4261f890848f037bd45bc9860d6065757f6d8389e030945b148a0e625cf7bd) |
| `ffa806b714bea1443ded88bff1f2b472905513deded3ba0b7cbd0f797a19854c` | USDC | 100.0000000 | `GBBD47...` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/ffa806b714bea1443ded88bff1f2b472905513deded3ba0b7cbd0f797a19854c) |
| `0334cd305019c8a73db6562d1c5f6351f4eead1220b100383b7d022683619d5d` | USDC | 0.1000000 | `GBBD47...` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/0334cd305019c8a73db6562d1c5f6351f4eead1220b100383b7d022683619d5d) |
| `2f2d26b1a3399181a99017ebe78ce64f84da7e2c9e0b1d0545bda1f2f0bc0d08` | XLM | 11.0000000 | `GCRXUV...` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/2f2d26b1a3399181a99017ebe78ce64f84da7e2c9e0b1d0545bda1f2f0bc0d08) |

---

## 7. Pay-Page Copy and Seller Guidance

To prevent sellers from creating USDC invoices their wallets cannot settle, the application interfaces must enforce the following copy and validation rules:

### 7.1 Invoice Creation Form (`frontend/components/InvoiceForm.tsx`)
When the seller selects `USDC`:
- **Warning Notice:**
  > "USDC Trustline Required: Your connected wallet must establish a trustline for Circle USDC before you can receive payment. If your wallet does not have a USDC trustline, client payments will fail on-chain."
- **Asset Helper Text:**
  > "Circle Testnet USDC (`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`)"

### 7.2 Payer Checkout Page (`frontend/app/pay/[id]/page.tsx`)
When viewing a USDC invoice:
- **Payer Instructions:**
  > "Payable with Circle USDC or via path payment using XLM. If your wallet holds XLM, Freighter will automatically convert it to USDC upon confirmation."
- **Error Handling on `op_no_trust`:**
  > "Payment failed on-chain: The recipient wallet has not established a trustline for USDC. Contact the seller to enable USDC on their account or request an XLM invoice."

---

## 8. Out of Scope

The following items are outside the scope of Issue #378:
1. Direct fiat on/off-ramp anchor integrations (SEP-24 / SEP-6).
2. Mainnet Circle issuer deployment and automated multi-issuer swapping.
3. Multi-currency portfolio analytics on the seller dashboard.

## Monitor parity and exact public receipts

The original path-payment examples above and in `usdc-verify-edge-cases.fixture.ts`
are synthetic. Their reused ordinary-payment hash does not prove those path
operations occurred on-chain. Exact public strict-send, strict-receive and
claimable-balance responses, with their real transaction hashes and provenance,
now live in `backend/tests/fixtures/monitor-testnet-receipts.json`. See
[Payment monitor evidence](PAYMENT_MONITOR.md#reproducible-evidence) for the
unchanged receipts, explicitly synthetic invoice replays, and the monitor/HTTP
acceptance command.
