# Payment URIs and QR payloads

Issue #382. This covers the `web+stellar:pay` URI that invoice creation returns as
`stellarQrCode`: how each field maps to [SEP-0007](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md),
where the emitted URI can be something a wallet refuses, and what to change in
the formatter. The executable half lives in
[`tests/payment-uri-conformance.test.ts`](../backend/tests/payment-uri-conformance.test.ts)
and `tests/fixtures/payment-uri-cases.fixture.ts`.

## Where the URI comes from

`POST /api/invoices` returns two QR codes and they are not the same kind of thing:

| Response field | Content | Who reads it |
| --- | --- | --- |
| `qrCode` | the pay page URL, `{frontendUrl}/pay/{id}` | any camera app |
| `stellarQrCode` | the SEP-0007 URI below | a Stellar wallet |

`buildPaymentPayload` → `generateStellarPaymentQR(sellerPublicKey, amount, assetCode, memo, assetIssuer)`
→ `formatQrPaymentPayload` → `QRCode.toDataURL`. The formatter is pure and does
no QR work; `generateStellarPaymentQR` encodes with error correction level H.

## Field-by-field mapping

| Parameter | What we emit | SEP-0007 says | Verdict |
| --- | --- | --- | --- |
| scheme | `web+stellar:pay?` | `web+stellar:<operation>?<params>`, `pay` operation | conformant |
| `destination` | the seller's `G...` key | required: "a valid account ID **or payment address**" | G-addresses only — a valid `M...` payment address is refused (gap 4) |
| `amount` | `invoice.amount.toString()` | optional; Stellar amounts carry at most 7 decimals | emitted unchanged — 8+ decimals pass through (gap 1) |
| `asset_code` | only for non-native assets | optional, "XLM if not present" | conformant; an XLM-labelled credit asset loses its issuer silently (gap 5) |
| `asset_issuer` | with `asset_code` | optional, same rule | conformant |
| `memo` | the invoice memo, `INV-<ms>-<8>`, 21 chars | optional; `MEMO_TEXT` must be URL-encoded (`MEMO_HASH`/`MEMO_RETURN` are base64 **then** URL-encoded) | conformant for generated memos; no byte guard (gaps 2, 3) |
| `memo_type` | `MEMO_TEXT` | one of `MEMO_TEXT`, `MEMO_ID`, `MEMO_HASH`, `MEMO_RETURN` | conformant |
| `msg` | not emitted | optional, shown to the payer for context | not required; the pay page carries the context instead |
| encoding | `encodeURIComponent` per value | URL-encoded | conformant |

**Not in the table because SEP-0007 has no such parameter: the network.** The
scheme cannot say "this invoice is testnet". A payer whose wallet is on mainnet
scans a testnet invoice, sees a destination and an amount that are structurally
fine, and builds a mainnet payment to an account that holds no such invoice.
Today's mitigations are that the pay page is the intended entry point, and that
`createInvoice` rejects a client whose `network` does not match the server's.
Inventing a `network` param would be ignored by the wallets we care about, so
the honest options are to label the QR with its network in the UI, or to move the
wallet path to a `tx` op URI with a pre-built envelope — a much larger change
than this issue.

## Memo types and limits

| Type | Encoding in the URI | Limit | Authority |
| --- | --- | --- | --- |
| `MEMO_TEXT` | plain, URL-encoded | 28 **bytes** | `Memo.text` throws past 28 bytes, and counts bytes: `'☕'.repeat(10)` is 10 characters and 30 bytes |
| `MEMO_ID` | plain | 64-bit unsigned integer | |
| `MEMO_HASH`, `MEMO_RETURN` | base64, then URL-encoded | 32 bytes | SEP-0007 §pay |

We emit `MEMO_TEXT` with a 21-character ASCII memo, so the ceiling is not in
play for generated invoices. It matters because the memo is the only thing that
attributes a payment to an invoice: a memo the wallet will not attach is a
payment that can never be verified. Two rules protect that, and both are gaps in
the formatter today — see [VERIFY-IDEMPOTENCY.md](./VERIFY-IDEMPOTENCY.md) for the
uniqueness side.

