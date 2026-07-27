# Web UI polish and asset actions

## Confirmed plan

1. Update the workbench header to show the full selected folder path with middle truncation and a native title tooltip; remove the repeated materials-page path and photo count.
2. Make each photo tile own its filename and file actions, using the same photo-item structure for materials and results.
3. Tighten the lightbox and raise its default control contrast; reduce image occupancy and present EXIF as unboxed supporting text.
4. Replace native asset-operation alerts with an in-app confirmation/error dialog; keep the existing asset mutation API contract unchanged.
5. Give the two Make action cards a shared content baseline so their readiness and parameter rows align.
6. Rework lyric following into a fixed five-line viewport whose active line stays in the middle.
7. Run only focused static checks here; leave full test/build/browser verification to QA.

## Affected files and risks

- `web/src/Workbench.tsx`, `web/src/Materials.tsx`, `web/src/Results.tsx`, `web/src/PhotoGrid.tsx`, `web/src/Make.tsx`, `web/src/Lyrics.tsx`, and `web/src/App.css`.
- New dialog UI, if needed, remains local to the web app and must preserve keyboard focus and Escape dismissal.
- Asset writes continue through the existing API and its server-side safeguards; this pass changes only when the request is confirmed and how errors are presented.

## Implementation notes

- Header now presents the project path, with middle truncation for long paths and the full value in its title tooltip. The materials section no longer repeats the path or the photo count.
- `PhotoGrid` now owns each image, filename, and per-file rename/delete controls. Materials and Results both pass their photo asset collections into this shared layout.
- The lightbox uses smaller, high-contrast controls, reduced image bounds, and unboxed EXIF text. Existing keyboard, zoom, touch, and reduced-motion behavior remains in place.
- Added `Dialog.tsx` for destructive confirmation and mutation/undo errors; `Workbench` no longer calls `window.alert` for these paths. Asset requests still use the existing mutation and undo API calls.
- The Make action description has a shared minimum height so the ready/parameter rows align. Lyrics have a five-line viewport with two-line start/end buffers, allowing the active row to scroll to the center even at the beginning or end.
- Focused static check completed: `git diff --check`. Full test, typecheck, build, and browser validation remain assigned to QA.

## Review notes

- Review found that the initial photo-group wiring passed an `AssetCollection` where `PhotoGrid` expects an item array. All callers now pass `.items`, and `PhotoGrid` indexes each group in a path-to-asset `Map` instead of repeatedly calling `find`.
- Review also identified dialog lifecycle gaps. The dialog now restores the invoking focus on close, loops focus between its controls, places destructive actions on the cancel button by default, and disables all close paths while an asynchronous confirmation is in flight.
- Empty supplied photo groups are now filtered. Photo trigger buttons occupy the full grid width, and the path label relies only on explicit middle truncation so CSS cannot hide the final directory name.
- The lyrics viewport no longer uses a clipping mask or an enlarged active row; its two-line end buffers remain so first and last lyrics can be centered. Narrow cards drop the desktop description-height reservation.
- Follow-up acceptance repair: lyric follow now derives the target scroll position from the list and active-line `getBoundingClientRect()` center delta plus the current `scrollTop`, rather than `offsetTop`; this keeps the two visual centers in one coordinate system. The existing web test command only covers a non-React capability module and there is no JSX/DOM test harness, so no isolated lyric component test was added in this pass.
- Follow-up acceptance repair: lightbox bounds are now `min(68vw, 1120px)` by `68vh` on desktop, and `calc(100vw - 48px)` by `72vh` on narrow screens.
- Browser acceptance found YARL applying inline image maximums after the stylesheet. The same instance-scoped desktop and narrow-screen `max-width`/`max-height` rules now use `!important` solely to override those inline maximums; width, height, and zoom transforms remain library-controlled.

## Runtime restart notes

- Confirmed the prior listener on `127.0.0.1:3000` was PID `43649`, running `node cli/tsuzuri.mjs web`; stopped that explicit PID only.
- Restarted the current checkout with `runWeb(null, {openBrowser: false})`. The active listener is PID `22480`; startup output is retained at `/tmp/tsuzuri-web-3000-20260727.log`.
- Runtime smoke checks: `GET /` returned `200`; an intentionally empty `POST /api/assets/mutate` returned `403`, with no project token or asset mutation attempted. `GET /api/project` without a project token also returned `403`, consistent with the server authorization boundary.
