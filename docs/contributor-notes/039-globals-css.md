# globals.css Design Tokens Overview

`frontend/app/globals.css` loads the Tailwind layers and defines Quittance's shared visual foundation.
Its root variables provide a compact palette for the invoice, payment, dashboard, and proof surfaces.
They complement Tailwind utilities; they do not replace every direct utility color used by components.

`--ink` is the primary text color, while `--muted` supports secondary labels and explanations.
`--paper` is the page background, `--paper-deep` is a stronger neutral surface, and `--line` marks borders.
`--teal` identifies primary actions and accents, with `--teal-hover` supplying the interactive hover state.
`--font-display` connects the Instrument Serif variable from the root layout to the `.font-display` helper.

The body consumes the ink and paper tokens so every route starts from the same readable base.
Shared `.btn`, `.card`, `.input`, `.label`, and `.premium-header` classes apply common spacing and surfaces.
Primary buttons use teal for actions such as creating, paying, verifying, and downloading proof.
Inputs and focus rings reuse line, paper, and teal values to keep keyboard focus visible.

The legacy logo-background class now resolves to plain paper, and decorative orb classes are disabled.
The hero atmosphere uses separate gradients for the landing page rather than changing the core tokens.
Print rules preserve receipt colors, hide navigation and `.print:hidden` controls, and leave proof content printable.

When changing a token, review create, pay, invoice, dashboard, and printed receipt states together.
Keep status-specific success, warning, and error colors distinct from the shared brand palette.

## Where to look

- `frontend/app/globals.css` — token values, shared component classes, focus styles, and print rules.
- `frontend/app/layout.tsx` — global stylesheet import and display-font variable wiring.
- `frontend/app/page.tsx` — invoice creation and direct token usage on the landing route.
- `frontend/app/pay/[id]/page.tsx` — payment flow using shared cards, inputs, headers, and buttons.
- `frontend/app/invoice/[id]/page.tsx` — invoice detail and proof-facing presentation.
- `frontend/components/PaymentReceipt.tsx` — printable receipt content and hidden print controls.
