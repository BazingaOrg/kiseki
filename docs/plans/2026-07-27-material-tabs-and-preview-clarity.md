# Material tabs and preview clarity

## Confirmed plan

1. Replace the Materials card stack with persistent photo, music, and lyrics tab panels. Select the first panel needing action, otherwise photos; tab metadata reflects each material state.
2. Render the material photo grid without its redundant group heading while preserving headings in results photo groups.
3. Remove lyric-list edge spacers so its fixed five-line viewport naturally aligns at the beginning and end while retaining centered mid-playback following.
4. Rename still-export scale to output scale and show its computed output dimensions, explicitly scoped to single-image exports.
5. Preserve the filter preview's existing first-photo source and add/update focused web tests where appropriate.

## Risks

- Panels must stay mounted so searches, edits, and active job displays retain local state when tabs change.
- Existing results photo-group headings must not be affected by the material-only heading removal.

## Verification

- Run `git diff --check` after implementation. Full test, typecheck, and browser verification are delegated separately.

## Implementation notes

- Replaced the three material cards with persistent photos, music, and lyrics tab panels. The default is music when audio is absent or ambiguous, then lyrics when lyrics are ambiguous, otherwise photos.
- PhotoGrid now has an explicit `showHeader` switch so the material panel can start directly with its grid while result groups retain their headings.
- Removed lyric edge margins; the existing scroll clamp now naturally aligns the beginning and end in the five-line viewport.
- Added a tested output-dimension helper and clarified the still scale UI as a single-image output multiplier.
- Kept the filter preview source unchanged (`photos[0]`); no template image assets were added or removed.
- Ran `git diff --check` successfully. Full test, typecheck, build, and browser checks remain for delegated verification.

## Review notes

- Removed the fixed-canvas output-dimension helper and test: project canvas dimensions are not part of the web API. The UI now accurately states that output pixels equal the project canvas multiplied by the chosen scale.
- Made a currently running audio-download or lyric-recognition task the initial material tab, without forcing later tab selection changes.
- Restored lyric provenance in the lyrics panel and removed the obsolete material-card CSS left behind by the tabs migration.
