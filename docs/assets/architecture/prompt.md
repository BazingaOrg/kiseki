# tsuzuri architecture redraw context

## Must preserve

- The diagram shows shipped, local-first behavior only; it is not a SaaS or deployment roadmap.
- Optional online sources and fetch preparation only write into the media project folder; analysis and rendering remain local.
- The media project folder is the shared boundary for user-supplied photos, audio, and optional lyrics.
- Web workbench and CLI are equivalent local entry points into the same task runtime.
- The runtime permits one active job and uses leases, child-process cleanup, and atomic output handling.
- Analyze + Plan produces `metadata/timeline.json`, a hand-editable contract used by rendering.
- Remotion produces both video and still outputs from the shared project and visual system: MP4 and PNG.

## Suggested additions

- None. Add a node only after a new shipped boundary cannot be represented by the existing README prose.

## Visual direction

- Read left to right from optional preparation through the local project and runtime, then down to render outputs.
- Keep exactly nine nodes and at most two focal nodes: task runtime and `timeline.json`.
- Use English labels for both README languages; keep node copy to short operational phrases.
- Use the Kami parchment, ivory, warm gray, and ink-blue tokens only; use solid shipped nodes, orthogonal lines, and clear node standoffs.
- Keep lines behind nodes and outside text areas; no gradients, shadows, icons, scripts, images, or future-state styling.

## Sister boundaries

- Fetch selection, overwrite prompts, filename confirmation, LRCLIB candidates, and Chinese lyric conversion belong in `README.md`, `README.en.md`, and `docs/plans/2026-07-14-fetch-audio-lyrics.md`.
- Timeline fields and validation belong in `docs/specs/timeline-schema.md`.
- Configuration and renderer options belong in `docs/config.md`.
- Runtime caveats and platform constraints belong in `docs/tsuzuri-status.md`.
