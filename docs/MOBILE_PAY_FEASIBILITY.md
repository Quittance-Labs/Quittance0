# Freighter Mobile Pay Feasibility Analysis

## Executive Summary

This document details the feasibility of using the Freighter wallet extension and deep links to sign Quittance invoice payments on mobile devices.

Freighter is strictly a desktop browser extension distributed via the Chrome Web Store and Firefox Add-ons repository. It does not provide a standalone native iOS or Android mobile application, does not register a custom mobile URI scheme (`freighter://`), and cannot execute in-app transaction signing within mobile browsers or embedded WebViews.

Prompting mobile users to install a desktop extension or forcing authentication (such as Google OAuth) to view payment details creates a broken user experience. This document outlines the technical constraints across platforms, evaluates deep-link protocols, and specifies an honest, non-custodial three-tier fallback UX that operates entirely on-chain without requiring user authentication.

---

## Device and Browser Matrix

The following matrix categorizes browser environments, extension capabilities, protocol handling, and payment viability:

| Device / Environment | Browser / Shell | Extension Support | Deep Link Handling | Viable Payment Mode | Technical Limitations |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **iOS Mobile** | Safari (WebKit) | None (Freighter unavailable) | Handles `web+stellar:` if external Stellar wallet is registered | Fallback Tier 1, 2, 3 | WebKit extensions on iOS do not include Freighter. Web extensions cannot inject Freighter window provider. |
| **iOS Mobile** | Chrome / Brave | None | OS routes registered URL schemes to native apps | Fallback Tier 1, 2, 3 | iOS third-party browsers use WebKit under the hood and cannot load desktop Chromium extensions. |
| **iPadOS** | Safari (Desktop UA) | None (Freighter unavailable) | Handles `web+stellar:` if external Stellar wallet is registered | Fallback Tier 1, 2, 3 | Reports desktop Safari user agent with touch points. Cannot run desktop extension. |
| **Android Mobile** | Chrome | None | Handles `web+stellar:` via Android Intent filter | Fallback Tier 1, 2, 3 | Mobile Chrome explicitly disables extensions. |
| **Android Mobile** | Firefox | Limited (Freighter unapproved) | Handles `web+stellar:` via Android Intent filter | Fallback Tier 1, 2, 3 | Mobile Firefox supports only an approved curated list of add-ons; Freighter is not included. |
| **Android Mobile** | Kiwi / Kiwi-derivatives | Experimental / Sideloaded | Inconsistent | Fallback Tier 1, 2, 3 | Sideloaded desktop extensions lack persistent background scripts on mobile OS lifecycle. |
| **In-App WebViews** | Twitter / X, Telegram, Slack | None (Sandboxed WebViews) | Often blocks custom URL schemes or intent redirects | Fallback Tier 2, 3 | In-app browsers isolate cookies, strip protocol handlers, and block extension injection entirely. |
| **Desktop** | Chrome, Brave, Edge | Full (Chrome Web Store) | N/A (Extension directly injects `@stellar/freighter-api`) | Native One-Click | Supported baseline. Injects `window.freighter`. |
| **Desktop** | Firefox | Full (Firefox Add-ons) | N/A (Extension directly injects `@stellar/freighter-api`) | Native One-Click | Supported baseline. Injects `window.freighter`. |

---

## Deep-Link Protocol Evaluation

### Freighter Extension vs Native Wallet Protocols

Freighter operates through a browser extension content script injecting `window.freighter` into document contexts. 

1. **Absence of Native URL Scheme:**
   Freighter has not registered a custom URL scheme (such as `freighter://`) or universal links (`https://freighter.app/...`) for transaction signing on mobile operating systems.
2. **Absence of In-App Wallet Signing:**
   Because Freighter is not an installed native binary on mobile devices, mobile browsers cannot invoke Freighter to sign Soroban or classic Stellar transactions.
3. **SEP-0007 Standards Compliance:**
   The Stellar ecosystem defines **SEP-0007** (`web+stellar:pay`) for standardized URI-based transaction requests. Mobile Stellar wallets (such as LOBSTR and xBull) register handlers for `web+stellar:pay`. Freighter does not register as a handler for this protocol on mobile devices.

