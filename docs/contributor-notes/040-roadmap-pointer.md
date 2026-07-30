# Where ROADMAP.md Fits for Contributors

`ROADMAP.md` is the short execution checklist for Quittance's current release.
It summarizes the locked product decisions and the order in which planned outcomes ship.
Use it to confirm that a proposed change supports the focused invoice, pay, verify, and proof journey.

The roadmap does not replace `PLAN.md`.
`PLAN.md` is the canonical source for product scope, architecture, phases, and definition of done.
When the two documents differ in detail, contributors should follow the plan and ask before diverging.

The checklist keeps the release centered on one complete flow:
a seller creates an invoice, shares its link or QR, the payer pays on Stellar,
the backend verifies the transfer through Horizon, and the app produces payment proof.
Items outside that flow, such as production email or database expansion, belong to later phases.

Before editing code, locate the relevant roadmap row and read its matching detail in `PLAN.md`.
Keep each contribution narrow, preserve the locked wallet and email boundaries, and run its local smoke checks.
The roadmap's commit order is sequencing guidance, not permission to bundle several outcomes into one change.

## Where to look

- `ROADMAP.md` — short release checklist and commit order.
- `PLAN.md` — canonical scope, architecture, phases, and acceptance conditions.
- `README.md` — shipped behavior, local setup, and the end-to-end invoice flow.
- `frontend/app/invoice/[id]/page.tsx` — invoice detail and proof-facing UI.
- `frontend/app/pay/[id]/page.tsx` — payer link, wallet, and QR flow.
- `backend/src/server-mvp.ts` — in-memory invoice API and Horizon verification path.
