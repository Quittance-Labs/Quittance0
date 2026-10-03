# Payment URIs and QR payloads

Issue #382. This covers the `web+stellar:pay` URI that invoice creation returns as
`stellarQrCode`: how each field maps to [SEP-0007](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md),
where the emitted URI can be something a wallet refuses, and what to change in
the formatter. The executable half lives in
[`tests/payment-uri-conformance.test.ts`](../backend/tests/payment-uri-conformance.test.ts)
and `tests/fixtures/payment-uri-cases.fixture.ts`.

## Where the URI comes from

`POST /api/invoices` (and `GET .../payment-info`) returns one **pay-link artifact**
(issue #557). Create, the pay page, and the seller invoice page all render that
same artifact — they never rebuild the URI.

| Response field | Content | Who reads it |
| --- | --- | --- |
| `paymentUrl` | the pay page URL, `{frontendUrl}/pay/{id}` | any camera app / share sheet |
| `stellarUri` | the SEP-0007 URI below | a Stellar wallet (copy / open) |
| `stellarQrCode` | PNG of whatever the QR decided to encode | phone camera |
| `stellarQrEncodesUri` | `true` when the image is the SEP-0007 URI; `false` when it fell back to `paymentUrl` | UI copy |
| `copyValue` | the string the QR encoded — same value create / pay / seller copy use | clipboard |
| `networkPassphrase` | from the same resolver explorer links use | wallets / UI |
| `qrCode` | a second PNG that always encodes `paymentUrl` | any camera app |

`buildPayLinkArtifact` → `generateStellarPaymentQR` → `formatQrPaymentPayload`
→ `QRCode.toDataURL`. The formatter is pure and does no QR work;
`generateStellarPaymentQR` encodes with error correction level H. Amount goes
through the stroop helper before the URI is built, so `0.0000001` never becomes
`1e-7`.

## Field-by-field mapping

| Parameter | What we emit | SEP-0007 says | Verdict |
| --- | --- | --- | --- |
| scheme | `web+stellar:pay?` | `web+stellar:<operation>?<params>`, `pay` operation | conformant |
| `destination` | the seller's `G...` key | required: "a valid account ID **or payment address**" | G-addresses only — a valid `M...` payment address is refused (gap 4) |
| `amount` | canonical 7-decimal stroop string (`formatStroops` of the parsed input) | optional; Stellar amounts carry at most 7 decimals | conformant — 8+ decimals are refused before the URI is built |
| `asset_code` | only for non-native assets | optional, "XLM if not present" | conformant; an XLM-labelled credit asset loses its issuer silently (gap 5) |
| `asset_issuer` | with `asset_code` | optional, same rule | conformant |
| `memo` | the invoice memo, `INV-<ms>-<8>`, 21 chars | optional; `MEMO_TEXT` must be URL-encoded (`MEMO_HASH`/`MEMO_RETURN` are base64 **then** URL-encoded) | conformant — the formatter refuses memos over 28 UTF-8 bytes |
| `memo_type` | `MEMO_TEXT` | one of `MEMO_TEXT`, `MEMO_ID`, `MEMO_HASH`, `MEMO_RETURN` | conformant |
| `network_passphrase` | Testnet passphrase when `network=TESTNET`; omitted on PUBLIC | optional; required away from public | conformant — resolved via `shared/network.ts` |
| `msg` | not emitted | optional, shown to the payer for context | not required; the pay page carries the context instead |
| encoding | `encodeURIComponent` per value | URL-encoded | conformant |

**`network_passphrase`.** SEP-0007 assumes the public network when the param is
absent, and requires it away from public. The formatter takes the invoice
`network` enum (`TESTNET` | `PUBLIC`) and resolves the passphrase through
`shared/network.ts` — the same table explorer links use (issue #511). TESTNET
URIs append the URL-encoded Testnet passphrase; PUBLIC omits the param. A
caller-supplied passphrase hint that disagrees with the resolved network is
refused before the URI is built. Adding ~70 bytes for the Testnet passphrase
pushes a typical XLM+memo URI over the QR budget, so the image falls back to
the HTTPS pay link while `stellarUri` and `copyValue` still carry the full
string (or the HTTPS link, respectively).

## Memo types and limits

| Type | Encoding in the URI | Limit | Authority |
| --- | --- | --- | --- |
| `MEMO_TEXT` | plain, URL-encoded | 28 **bytes** | `Memo.text` throws past 28 bytes, and counts bytes: `'☕'.repeat(10)` is 10 characters and 30 bytes |
| `MEMO_ID` | plain | 64-bit unsigned integer | |
| `MEMO_HASH`, `MEMO_RETURN` | base64, then URL-encoded | 32 bytes | SEP-0007 §pay |

We emit `MEMO_TEXT` with a 21-character ASCII memo, so the ceiling is not in
play for generated invoices. It matters because the memo is the only thing that
attributes a payment to an invoice: a memo the wallet will not attach is a
payment that can never be verified. The formatter now enforces the 28-byte cap
itself, counting UTF-8 bytes rather than characters — see
[VERIFY-IDEMPOTENCY.md](./VERIFY-IDEMPOTENCY.md) for the uniqueness side.

## The fixtures, and what a wallet does with each

Every "what the wallet does" cell below is derived from a refusal that
`@stellar/stellar-sdk` already makes — the same library a wallet builds the
payment with — and every one of those refusals is asserted in the conformance
suite. None of them was produced by running a wallet: see the manual checks at
the end for what that leaves open.

| # | Case | Emitted today | Wallet outcome | Change? |
| --- | --- | --- | --- | --- |
| 1 | Native XLM, no memo | `?destination=G...&amount=25.0000000` | pays — absent `asset_code` means native | no |
| 2 | The invoice memo | `...&memo=INV-LX7Q9A3B-KM2P8NQR&memo_type=MEMO_TEXT` | pays | no |
| 3 | USDC with issuer, 7 decimals | `...&asset_code=USDC&asset_issuer=G...` | pays **only if** the payer has the trustline; the URI cannot express "add it first" | no |
| 4 | One stroop | `amount=0.0000001` | pays | no |
| 5 | Memo at 28 bytes | full memo | pays — the ceiling is inclusive | no |
| 6 | Amount with 8 decimals | — | **refused by the formatter** with a message naming the 7-decimal ceiling | no — closed |
| 7 | Memo at 32 bytes | — | **refused by the formatter**: `Memo.text` refuses past 28 bytes | no — closed |
| 8 | Non-ASCII memo, 30 bytes | — | **refused by the formatter** on the byte count, not the character count | no — closed |
| 9 | XLM with an issuer | `?destination=...&amount=25` — issuer dropped | pays, but as a **native** payment: the issuer the caller supplied is gone, and nothing says so | yes — gap 5 |
| 10 | A valid `M...` destination | — | **refused before a QR is built**, though SEP-0007 accepts payment addresses | yes — gap 4 |
| 11 | Credit asset with no issuer | — | refused with a message naming the code | no |
| 12 | Amount `1e3` | — | refused | no |

## Recommendation

In priority order, each one small and each one already pinned by a fixture so the
diff shows in the suite. The memo byte-cap (former gaps 2, 3) is done: the
formatter refuses a memo over 28 UTF-8 bytes and names the ceiling in the
message.

1. ~~Refuse amounts with more than seven decimals~~ — **done**: the formatter
   throws past seven decimals and emits the canonical stroop string. The same
   rule could still be applied earlier, at invoice creation, which accepts any
   number up to `1e9` — issue #378's territory.
2. **Throw for a native code carrying an issuer** (gap 5), mirroring the
   `createInvoiceSchema` refinement that already refuses it. Silently dropping an
   issuer is the one gap where the URI succeeds and the money goes somewhere the
   caller did not describe.
3. **Resolve the destination with `StrKey`** (gap 4) so a valid muxed payment
   address can be paid by QR, as SEP-0007 allows.
4. Optionally emit `msg` with the invoice description, so a wallet can show the
   payer what the payment is for. No behaviour depends on it.

## Manual checks before changing the formatter

The remaining gaps rest on protocol refusals, which is the right authority, but a
formatter change should not ship on that alone. With testnet funds:

1. Freighter on testnet: scan case 1, then case 3 against a wallet with no USDC
   trustline, then case 7.
2. LOBSTR: the same three.
3. xBull: case 10, to find out which wallets already accept `M...` destinations
   (if one does, gap 4 is a compatibility question rather than a blocker).

Record wallet, version and outcome in the follow-up PR.

## Files

| File | What it holds |
| --- | --- |
| `backend/tests/fixtures/payment-uri-cases.fixture.ts` | the 12 cases: input, emitted output, status, follow-up |
| `backend/tests/payment-uri-conformance.test.ts` | pins the emitted output; proves each gap with the SDK; keeps the gap list deliberate |
| `backend/src/utils/qr-payment-payload.ts` | the formatter; enforces the 28-byte memo cap and network passphrase |
| `backend/src/utils/pay-link-artifact.ts` | one artifact: pay URL, SEP-0007 URI, QR data URL, copy value, fallback flag |
| `backend/tests/pay-link-artifact.test.ts` | pins the artifact strings and the one-stroop / memo / budget rules |

