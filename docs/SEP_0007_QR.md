# SEP-0007 payment URI and QR review

## Recommendation

Keep the web+stellar:pay operation and deterministic parameter order. In a
follow-up implementation, add the invoice network passphrase and reject text
memos longer than 28 UTF-8 bytes before QR generation. Keep amount mandatory
for Quittance even though SEP-0007 makes it optional for donation requests.

Do not claim Freighter compatibility until the vectors below are exercised
against a named Freighter release. Its public documentation and repository do
not currently state that it registers as a web+stellar protocol handler. The
URI is standards-compliant input for SEP-0007 wallets; Quittance's own
Freighter payment button remains the reliable browser-extension path.

Primary references:

- SEP-0007: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
- Stellar memo limits: https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions

## Current field map

| Order | Current field | SEP-0007 pay rule | Finding |
| --- | --- | --- | --- |
| 1 | destination | required account ID or payment address | correct; SDK validates G-address checksum |
| 2 | amount | optional in SEP-7 | correctly mandatory for a fixed-price invoice |
| 3 | asset_code | optional; XLM when absent | correct; omitted for native XLM |
| 4 | asset_issuer | identifies an issued asset | correct when present; missing issuer is rejected |
| 5 | memo | optional on-chain memo | encoded correctly, but byte limit is unchecked |
| 6 | memo_type | one of four SEP-7 memo types | correctly emits MEMO_TEXT |
| — | callback | optional | intentionally omitted; wallet submits |
| — | msg | optional, 300 characters maximum | intentionally omitted |
| — | network_passphrase | required away from public network | gap for Testnet invoices |
| — | origin_domain and signature | optional trust signal as a pair | omitted; acceptable for MVP, add together later |

The QR encoder correctly stores the complete URI as its payload. QR error
correction does not change URI semantics.

## Payload budget (issue #510)

A dense QR fails on phone cameras even when the URI is spec-valid. The pay
page renders the code at ~220px, so the encoder enforces a budget: the URI
must fit **QR version 12 at error-correction level H** (~175 byte-mode bytes).
The rule lives in `backend/src/utils/qr-budget.ts` and is measured with the
same `qrcode` build that renders the image, so the check cannot drift from the
encoder.

Measured vectors (EC level H):

| Payload | URI bytes | QR version | Result |
| --- | --- | --- | --- |
| XLM, no memo | ~96 | 8 | encoded |
| XLM + invoice memo | ~143 | 12 | encoded |
| USDC + issuer + memo | ~229 | 15+ | over budget |

When a URI exceeds the budget the QR encodes the short HTTPS `/pay/[id]` link
instead — never a truncated memo or a dropped asset issuer. The response still
returns the complete SEP-0007 string as `stellarUri`, plus
`stellarQrEncodesUri: false` so the pay page can relabel the copy row; the
payer keeps copy / open-in-wallet access to the full URI.

## Memo limits

MEMO_TEXT is at most 28 bytes of UTF-8. JavaScript string length is not a valid
check because one emoji commonly occupies four bytes. The formatter should use
Buffer.byteLength(memo, 'utf8') on the backend. The generated invoice memo
should remain short ASCII so the same value can be compared with Horizon
without normalization.

Quittance should continue emitting memo_type=MEMO_TEXT. Switching an existing
invoice to MEMO_ID or a hash memo would change the on-chain matching contract
and is outside this review.

## Network behavior

SEP-0007 assumes the public network when network_passphrase is absent.
Quittance supports Testnet, so a Testnet QR should include this URL-encoded
value:

Test SDF Network ; September 2015

The formatter API should accept the invoice's canonical network enum and map it
internally to the passphrase. It should not accept an arbitrary caller-provided
passphrase. A conflicting hint must fail before QR creation.

## XLM and issued assets

For native XLM, omit asset_code and asset_issuer. This is the most widely
portable SEP-0007 form.

For USDC or another issued asset, include both code and issuer. The wallet may
fund the payment with another source asset through a path payment, but the
seller must receive the exact destination asset and amount. A wallet without
the asset or a route should show a payment failure; Quittance must not fall back
to an unpinned asset with the same code.

## Locked vectors

The machine-readable fixtures live in
backend/tests/fixtures/sep-0007-wallet.fixture.ts and are exercised by
backend/tests/sep-0007-wallet-vectors.test.ts.

| Vector | Recommended | Current | Wallet note |
| --- | --- | --- | --- |
| Native XLM, public network | accept | accept | XLM is implied |
| Issued USDC with issuer | accept | accept | destination receives exact asset |
| 28-byte ASCII memo | accept | accept | maximum valid MEMO_TEXT |
| 29-byte ASCII memo | reject | gap | wallet cannot build valid memo |
| Eight emoji, 32 UTF-8 bytes | reject | gap | byte count exceeds limit |
| Missing amount | reject | reject | product rule, although donations may omit it |
| Testnet passphrase | accept | gap | prevents accidental public-network interpretation |
| Public hint on Testnet invoice | reject | gap | network conflict |
| Issued asset without issuer | reject | reject | asset identity is incomplete |

A wallet verification pass should record wallet name/version, operating system,
scan versus click entry, displayed destination, amount, asset, memo, selected
network, and whether submission was offered. A pass means all displayed fields
match the vector before signing; no test needs a secret key or live payment.

## Follow-up formatter change

The implementation PR should:

1. Add network to QrPaymentPayloadInput using the existing TESTNET/PUBLIC enum.
2. Append network_passphrase for Testnet and omit it for public.
3. reject a memo above 28 UTF-8 bytes with a stable error;
4. keep deterministic encoding and current native/issued asset shapes;
5. move the gap vectors into ordinary pass/fail formatter cases;
6. decode each generated QR in a test and compare the exact URI;
7. run the wallet matrix and record supported Freighter behavior without
   assuming protocol-handler support.

origin_domain must only be added together with a valid SEP-0007 signature and a
published URI_REQUEST_SIGNING_KEY. Adding an unsigned domain would make a
compliant wallet reject the request.