### Deep-Link Scheme Comparison

| Protocol Scheme | Implementation in Quittance | Mobile Browser Support | Target Consumer |
| :--- | :--- | :--- | :--- |
| `freighter://` | Evaluated / Unsupported | Inoperable (No native app registered) | None |
| `web+stellar:pay` | Implemented (Tier 1 Fallback) | Supported via OS protocol registry and native apps | LOBSTR, xBull, Solar |
| HTTPS Link Handoff | Implemented (Tier 3 Fallback) | Fully supported on all mobile browsers | Desktop browser with Freighter |

---

## Non-Custodial Fallback Architecture

### Design Principles

1. **Zero Authentication Barrier:**
   Payment links must remain completely accessible without mandatory account registration or Google OAuth login. The payer simply fulfills a Stellar ledger transaction.
2. **No Deceptive Prompts:**
   The interface must never prompt a mobile visitor to install a desktop browser extension.
3. **Deterministic Ledger Settlement:**
   Regardless of the submission method (mobile wallet, manual exchange transfer, or desktop handoff), the backend verification engine tracks payment completion identically via the unique invoice memo.

### The Three-Tier Fallback UX

```
                 +-----------------------------------+
                 |    Mobile Device Visits Pay Link  |
                 +-----------------+-----------------+
                                   |
                Detects Mobile Browser Environment
                                   |
                 +-----------------v-----------------+
                 |  Render MobilePaymentFallback UI  |
                 +-----------------+-----------------+
                                   |
         +-------------------------+-------------------------+
         |                                                   |
+--------v--------+                       +------------------v------------------+
|  Tier 1: SEP-07 |                       |   Tier 2: Manual On-Chain Details   |
|  Mobile Wallet  |                       |  - Copy Destination Public Key      |
|  - Deep-link    |                       |  - Copy Exact Memo (Strict Warning) |
|  - QR code scan |                       |  - Copy Exact Amount & Asset        |
+-----------------+                       +-------------------------------------+
         |                                                   |
         +-------------------------+-------------------------+
                                   |
                 +-----------------v-----------------+
                 |       Tier 3: Desktop Handoff     |
                 |  - One-click copy of pay link URL |
                 |  - Open on desktop with Freighter |
                 +-----------------+-----------------+
                                   |
             Ledger Monitoring Detects Transaction
                                   |
                 +-----------------v-----------------+
                 |  Display Verified Payment Receipt |
                 +-----------------------------------+
```

#### Tier 1: Pay with Mobile Wallet (SEP-0007)
* Provides a standards-compliant `web+stellar:pay` deep link and rendered QR code.
* If the user has a mobile Stellar wallet installed, tapping the deep link transfers the transaction parameters directly into the wallet for signing.
* Supported parameters: `destination`, `amount`, `asset_code`, `asset_issuer`, `memo`, `memo_type`.

#### Tier 2: Manual Transfer Details (Exchange & Any Wallet)
* Displays atomic copy-to-clipboard blocks for:
  - **Destination Public Key**
  - **Invoice Memo**
  - **Payment Amount & Asset**
* Features a prominent warning: "Always include the exact memo. Verification will fail without it."
* Enables payers to send funds from centralized exchanges (Coinbase, Binance, Kraken) or any wallet software without protocol handler support.

#### Tier 3: Desktop Handoff
* Provides a one-click copy button for the invoice URL.
* Instructs the user to open the URL in a desktop browser equipped with the Freighter extension for native one-click signing.

---

## Return and Resume Contract

Signing in a mobile wallet leaves the browser; when the wallet returns the
payer, `/pay/[id]` remounts with no in-memory state. The page supports exactly
one return contract:

```text
<origin>/pay/<invoiceId>?tx=<64-hex transaction hash>
```

- **`tx` is validated, never trusted.** It must satisfy the same
  `checkTxHash` rule as a pasted hash before the page starts verification.
  A malformed `tx` is ignored, not surfaced as an error.
