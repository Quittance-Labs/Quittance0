# Invoice contract review resolution — 2026-10-04

This records the response to [the October 3 review of PR 571](https://github.com/Quittance-Labs/Quittance0/pull/571#issuecomment-5970246093). The implementation revision is `f634e4f37945d40b0ed4024a88b380f5847fe87a`, tree `cc5b8f56e908f6e60e8bb683211a3d950fd959be`.

## Changes addressing the review

The existing branch now includes upstream `282c75ad933651a93b89a8412ab649b48714c739` without rewriting its original history. The invoice client retains shared return types while tolerating partial runtime payloads, rather than turning contract drift into an unavailable pay page or dashboard. Strict shared parsers and their regression assertions remain available for contract verification; malformed statistics are not silently accepted by the strict parser. Runtime statistics retain the existing one-row storage-response normalization.

`copyValue` and `networkPassphrase` are carried through both creation/payment-info result types, their parsers, and the OpenAPI schemas. Conflict resolution preserves current-main request correlation, invoice search, canonical proof delivery and payment-session types. This is the same PR and original contribution, not a replacement submission.

## Executed project checks

[Run 37189795925](https://github.com/woahwhattheheck/Quittance0/actions/runs/37189795925), job `111399414070`, assembled and verified the exact implementation commit and tree. Node 24.21.0, npm 11.19.0, hosted Ubuntu; locked dependencies, test/loopback configuration.

| Directory | Command | Exit | Result |
| --- | --- | --- | --- |
| frontend | `npm run lint` | 0 | Three anonymous-default-export warnings; no lint error |
| frontend | `npm run typecheck` | 0 | Passed |
| frontend | `npm test` | 0 | 756 passed, 0 failed |
| backend | `npm run typecheck` | 0 | Passed |
| backend | `node --import tsx --test tests/invoice-contract.test.ts tests/create-invoice-validation.test.ts tests/shared-verification-contract.test.ts` | 0 | 80 passed, 0 failed |
| repository root | `node --test tests/invoice-contract.test.mjs` | 0 | 2 passed, 0 failed |

This is 838 selected passing tests, not the full backend or full shared suite. The original submitted head `b223d5798fe68c150a429e652f10990d3f632a7d` reproduced the review's six frontend failures in run `37188450363`: 594 passed out of 600. The newer candidate also incorporates upstream tests, so the different totals are not directly comparable test populations.

**The combined workflow's overall conclusion is failure.** All six project commands succeeded, but an additional wrapper condition required the tracked worktree to remain unchanged. That condition failed; the initial runner did not retain its changed-file list. [Artifact 11298905270](https://github.com/woahwhattheheck/Quittance0/actions/runs/37189795925/artifacts/11298905270) contains every command log and the raw receipt. It records `all_checks_passed: true` separately from `source_worktree_unchanged: false`.

## Independent original-source typecheck

[Run 37190601163](https://github.com/woahwhattheheck/Quittance0/actions/runs/37190601163), job `111401771842`, checked out the same implementation and verified `frontend/next-env.d.ts` directly against its committed Git object before execution. Locked frontend install returned 0 with no tracked changes. The original-source frontend typecheck returned 0, without first regenerating or replacing the declaration. Its only tracked change was `frontend/tsconfig.tsbuildinfo`, a compiler-generated cache; application source and the declaration remained unchanged.

This independent workflow also concluded failure because its extra clean-worktree condition rejected that generated cache. It is not a typecheck failure, and neither red workflow is represented here as green CI. [Artifact 11298820972](https://github.com/woahwhattheheck/Quittance0/actions/runs/37190601163/artifacts/11298820972) retains the original declaration, command logs, receipt and exact cache diff. Both archives were downloaded and inspected.

## Limits

The checks do not establish production deployment, live payment/settlement, browser/device wallet behavior, PostgreSQL integration, or full backend/shared-suite success. No generated cache or declaration changes were committed, no tests were removed, and validation-controller workflows remain off this product branch. Earlier failed diagnostic runs remain failed and are not publication evidence. This document adds no new execution or assertion of upstream acceptance or payment.
