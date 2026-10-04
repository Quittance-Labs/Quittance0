# Missing-seller behavior in the invoice storage contract

Follow-up to issue #555 and the existing storage-parity PR #566.

## Behavior corrected

`InvoiceMemoryService.getInvoicesBySeller` previously skipped its seller filter when passed an empty string or a missing value. The method returned the all-seller list supplied by storage. The corresponding PostgreSQL service already rejects that missing context with `Seller public key is required`.

The statistics method also lacked that rejection. Its underlying aggregator uses strict seller equality, so a missing seller normally produced zero statistics, not all-seller statistics. This was a backend-contract mismatch, distinct from the listing disclosure.

Both memory-service methods now perform the same initial missing-key check as PostgreSQL before accessing storage. Valid seller filtering, status selection, pagination and unknown nonempty-seller results are unchanged. The deliberately optional seller argument on `listPendingInvoices` remains unchanged for the payment monitor. No login system, SQL, settlement, schema or expiry behavior is changed.

## Focused executed evidence

October 4, 2026: Node.js 22.16.0, TypeScript 5.8.3, Linux. The test loads and transpiles the complete production service file, then calls its real methods with an explicit in-memory storage collaborator. Unused import collaborators throw if invoked. This isolates service admission and filtering; it is not a PostgreSQL, real MemoryStorage, HTTP-handler, complete-suite or deployment run.

With the backend's existing TypeScript dependency available, run from the repository root:

```sh
node --test backend/tests/invoice-memory-seller-scope.test.cjs
```

The same tests replay the old complete source with:

```sh
INVOICE_MEMORY_SOURCE=/absolute/path/to/invoice-memory.original.ts \
  node --test backend/tests/invoice-memory-seller-scope.test.cjs
```

The recorded environment used its already installed TypeScript via `NODE_PATH`; no dependency installation or network request was performed.

| Complete production source | Passed | Failed | Exit |
| --- | ---: | ---: | ---: |
| Parent `f96fffe1ffd26cdf04bd4dfe9faf239cb7bac7fe`, blob `f6725b345132aabe8cb9896a098ff71e8b69bb3b` | 4 | 6 | 1 |
| Repaired blob `6e38c4e52d811ad047a130646dc0a3d69d2ff7ad` | 10 | 0 | 0 |

The six original failures cover both methods with empty, undefined and null seller values. The four passing controls cover seller isolation/status/pagination, valid and unknown seller statistics, an unknown seller's empty listing, and intentionally unscoped pending-monitor access. All ten tests ran without skips.

The PostgreSQL comparison is a source comparison with `InvoiceService.getInvoicesBySeller` and `InvoiceService.getInvoiceStats` at service blob `96b3cfe4382617ee3e71fecdbda3904b648da079`, not a new live database execution. This does not establish that an unauthenticated HTTP caller can reach the service with missing context; existing route authentication remains a separate boundary.
