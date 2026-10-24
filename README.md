# The Thinking Radio — website

Plain static site: `index.html`, `style.css`, `app.js`, and one data file, `episodes.json`. No build step, no framework,
no network at runtime (fonts are self-hosted in `fonts/`, all art is inline SVG/CSS). Everything the page shows about episodes
comes from `episodes.json`, so adding an episode or a dub never needs a code change.

## Preview locally
`fetch()` of `episodes.json` does not work from `file://`, so serve the folder:

```sh
node tools/serve.mjs            # from site/  -> http://localhost:8080/   (supports video seeking)
# or
npx http-server .               # from site/
python -m http.server 8080      # from site/
```

To publish, upload the whole `site/` folder to any static host.

## Add an episode
1. Make `media/epNN/` and drop in the files, e.g. `media/ep02/the-update.mp4` (16:9), `the-update-reel.mp4` (1080x1920),
   `poster.jpg` (16:9), `poster-reel.jpg` (vertical) and `the-update.srt`.
2. Optional: `node tools/srt2vtt.mjs` writes a `.vtt` next to every `.srt` in `media/`. The site also reads `.srt` directly
   (it converts at runtime), so this step only saves the visitor a few milliseconds.
3. In `episodes.json`, fill in the episode and set `"status": "out"`:

```json
{
  "num": 2, "slug": "ep02-the-update", "title": "The Update", "logline": "…",
  "status": "out", "duration": 64,
  "media": { "wide": "media/ep02/the-update.mp4", "reel": "media/ep02/the-update-reel.mp4",
             "poster": "media/ep02/poster.jpg", "posterReel": "media/ep02/poster-reel.jpg", "dubs": {} },
  "subtitles": { "en": "media/ep02/the-update.vtt" },
  "burnedIn": { "en": "en" },
  "audio": { "en": true, "hi": false, "ta": false },
  "alt": "Describe the poster for screen readers."
}
```

The newest episode with `status: "out"` plays at the top of the page automatically. An episode stays a "Coming soon" ticket
(with a film-leader placeholder, or its `media.poster` if you add one early) until it is `out` and has `media.wide`.
`#ep-02` in the URL opens a specific episode.

Fields: `duration` is seconds. `reel` and `posterReel` are optional (without a reel the Wide/Reel switch hides).
`burnedIn` maps a sound version to the caption language printed into the picture: the matching subtitle track then starts
hidden (no doubled captions; visitors can switch it on), and other languages' subtitles are lifted to the top of the frame.

## Add a dub (Hindi `hi`, Tamil `ta`)
1. Drop the files in the episode's folder, e.g. `media/ep01/thinking-radio-hi.mp4` and `media/ep01/thinking-radio-hi.srt`.
2. In `episodes.json` set `"audio": { …, "hi": true }`. That is all for episode 1: its `media.dubs.hi` already names
   `thinking-radio-hi.mp4` and `thinking-radio-hi.srt`.

```json
"dubs": { "hi": { "wide": "media/ep01/thinking-radio-hi.mp4", "reel": null, "subtitles": "media/ep01/thinking-radio-hi.srt" } }
```

- `reel: null` means the dub has no vertical cut; phones then play the wide dub. Add a reel path when one exists.
- A dub's `subtitles` are used only while that dub is switched on (they are timed to the dubbed sound).
- If the dub has its own captions burned in, add `"hi": "hi"` to `burnedIn`.
- An episode without a `dubs` entry follows the naming convention `<wide>-hi.mp4` / `<reel>-hi.mp4`.
- Subtitles in a language without a dub can go in the plain `subtitles` map (e.g. `"hi": "media/ep01/thinking-radio.hi.vtt"`);
  they then show over the English sound.

When a visitor picks a language that has no dub yet, the site keeps playing English and says "dub coming soon".
If a dub is flagged `true` but its file is missing, it falls back to English with a notice.

## Tools
- `tools/serve.mjs` — tiny static server with Range support.
- `tools/srt2vtt.mjs` — SRT → WebVTT for everything under `media/`.
- `tools/shoot.mjs` — headless-Chrome screenshots (desktop 1440x900, phone 390x844 and 375x812) into `shots/`, plus a check
  for console errors, failed requests and horizontal scroll. Needs `puppeteer-core` from the parent project and Chrome:
  `node site/tools/shoot.mjs` from `thinking-radio/`. The `shots/` folder is not needed for publishing.

## Credits
Fonts (SIL Open Font License 1.1, licences in `fonts/`): Shrikhand, Limelight, IM FELL English SC, Baloo 2, Baloo Thambi 2,
Noto Serif Devanagari, Noto Serif Tamil. Devanagari and Tamil text pick up Baloo (display) and Noto Serif (body, subtitles)
automatically through `unicode-range`, and only download when those scripts appear on the page.