## The fixtures, and what a wallet does with each

Every "what the wallet does" cell below is derived from a refusal that
`@stellar/stellar-sdk` already makes — the same library a wallet builds the
payment with — and every one of those refusals is asserted in the conformance
suite. None of them was produced by running a wallet: see the manual checks at
the end for what that leaves open.

| # | Case | Emitted today | Wallet outcome | Change? |
| --- | --- | --- | --- | --- |
| 1 | Native XLM, no memo | `?destination=G...&amount=25` | pays — absent `asset_code` means native | no |
| 2 | The invoice memo | `...&memo=INV-LX7Q9A3B-KM2P8NQR&memo_type=MEMO_TEXT` | pays | no |
| 3 | USDC with issuer, 7 decimals | `...&asset_code=USDC&asset_issuer=G...` | pays **only if** the payer has the trustline; the URI cannot express "add it first" | no |
| 4 | One stroop | `amount=0.0000001` | pays | no |
| 5 | Memo at 28 bytes | full memo | pays — the ceiling is inclusive | no |
| 6 | Amount with 8 decimals | `amount=1.12345678` | **fails**: `Operation.payment` refuses more than 7 decimals | yes — gap 1 |
| 7 | Memo at 32 bytes | full memo | **fails**: `Memo.text` refuses past 28 bytes | yes — gap 2 |
| 8 | Non-ASCII memo, 30 bytes | percent-encoded, full memo | **fails** for the same byte reason; percent-encoding also makes the URI look longer than the memo | yes — gap 3 |
| 9 | XLM with an issuer | `?destination=...&amount=25` — issuer dropped | pays, but as a **native** payment: the issuer the caller supplied is gone, and nothing says so | yes — gap 5 |
| 10 | A valid `M...` destination | — | **refused before a QR is built**, though SEP-0007 accepts payment addresses | yes — gap 4 |
| 11 | Credit asset with no issuer | — | refused with a message naming the code | no |
| 12 | Amount `1e3` | — | refused | no |

## Recommendation

In priority order, each one small and each one already pinned by a fixture so the
diff shows in the suite:

1. **Byte-count the memo and refuse over 28 bytes** (gaps 2, 3). Name the ceiling
   in the message; the current failure surfaces only after a payer has scanned
   and committed to paying.
2. **Refuse amounts with more than seven decimals** (gap 1). The same rule belongs
   at invoice creation, which currently accepts any number up to `1e9` — a second
   invoice that can never be paid exactly, which is issue #378's territory.
3. **Throw for a native code carrying an issuer** (gap 5), mirroring the
   `createInvoiceSchema` refinement that already refuses it. Silently dropping an
   issuer is the one gap where the URI succeeds and the money goes somewhere the
   caller did not describe.
4. **Resolve the destination with `StrKey`** (gap 4) so a valid muxed payment
   address can be paid by QR, as SEP-0007 allows.
5. Optionally emit `msg` with the invoice description, so a wallet can show the
   payer what the payment is for. No behaviour depends on it.

## Manual checks before changing the formatter

The five gaps rest on protocol refusals, which is the right authority, but a
formatter change should not ship on that alone. With testnet funds:

1. Freighter on testnet: scan case 1, then case 3 against a wallet with no USDC
   trustline, then case 6.
2. LOBSTR: the same three.
3. xBull: case 10, to find out which wallets already accept `M...` destinations
   (if one does, gap 4 is a compatibility question rather than a blocker).

Record wallet, version and outcome in the follow-up PR.

## Files

| File | What it holds |
| --- | --- |
| `backend/tests/fixtures/payment-uri-cases.fixture.ts` | the 12 cases: input, emitted output, status, follow-up |
| `backend/tests/payment-uri-conformance.test.ts` | pins the emitted output; proves each gap with the SDK; keeps the gap list deliberate |
| `backend/src/utils/qr-payment-payload.ts` | the formatter, unchanged by this issue |

