# Design proposal — Quittance-Labs/Quittance0#19
## "Hide QR and Pay controls on EXPIRED invoices only" (egekoca, FWC26)

> Author: @dorisadams (proposed via comment-only design-proposal path).
> Pinging @egekoca (assignee) for design feedback — happy to iterate.

## Goal

Make the QR + Pay controls hide whenever the invoice status is **EXPIRED**.
The contract should be:

> Show QR + Pay controls **iff** `invoice.status === 'PENDING'`.
> Hide on EXPIRED, PAID, CANCELLED, and any future status.

## Current behavior (already mostly correct, defensively-tighten)

The `=== 'PENDING'` gate is already in place in three places:

- `frontend/app/invoice/[id]/page.tsx` — QR + "Go to Payment Page" link section.
- `frontend/app/pay/[id]/page.tsx` — QRCodeDisplay + PaymentButton block.
- `frontend/components/InvoiceCard.tsx` — dashboard "Copy link" button.

What's missing:

1. **No central contract.** Three sites hard-code `=== 'PENDING'` Stringly. A backend adding a new status (e.g., `REJECTED`) would silently show payment controls unless every site is patched.
2. **No explicit EXPIRED guard in the components themselves.** If a future caller forgets to gate, the QR + Pay would render inappropriately.
3. **No unit test covering all four status states.** The matrix is implicit, not asserted.

## Proposal — three small changes

### 1. Add a helper `interactiveStatus` in `lib/utils.ts`

```diff
--- a/frontend/lib/utils.ts
+++ b/frontend/lib/utils.ts
@@ exports @@
 export function getStatusColor(status: string): string {
   switch (status) {
     case 'PENDING':    return 'bg-yellow-100 text-yellow-800';
     case 'PAID':       return 'bg-green-100 text-green-800';
     case 'EXPIRED':    return 'bg-red-100 text-red-800';
     case 'CANCELLED':  return 'bg-gray-100 text-gray-800';
     default:           return 'bg-gray-100 text-gray-800';
   }
 }

 export function getTimeRemaining(expiresAt: string): string {
   // ... existing
 }

+/**
+ * Returns true if interactive payment controls (QR, Pay button, copy link)
+ * should be rendered for the given invoice status.
+ *
+ * Contract: show iff status === 'PENDING'. This is the single source of
+ * truth for #19 ("Hide QR and Pay controls on EXPIRED invoices only").
+ *
+ * The parameter is typed as `string` (not the union) to fit the existing
+ * component interfaces — `InvoiceCard` declares `status: string`, and the
+ * two page components cast through `any`. Tightening this to
+ * `status: InvoiceStatus` is a follow-up that touches each call site
+ * (interface + state shape) and is out of scope for #19.
+ *
+ * Unknown statuses default to `false` (hide) as a safe fallback in case a
+ * future backend enum value slips through before the union is updated.
+ * The `InvoiceStatus` union is exported for documentation and IDE
+ * hover-hint at call sites — see the future-PR notes in §3 for the
+ * shape of the unit test you'd want once a test runner is wired up.
+ */
+export type InvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
+export function interactiveStatus(status: string): boolean {
+  return status === 'PENDING';
+}
```

### 2. Replace the three hard-coded `=== 'PENDING'` sites with the helper

```diff
--- a/frontend/app/invoice/[id]/page.tsx
+++ b/frontend/app/invoice/[id]/page.tsx
@@ import @@
-import { formatAmount, formatDate, getTimeRemaining, getShareUrl } from '@/lib/utils';
+import { formatAmount, formatDate, getTimeRemaining, getShareUrl, interactiveStatus } from '@/lib/utils';
@@ QR block @@
-              {invoice.status === 'PENDING' && paymentInfo && (
+              {interactiveStatus(invoice.status) && paymentInfo && (
                 <div className="card">
                   <h3 className="text-lg font-semibold mb-4 text-center">
                     Payment QR Code
                   </h3>
                   <QRCodeDisplay
                     value={paymentInfo.paymentUrl}
                     size={200}
                     showCopy={true}
                   />
                   <Link
                     href={`/pay/${invoice.id}`}
                     className="btn btn-primary w-full mt-4"
                   >
                     Go to Payment Page
                   </Link>
                 </div>
-              )}
+              )}
```

```diff
--- a/frontend/app/pay/[id]/page.tsx
+++ b/frontend/app/pay/[id]/page.tsx
@@ import @@
-import { formatAmount, formatDate, getTimeRemaining, copyToClipboard } from '@/lib/utils';
+import { formatAmount, formatDate, getTimeRemaining, copyToClipboard, interactiveStatus } from '@/lib/utils';
@@ QR + Pay block @@
-            {invoice.status === 'PENDING' && !invoice.paymentTxHash && (
+            {interactiveStatus(invoice.status) && !invoice.paymentTxHash && (
               <>
                 <div className="card">
                   <h3 className="text-lg font-semibold text-center mb-4">Scan QR Code</h3>
                   <QRCodeDisplay .../>
                   ...
                 </div>
                 ...
                 <PaymentButton .../>
                 ...
               </>
-            )}
+            )}
```

`InvoiceCard.tsx` already gates Copy-link on `=== 'PENDING'` — refactor for DRY:

