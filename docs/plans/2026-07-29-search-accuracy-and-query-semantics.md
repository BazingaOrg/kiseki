# Search accuracy and query semantics

Date: 2026-07-29
Status: implemented; awaiting user QA

## Original plan

### Goal

Make audio and lyric search use one authoritative normalized-query contract, improve candidate accuracy without changing API response shapes or types, and preserve stale-result protection in Materials.

### Non-goals

- Do not parse, remove, or reorder characters such as `+`, `-`, or `·`.
- Do not change API response shapes/types, run real searches, or implement browser/build validation.

### Steps

1. Normalize query text with trim plus whitespace collapsing in the backend and align audio provider/final candidate limits.
2. Make lyric candidates require valid provider IDs in Web, dedupe by canonical ID, rank comparable local-duration matches, and keep CLI's default permissive for missing IDs.
3. Keep exact lyric lookup un-reordered; fall back only for miss/unusable records, never transport/protocol errors.
4. Update Materials to retain raw user input, separate displayed result query, preserve generation/stale guards, and distinguish automatic exact mode from manual fuzzy mode.
5. Add narrow contract tests and perform static checks only.

### Affected files

`web/src/Materials.tsx`, `web/src/api.ts`, `cli/ytdlp.mjs`, `cli/ytdlp.test.mjs`, `cli/web-api/fetch.mjs`, `cli/web-api/fetch.test.mjs`, `cli/fetch.mjs`, `cli/fetch.test.mjs`, and any necessary existing Web contract test.

### Decisions

- Backend normalization is authoritative: trim and collapse whitespace while retaining all other characters and order.
- Audio fetches up to 20 provider results, then stable-ID dedupes and exposes at most 10.
- Web lyric selection requires a valid ID; CLI selection does not require one by default.
- Comparable local duration sorts by absolute delta; missing duration is last and equal deltas retain provider order.

### Risks and user QA

Validate manual/fuzzy and automatic/exact searches, stale responses, duplicate/missing IDs, duration ordering, exact lookup fallback boundaries, and the revised hint copy. No tests, build, browser, network, or real searches will be run by the implementer.

## Implementation notes

- Added the authoritative trim-and-collapse normalization in the shared yt-dlp search module. Both sync and async audio searches request 20 provider rows, then preserve provider order through stable-ID dedupe and the final 10-row slice.
- Web lyrics now filters synced/non-instrumental records, requires canonical IDs, dedupes them, and ranks comparable local-duration matches by absolute delta with missing durations last. CLI keeps its default permissive behavior for missing IDs. Exact `/get` records remain a one-item result; only unusable Web exact records fall back to `/search`, while request/protocol errors surface without fallback.
- Materials retains raw input. Empty lyric input continues automatic/exact mode and never receives inferred text through `setQuery`; the backend-selected query is shown beside results. Non-empty input stays manual/fuzzy, and existing generation/stale-result guards are retained.
- Updated narrow source tests for provider limit/normalization, CLI versus Web exact-ID behavior, and Web duration ranking. No API response fields or TypeScript types were changed.
- Static checks only: `node --check` and `git diff --check`. Tests, build, browser, render, network, and real searches remain user QA.

## Review issues, root causes, and fixes

- Issue: the initial focused coverage did not prove that invalid/unsynced/instrumental rows among the first provider results could not consume the Web ten-row budget. Root cause: the limit behavior was only tested with already-valid records. Fix: added a Web endpoint contract case that rejects the first ten mixed-invalid rows and confirms ten later valid rows are returned.
- Issue: duration-order coverage did not explicitly capture equal-delta provider stability or the no-local-duration branch. Root cause: ranking tests covered only distinct deltas. Fix: added cases for equal deltas retaining provider order and unknown local duration leaving provider order unchanged.
- Issue: Web query-state tests did not directly guard the automatic repeated-search URL or the inferred-query overwrite regression. Root cause: the behavior crossed API serialization and component source state. Fix: added `web/src/search-contract.test.ts` covering blank `q` omission, normalization, stale/onChange guards, and the absence of `setQuery(outcome.data.query)`.
- Issue: exact lookup tests covered unusable records but not thrown transport/protocol failures. Root cause: fallback control flow was not asserted separately from a valid response. Fix: added endpoint cases that require a 502 after `/get` failure and assert no `/search` request occurs.
- P2 review: scoped Materials assertions to the `LyricsSearch` component via explicit start/end markers, covering raw state, stale guards, normalized requests, automatic/manual wording, and preventing unrelated component matches.

## Final verification and QA boundary

- Added/retained Web command contract coverage for the request-to-CLI mapping; no API response shape or public API contract changed.
- Production `tsconfig` excludes only Node test files so test-environment types no longer pollute application typecheck; Web tests remain executed by their test runner.
- Final automated QA passed: CLI `556 / 556` on two final consecutive runs without ProjectBusy/IPC; Analyzer `152`; Renderer `9` plus typecheck; Web `45`, typecheck and production build; `git diff --check`.
- User QA remains for real manual/fuzzy and automatic/exact searches, stale responses, external provider/network behavior, browser interaction, media and cross-platform runtime behavior.
