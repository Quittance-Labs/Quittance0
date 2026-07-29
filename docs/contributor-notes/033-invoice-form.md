# InvoiceForm fields overview (#76)

`InvoiceForm` is the controlled client form used to collect the details for a new Quittance invoice.
Its parent supplies the connected wallet's public key and an optional success callback for the newly created invoice response.

## Fields

The required amount starts empty and uses a numeric input with seven-decimal precision and a positive minimum.
The asset selector starts on XLM and lists each entry from `STELLAR_ASSETS`, with `AssetLogo` showing the current choice.
Description is optional and limited to 500 characters.
Seller name, seller email, customer name, and customer email are optional and limited to 255 characters each.
The customer-email hint explains that the address is used for invoice or proof sharing and is not required to create an invoice.

Each field is backed by local React state, so displayed values and submitted values stay in sync.

## Submission flow

Submission first requires a supplied wallet public key and a parsed amount greater than zero.
Optional seller and customer email values must match the form's local email pattern when present.
The selected asset is looked up by code so its issuer can accompany non-native assets in the request.
`invoiceApi.create` receives the numeric amount, asset code and issuer, a seven-day expiry, the wallet public key as seller, and any non-empty optional fields.
While that request is pending, the submit button is disabled and shows a loading state.
On success, the form shows a confirmation toast, passes the created invoice data to `onSuccess`, and resets all fields to their defaults.
On failure, it prefers the API error message and falls back to a generic creation error, then always clears the loading state.

## Boundaries

This component prepares and sends a create-invoice API request; it does not connect a wallet or sign, submit, pay, or verify a Stellar transaction.
Wallet connection belongs to the surrounding page, while payment and proof flows operate after the invoice has been created.

## Where to look

- `frontend/components/InvoiceForm.tsx` - controlled fields, validation, request construction, and reset behavior.
- `frontend/lib/assets.ts` - selectable asset codes, issuers, and display metadata.
- `frontend/components/AssetLogo.tsx` - selected-asset logo presentation.
- `frontend/lib/api.ts` - create-invoice API method and request shape.
- `frontend/app/page.tsx` - wallet gate, form props, and success-result presentation.