```diff
--- a/frontend/components/InvoiceCard.tsx
+++ b/frontend/components/InvoiceCard.tsx
-import { formatAmount, formatDate, getStatusColor, getTimeRemaining } from '@/lib/utils';
+import { formatAmount, formatDate, getStatusColor, getTimeRemaining, interactiveStatus } from '@/lib/utils';
@@ Copy link button @@
-        {invoice.status === 'PENDING' && (
+        {interactiveStatus(invoice.status) && (
           <button
             onClick={handleCopyLink}
             className="btn btn-secondary flex items-center justify-center gap-2 px-3"
             ...
           />
         )}
```

### 3. Manual smoke-test matrix (and target-shaped unit tests)

The frontend currently has no Jest/Vitest config (`frontend/package.json` has no `test`
script, no test-framework dep, no `*.test.ts(x)` files). Adding a test setup is out of
scope for this PR — but here's the matrix this PR should land with, written as
manual procedure:

| status    | show QR + Pay controls? | where to verify |
|-----------|------------------------|-----------------|
| PENDING   | YES                    | `/invoice/<id>` (right card), `/pay/<id>` (QR + Pay button + manual-verify input) |
| EXPIRED   | **NO**                 | `/invoice/<id>` (PaymentStatus shows red X "Invoice Expired"; no QR card); `/pay/<id>` shows "Payment Expired" card with no QR / Pay button |
| PAID      | NO (Download Proof + Email Proof instead) | `/invoice/<id>` (Download Proof instead of Pay); `/pay/<id>` (PaymentReceipt instead of Pay) |
| CANCELLED | NO                     | Same as EXPIRED — PaymentStatus shows "Invoice Cancelled" with no controls |

**Manual reproduction steps** (for the maintainer to verify before merge):

```bash
# 1. Create or seed an EXPIRED invoice (any unpaid invoice whose expiresAt has passed).
# 2. As seller, navigate to /invoice/<id>  -- expect: PaymentStatus with red X icon,
#    no "Payment QR Code" card, no "Go to Payment Page" link.
# 3. As payer, navigate to /pay/<id>       -- expect: red X "Payment Expired" card,
#    no QRCodeDisplay, no PaymentButton, no manual-verify input.
# Repeat with PAID, CANCELLED, PENDING (timer still ticking) — confirmed working today.
```

**For the future "add Jest to frontend" PR** (separate work; out of scope here) — once a
test runner is wired up, the matrix lands as a `*.test.ts` for `interactiveStatus`:

```ts
import { interactiveStatus, getStatusColor, type InvoiceStatus } from './utils';

describe('interactiveStatus (#19 contract)', () => {
  it.each<[InvoiceStatus, boolean]>([
    ['PENDING',     true],
    ['EXPIRED',     false],
    ['PAID',        false],
    ['CANCELLED',   false],
  ])('%s should show controls = %s', (status, expected) => {
    expect(interactiveStatus(status)).toBe(expected);
  });
});

// Note: v3's `status: string` parameter accepts unknown statuses silently
// (default `false` at runtime). Tightening the helper param to `InvoiceStatus`
// — and updating the `Invoice` interface + the two page components' state
// shapes — is the proper follow-up. Out of scope for #19.
```

## Out of scope (deliberate)

- **No backend changes.** Issue #19 is frontend-only. The backend `markExpiredInvoices()` sweep in #11 (parked in this repo) is the eventual source of truth for the EXPIRED transition. This proposal doesn't require it; it just defends against any future status drift.
- **No Jest / Vitest setup.** Frontend currently has no test framework. Adding one is a separate, larger PR that's out of scope here. The manual smoke-test matrix above is the immediate assertion layer.
- **No e2e Playwright test.** Same reasoning.
- **No styling changes.** The "Payment Expired" payoff card on `/pay/[id]` already renders cleanly when status flips to EXPIRED — that's a separate UX question (#20+ if anyone flags it).
- **PaymentButton component itself stays status-agnostic.** Parent gating remains the source of truth.

## Risk assessment

- **Low.** Helper is a clean String->boolean wrapper. All three call sites had the same intent already; the helper makes it DRY + defensible.
- **No behavior change for PENDING / PAID / EXPIRED / CANCELLED today.** The union-typed parameter narrows the contract without runtime risk.
- **Manual smoke-test locks the contract** for the PR merge button; future test setup will replace it with automated assertions.

## Lines of change

| File | + | − | net |
|---|---:|---:|---:|
| `frontend/lib/utils.ts` | 25 | 0 | +25 |
| `frontend/app/invoice/[id]/page.tsx` | 1 | 1 | 0 |
| `frontend/app/pay/[id]/page.tsx` | 1 | 1 | 0 |
| `frontend/components/InvoiceCard.tsx` | 1 | 1 | 0 |
| **Total** | **28** | **3** | **+25** |

## Roll-out notes

- Land in a single PR.
- **Branch name:** `fm/hide-qr-pay-on-expired`
- **Commit prefix:** `feat(frontend): hide QR & Pay controls on EXPIRED invoices (#19)`
- **PR title:** same as commit prefix.
- Confirms open PR #17 (HTML escape for invoice proof) and PR #22 (cancellation UI / dashboard filter) don't touch this surface — verified by diff-theme review; PR #17 is rendering safety, PR #22 is additive UI. No conflicts.

> ⚠️ **Cross-fork PR ceiling:** `dorisadams` cannot open the cross-fork PR into
> `Quittance-Labs/Quittance0` because the App-installation token blocks
> `pull_requests:write` (GraphQL "No commits between"; REST 422 `head invalid`).
> Recommend a Quittance-Labs maintainer mirror this proposal and open the PR from a
> session with full token scope. The diff is small enough (~+18 net) that it should
> be straightforward to apply by hand.
