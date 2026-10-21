# e2e fixtures

Each screen item adds its own canned kernel data here, as `<screen>.ts` (for example `approvals.ts`), and passes it to `startFixtureKernel({ routes, events })` from `../fixture-kernel.ts`. Keys are `"<METHOD> <path>"` exactly as in `CONTRACT_ROUTES` (`app/src/api/contract.ts`), and every body is typed by that contract.