- **Same-origin `/pay/` only.** `return_url`, `callback`, `redirect` and
  `redirect_uri` parameters pointing at any other origin — or any path that
  is not `/pay/<id>` — are refused. The pay page never navigates to a
  caller-supplied return target, so it cannot be turned into an open
  redirect.
- **SEP-0007 callback.** The `web+stellar:pay` deep link carries
  `callback=url:<origin>/pay/<invoiceId>`, built by `buildPayCallbackUrl`
  from the page's own origin — never from request input. Wallets that honour
  SEP-0007 callbacks bring the payer back to the same invoice page.
- **Non-secret resume.** The pay session persists only `{ invoiceId, txHash }`
  in `sessionStorage` (per-tab, cleared when the tab closes) — mirroring the
  invoice-draft rules. A transaction hash is public ledger data; no public
  keys, signatures or wallet tokens are stored. On return without a `?tx=`,
  a stored hash for *this* invoice is restored into the verify input with a
  resume note; the payer still confirms verification themselves.
- **Live regions.** The resumed verification drives the same
  `#payment-result` live region as a manual verify, so the state transition
  is announced to assistive technology.

---

## User-Facing Copy Specification

All customer-facing copy is frozen and centralized in `frontend/lib/mobile-fallback-copy.ts` to prevent UI drift and maintain tone standards:

| Key | Text Content |
| :--- | :--- |
| `badge` | `Mobile Device Detected` |
| `headline` | `Freighter is a desktop extension` |
| `description` | `Mobile browsers cannot run the Freighter extension to sign transactions directly. Use one of the fallback options below to complete payment.` |
| `noAuthNote` | `No account or Google login required. Payment verifies directly on the Stellar ledger.` |
| `options.mobileWallet.title` | `Pay with Mobile Wallet` |
| `options.mobileWallet.description` | `Scan the SEP-0007 QR code using a Stellar mobile wallet like LOBSTR or xBull, or tap the button if your wallet supports Stellar deep links.` |
| `options.mobileWallet.cta` | `Open in Stellar Wallet` |
| `options.manualTransfer.title` | `Copy Payment Details` |
| `options.manualTransfer.description` | `Transfer the exact amount from any Stellar wallet or exchange. The memo is required for automatic payment verification.` |
| `options.manualTransfer.memoWarning` | `Always include the exact memo. Verification will fail without it.` |
| `options.desktopHandoff.title` | `Open on Desktop` |
| `options.desktopHandoff.description` | `Copy this payment link and open it in a desktop browser with Freighter installed to sign with one click.` |
| `options.desktopHandoff.cta` | `Copy Payment Link` |
| `unsupportedNotice` | `Freighter does not currently support mobile apps, mobile in-app browsers, or custom deep-link transaction signing.` |

---

## Unsupported Scenarios Catalog

The following scenarios are technically impossible with the current Freighter extension architecture and must remain categorized as unsupported:

1. **In-App Mobile Browser Extension Execution:**
   Mobile Safari (iOS) and Mobile Chrome (Android) do not support the desktop Chromium extension APIs needed to run Freighter.
2. **Custom URL Scheme Interception by Freighter:**
   Freighter does not register or handle `freighter://` on mobile OSs.
3. **In-App Social Media WebViews:**
   Social platforms (Twitter, Telegram, Instagram) launch web links in sandboxed WebViews that strip external protocol handlers and isolate local storage.
4. **Autonomous Soroban Invocation on Mobile via Freighter:**
   Soroban smart contract signing requires an active signer. On mobile, this must be executed through a mobile-native wallet supporting SEP-0007 or WalletConnect, not Freighter.
5. **Mobile Assistive Technology & Focus Retention during App Handoff:**
   When a user activates a SEP-0007 link (`web+stellar:pay`) or switches to a native mobile wallet app (e.g. LOBSTR or xBull) on iOS or Android, the browser yields operating system focus. Upon returning to the browser:
   - Operating system screen readers (iOS VoiceOver / Android TalkBack) restore focus to the browser window or document body rather than the trigger button.
   - Screen reader users on mobile rely on persistent live regions (`role="status"`, `aria-live="polite"`) and manual verification hash inputs with explicit visible labels rather than automated focus hijacking.
