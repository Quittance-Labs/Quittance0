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

## Response discriminant follow-up

Source `31650ab73508d70e1020b295298b2c499947447f` is a direct successor of `a8686a37022f7a714fcde217457cef56f333795c`. The six strict success-response parsers now require a supplied `success` value to be literal `true`, instead of accepting malformed values such as `"false"`, `0`, or `null` and normalizing them into a success. Supported legacy payloads that omit the flag retain their existing normalization. The already-strict stats parser, earlier pagination repair, OpenAPI document, tolerant frontend runtime and payment/identity logic are unchanged.

Two cases in `backend/tests/invoice-response-success-contract.test.ts` check discriminant rejection and compatibility. Both run against the complete production contract and its real `invoice-validation.ts` dependency, without a mock validator or copied parser. Before execution, the original source and dependency matched Git blobs `151de060f051a0ab604604cdd672779621680c61` and `541d7327556913cf8fbc7b240abbb41f31f40196`. The published correction matches executed source blob `f889b4eea91f3d74528ba24b4916cc5ec566d500`; the test blob is `3787978046ebbd1467bdeec30074a86ad5dc4c81`.

The available cloud runtime had Node 22.16.0 and TypeScript 5.8.3, but not the project dependencies. `transpileModule` emitted the complete two production modules and the unchanged test into their corresponding CommonJS paths, with ES2022 target and no transpilation diagnostics. `node --test` then executed the emitted test. The original source produced **1 pass / 1 fail (exit 1)**; the corrected source produced **2 pass / 0 fail (exit 0)**. The compatibility case also covers valid stats and non-object rejection. Transpilation is not a full TypeScript typecheck.

The repository-native command is `cd backend && node --import tsx --test tests/invoice-response-success-contract.test.ts`; the execution described above used its emitted JavaScript equivalent. No additional workflow was introduced. The earlier broader commands above were not rerun for this correction and must not be treated as fresh current-head results.

## Limits

The checks do not establish production deployment, live payment/settlement, browser/device wallet behavior, PostgreSQL integration, or full backend/shared-suite success. No generated cache or declaration changes were committed, no tests were removed, and validation-controller workflows remain off this product branch. Earlier failed diagnostic runs remain failed and are not publication evidence. The follow-up records only its separately scoped execution, not upstream acceptance or payment.
