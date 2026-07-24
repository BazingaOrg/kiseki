# tsuzuri (綴り)

> Photos + a song (+ optional lyrics) → a beat-synced visual diary. Local analysis and rendering, with optional online preparation.

[中文](README.md) · **English**

## Quick start

Requires [Node.js 18+](https://nodejs.org/), [uv](https://docs.astral.sh/uv/), and [FFmpeg](https://ffmpeg.org/). On macOS, install them with `brew install node uv ffmpeg`.

```bash
npm --prefix cli install
npm --prefix renderer install
node cli/tsuzuri.mjs doctor
```

Prepare a media folder:

```text
osaka-trip/
├── photo-01.jpg
├── photo-02.jpg
└── audio/
    ├── music.mp3
    └── lyrics.lrc
```

When bringing your own media, include photos, exactly one audio file, and optionally one `.lrc`.
Audio and `.lrc` files may live at the project root or in `audio/`, so existing projects need no
migration; `fetch` puts newly acquired files in `audio/`. If audio or lyrics are missing, first run
`node cli/tsuzuri.mjs fetch ./osaka-trip` to fill them interactively. Then run:

```bash
node cli/tsuzuri.mjs ./osaka-trip
```

The video is written to `osaka-trip/output/osaka-trip.mp4`. Without an `.lrc`, tsuzuri downloads a Whisper model on first use and transcribes lyrics locally.

## Usage

```bash
node cli/tsuzuri.mjs
node cli/tsuzuri.mjs ./osaka-trip
node cli/tsuzuri.mjs ./osaka-trip -o out.mp4
node cli/tsuzuri.mjs ./osaka-trip --exif --sign --dark
node cli/tsuzuri.mjs lyrics ./osaka-trip
node cli/tsuzuri.mjs fetch ./osaka-trip
node cli/tsuzuri.mjs still ./photo.jpg
node cli/tsuzuri.mjs still ./photos --exif --sign --dark
node cli/tsuzuri.mjs doctor
node cli/tsuzuri.mjs help
```

Running without arguments opens a persistent interactive menu: each command returns to the menu after
completion or failure, and `q` exits. Commands with arguments remain one-shot. The main commands are:

| Command | Purpose |
| --- | --- |
| `<folder>` | Analyze audio, plan the timeline, and render a video |
| `lyrics <folder>` | Preview lyric recognition without rendering |
| `fetch <folder>` | Fetch audio/lyrics into the media folder online (interactive) |
| `still <photo\|folder>` | Export a matching still PNG |
| `doctor` | Check local dependencies |

`still` supports `-o`, `--exif`, `--sign`, `--dark`, `--skip-existing`, and `--scale <1-4>`; video rendering supports the same `--exif`, `--sign`, and `--dark` flags, matching still's behavior (applied at render time, never written to timeline.json), and appends an `-exif`/`-sign`/`-dark` suffix to the default output filename when `-o` is omitted. Run `node cli/tsuzuri.mjs help` for the current full syntax.

`--filter <id>` and `--filter-intensity <0-1>` (defaults to the filter's own intensity) are shared by still and video rendering. Built-in filters: `faded`, `warm`, `cool`, `mono`, `vintage`, `vignette`, `teal-orange`, and `film`.

The signature SVG used by `--sign` can be designed visually with
[animated-signature](https://github.com/BazingaOrg/animated-signature): type a
name, pick a handwriting font, then export a **static SVG (tight bounds, fixed
color or currentColor)**, drop it into the material folder, and set
`signature = "signature.svg"` in `tsuzuri.toml`. The animated export is not
needed — tsuzuri reads only the path data and drives the intro handwriting
animation itself; path order is treated as stroke order. See
[docs/config.md](docs/config.md) for the full constraints.

[![animated-signature studio preview](https://raw.githubusercontent.com/BazingaOrg/animated-signature/main/docs/assets/preview.jpg)](https://github.com/BazingaOrg/animated-signature)

tsuzuri automatically:

- Orders photos by EXIF time when every photo has it, otherwise by filename
- Uses `.lrc` when present, otherwise local Whisper; instrumental music skips subtitles
- Offers to fetch missing audio/lyrics online in interactive terminals (same as `fetch`); stays quiet when the folder is complete
- Adapts cut timing to the photo count and song length, trimming and fading on a downbeat when needed
- Normalizes output loudness to −14 LUFS (TP −1.5 dB)

Supported images are `.jpg`, `.jpeg`, `.png`, and `.webp`; supported audio files are `.mp3`, `.m4a`, `.wav`, `.flac`, `.aac`, and `.ogg`. Video clips are not supported yet.

## Architecture

![tsuzuri architecture: optional online preparation feeding the local analysis, planning, and dual-render pipeline](docs/assets/architecture/architecture.png)

`fetch` only writes optional online material into the media folder. Once photos, audio, and LRC are
ready, Analyze, Plan, Remotion rendering, and loudness processing all run locally. Video and still
exports share the same canvas, typography, photo, and palette system.

## Optional online preparation

```bash
node cli/tsuzuri.mjs fetch ./osaka-trip
```

1. In the explicit `fetch` entry, Enter defaults to downloading missing audio and searching missing lyrics
   (the automatic offer before rendering still defaults to skipping). Enter a video URL you are entitled to
   use, or choose from five yt-dlp search results—Enter downloads the first one.
2. If the folder has multiple audio files, choose one to keep. The others are deleted only after confirmation; cancelling changes nothing.
3. Confirm the song title and optional artist after download (prefilled from the source title and audio tags,
   Enter accepts them); tsuzuri names it `audio/Song - Artist.ext`. Replacing existing audio requires confirmation.
4. [LRCLIB](https://lrclib.net) searches synced lyrics using the song metadata and audio duration; candidates more than three seconds away are flagged.
5. Enter previews the first lyric candidate by default. Page through all timestamps before
   confirming the save to `audio/`; Chinese is converted to Simplified Chinese when applicable, while English
   and Japanese stay unchanged.

Every prompt starts with a cyan `?` and lists its own keys (uniformly `key action`, separated by ` · `):
Enter performs the safe default action named by the prompt, `0` goes back where available, `q` exits
tsuzuri from any prompt, and Ctrl+C interrupts. Unknown keys are rejected instead of silently confirming
or cancelling. At a menu path prompt, press Enter on an empty line to return to the menu.

Audio download requires a [yt-dlp](https://github.com/yt-dlp/yt-dlp) you install yourself
(`brew install yt-dlp` on macOS); `fetch` checks it only when download is used. Existing lyrics are never
silently overwritten. Cancelling or finding no match is not an error; local transcription remains available
and never uploads the audio. Exiting immediately removes an unconfirmed temporary download, so the next run
downloads it again. Only interactive terminals offer online preparation—pipes and scripts never enter the network prompts.

## Configuration and documentation

Add `tsuzuri.toml` to the media folder to adjust resolution, frame rate, transitions, subtitles, background, intro, and outro.

All generated files live under `output/`: videos at its root and analysis plus preferences in `output/metadata/`. Existing projects copy their old `metadata/` on the first run without deleting it. When the media is unchanged, edit `output/metadata/timeline.json` and rerun: tsuzuri preserves the hand-edited timeline and skips repeated analysis.

`--portrait` renders native 1080×1920 and `--square` renders 1080×1080. Both affect only that render, never the project timeline, and also work with `still`.

Analysis and rendering stay local and require no API key. Whisper selects an Apple Silicon, NVIDIA CUDA, or CPU backend automatically; its model is downloaded only on first use.

- [Configuration reference](docs/config.md): all `tsuzuri.toml` options (Chinese)
- [Timeline schema](docs/specs/timeline-schema.md): editing `timeline.json` or developing the renderer (Chinese)
- [Project status](docs/tsuzuri-status.md): current capabilities, constraints, and pending validation (Chinese)

## Development

```bash
cd analyzer && uv run pytest
cd cli && npm test
cd renderer && npm run typecheck
cd renderer && npm run studio
```

## License

Code is licensed under [MIT](LICENSE). Bundled Noto fonts use the [SIL OFL 1.1](renderer/src/fonts/OFL.txt).
