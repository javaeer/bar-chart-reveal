# bar-chart-reveal (bar chart race)

> Config-driven 3D bar-chart-race visualization & video exporter.
> Any dataset (`[{name, value, highlight?}]`) + any theme + any title →
> **in-browser animation preview** and **CLI export to MP4**.
> Not limited to one dataset: company departments, planet parameters, or any
> "who's bigger" comparison can be turned into a video in one go.
>
> Stack: Vue 3 + Vite + ECharts-GL (3D `bar3D`) + puppeteer-core + ffmpeg.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/javaeer/bar-chart-reveal/actions/workflows/ci.yml/badge.svg)](https://github.com/javaeer/bar-chart-reveal/actions/workflows/ci.yml)

## What it is

Each entry is a 3D bar that pops up in ascending order; the camera continuously
follows the active bar, then pulls back and lifts to fit all bars. Rendered with
WebGL in the browser; exported to MP4 via headless Chromium frame capture + ffmpeg.

| Capability | Notes |
|---|---|
| Config-driven | Data / title / theme / shape all come from one JSON config — zero code to change content |
| Dual-format data | Reads both the internal format (`views[].items[]`) and the canonical **v2 template** (`dataset/metrics[]/entities[]`); auto-detected |
| Multi-view | One config can hold multiple metric views (e.g. population / area / red-site count) |
| Multi-shape | bar / cube / cylinder / rounded / sphere, per-view or global, switchable via URL |
| Multi-aspect | `16:9` / `9:16` / `1:1` / `4:3`; preview viewport and export pixels share one source (WYSIWYG) |
| Editable info | Title / subtitle / source / notes editable live on the page |
| In-browser export | "Export WebM" records in the browser (composits the info layer) |
| CLI export | `npm run render` auto-selects encoder, auto-starts Xvfb, single-process multi-frame rendering |

## Quick start

```bash
npm install                          # install dependencies
npm run dev                          # dev preview: open http://localhost:5173
npm run build                        # production build → dist/
npm run render                      # export (default: all views of built-in v2 template)
```

Render dependencies (only needed for export): system `chromium` (or set `CHROMIUM_PATH`),
`ffmpeg` (with libx264 / libopenh264 / libvpx-vp9). The script auto-detects the browser,
auto-selects an encoder, and auto-starts `Xvfb` when no display is available.

## Configuration

Two formats are supported:

- **Internal format** — `views[].items[]` (view = metric, item = entry).
- **v2 template** — `dataset` / `metrics[]` / `entities[]` (metric = view, entity = entry).
  Can be used directly as a config; auto-adapted.

Full field mapping, `metrics[].enabled` / `missingPolicy`, and the dual-format
detection rules: **[docs/data-template-v2.md](docs/data-template-v2.md)**.

Minimal internal-format example:

```jsonc
{
  "title": "My Bar Race",
  "aspect": "16:9",
  "revealRatio": 0.72,
  "views": [
    { "key": "area", "label": "Area", "unit": "km²",
      "items": [ { "name": "A", "value": 88, "highlight": true }, { "name": "B", "value": 288 } ] }
  ]
}
```

## CLI usage

Full parameter table, URL contract, and examples: **[docs/cli-reference.md](docs/cli-reference.md)**.

```bash
node scripts/render.mjs --config samples/huining-v2.json --all-views
node scripts/render.mjs --config samples/planets.json --all-views --aspect 1:1 --frames 240
```

## Quality assurance

```bash
npm test          # pure-logic unit tests (no browser)
npm run qa        # verify.mjs + interact.mjs (needs chromium + Xvfb)
npm run qa:all    # run all QA
```

See [TESTING.md](TESTING.md) and [docs/architecture.md](docs/architecture.md).

## Docs

- [Architecture](docs/architecture.md)
- [v2 data template](docs/data-template-v2.md)
- [CLI reference](docs/cli-reference.md)
- [Design decisions](docs/design-decisions.md)
- [FAQ](docs/faq.md)
- [Governance](GOVERNANCE.md)
- [Roadmap](ROADMAP.md)

## License

MIT — see [LICENSE](LICENSE). Third-party licenses: [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
