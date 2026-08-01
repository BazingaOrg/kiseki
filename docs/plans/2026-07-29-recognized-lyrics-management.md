# Recognized lyrics management

Status: completed; automated verification passed, user runtime QA remains

## Plan

1. Extend the lyrics job contract from the Materials action through Web job spec/argv and CLI parsing with an explicit `replace: true` option. → verify: focused contract tests are written; static syntax check only.
2. Make the CLI fail before analysis when usable recognized lyrics already exist without `--replace`; preserve existing files on analyzer failure; after a successful replacement move only lyrics-dependent `timeline.json` and `analysis.json` into a recoverable invalidation record. → verify: focused CLI tests are written.
3. Add a dedicated, recognized-only server mutation that leases and locks the project, re-reads source state, and moves `lyrics.json`, `timeline.json`, and `analysis.json` together into one trash manifest with rollback-safe undo. Never include `.lrc` or `beats.json`. → verify: focused asset mutation tests are written.
4. Add the recognized preview actions, explanatory confirmation dialogs, busy disablement, and project refresh on success. → verify: source contract test is written; browser acceptance is left to the user.

## Affected files

- `cli/options.mjs`, `cli/lyrics.mjs`, `cli/job-argv.mjs`, `cli/web-api/job-spec.mjs`
- `cli/web-api/assets.mjs`, `cli/web.mjs`
- `web/src/useJob.ts`, `web/src/Materials.tsx`, `web/src/api.ts`
- Focused CLI/Web/UI contract tests

## Decisions and risks

- Only `lyricsSource === 'recognized'` can be replaced or cleared. LRC remains read-only and is never deleted.
- Replacement keeps existing metadata intact until analyzer exits successfully. It then moves stale `timeline.json` and `analysis.json` to a dedicated trash record; `beats.json` is retained because it is not lyrics-dependent.
- Clear is server-owned rather than a client path deletion. It uses the existing trash manifest and undo machinery; preflight rejects missing, symlinked, drifting, or conflicting files and rolls back any partial move.
- UI confirmation describes that re-recognition replaces the current recognized text and clears dependent timing/cache after success. Job or project lock disables both actions.

## User QA

- In Materials, confirm recognized lyrics display both actions, confirmation copy, disabled busy states, refresh after each success, and LRC displays neither action.
- Exercise a successful re-recognition, failed recognition, clear, and undo using a disposable project.

## Implementation notes

- Added the explicit `--replace`/`replace: true` job contract. The CLI rejects a usable existing recognized result before starting analysis unless replacement is explicit; the analyzer keeps its own atomic lyrics output behavior.
- On successful replacement, `timeline.json` and `analysis.json` move together into a timestamped `.tsuzuri-trash/<uuid>` manifest after the new lyrics output is committed. Failed recognition does not touch old lyrics or metadata; `beats.json` is intentionally retained.
- The replacement manifest is retained for manual recovery; the Web undo list intentionally exposes only the user-invoked clear action.
- Added `POST /api/assets/recognized-lyrics/clear`. It rechecks no LRC is present, validates the recognized payload and canonical metadata paths under a lease/lock, then moves lyrics/timeline/analysis in one manifest-backed operation. Undo restores all files; beats remain untouched.
- Materials now shows recognized-only replace/clear actions, uses the shared dialog, disables during job/asset lock, and refreshes project state after the job or clear operation completes.

## Review

_Static review placeholder: verify replacement and clear rollback/undo behavior in a disposable project before release._

- Static checks completed: `node --check` on touched CLI modules/tests and `git diff --check`. Per task boundary, no test suite, build, browser, network, or recognition service was run.

### Review issues and fixes

- Root cause: replacement wrote directly to `lyrics.json` and used an unrelated trash record for invalidation. Fix: analyzer now writes task-id-derived same-directory staging; staged JSON is validated, then old lyrics/timeline are backed up and replaced in a rollback-capable transaction. `analysis.json` and beats remain untouched.
- Root cause: empty or malformed LRC could still expose recognized actions because source selection and write checks disagreed. Fix: a shared predicate requires usable recognized segments (`start` + nonblank `text`, legacy `end` optional) and zero physical LRC files.
- Root cause: preview lines hid the active recognition panel. Fix: active lyrics jobs take precedence and show `JobPanel`, including progress, error, and cancel controls.
- Root cause: a clear could survive a failed lease release. Fix: clear registers an internal rollback hook that restores files, removes its undo record, and deletes the operation directory before surfacing the lease failure.
- Follow-up architecture: replacement staging moved from the project metadata directory to `taskRoot/tmp/recognized-lyrics.json`; the final lyrics/timeline install now uses the existing claimed-output transaction and recovery phases. The clear path remains manifest-backed and requires strict restore/compensation review before release.
- Final deviation: committed output cleanup is lease-authoritative. A finalize retry after `markCommitted` is retained for release/recovery instead of being reported as failed recognition; stale same-directory partial/backup artifacts now fail closed before analyzer start.
- Recovery states: clear records `trashed`, `restored`, `restored-cleanup-pending`, and `recovery-required`; the existing undo endpoint reconciles mixed source/destination state and returns only an opaque recovery undo id to the UI.
- Recovery error contract: forward, lease, and cleanup recovery failures are `AssetMutationError` responses with `{recoveryUndoId, recoveryRequired:true}` only; underlying rollback causes remain server-side causes and never expose project paths.

### Final deviation

- The prior notes described the clear recovery states before the strict recovery review. The final implementation uses `ready`, `cleanup-pending`, and `recovery-required`: every undo attempt validates every source/destination pair and canonical parent before the first rename; a failed lease rollback compensates back to `ready` only when every trash copy is reconstructed. Cleanup failure after a full restore preserves the record as `cleanup-pending` for a cleanup-only retry. The HTTP boundary now whitelists the opaque recovery fields, and the retry dialog remains open after a failed retry.
- P1 correction: `recovery-required` is not a terminal rejection; retries always reconcile all mixed entries through the same strict preflight. A retained handle is reused only after `verifyLeaseOwnership()` confirms its live claim. Missing/false ownership discards that handle and acquires a fresh project lease before reconciliation; verification failure and fresh-lease contention retain the opaque recovery id without mutating. Only verified ownership may retry the old release.

## Final verification and QA boundary

- Fixed canonical `/var` path handling at the audited asset/lease boundary; equivalent controlled paths now retain one identity without widening sandbox access.
- Retained strict recovery: recognized-lyrics clear/undo still reconciles mixed entries through canonical preflight, verified lease ownership and opaque recovery IDs; no user `.lrc` or `beats.json` is included.
- `--replace` now bypasses `offerFetch` while non-replace flows retain their existing fetch offer behavior. Runtime/registry dependencies were injected into focused tests instead of relaxing the lease protocol.
- Automated regression passed: CLI `556 / 556` on two final consecutive runs without ProjectBusy/IPC; Analyzer `152`; Renderer `9` plus typecheck; Web `45`, typecheck and production build; `git diff --check`.
- User QA remains: disposable-project successful/failed recognition, clear/undo/retry recovery, Materials dialogs and busy states, plus real browser/media/network and cross-platform behavior.
