# nasim-portfolio

A date-driven portfolio website: a chronological timeline of projects,
deployed to GitHub Pages. See `IMPLEMENTATION_PLAN.md` for the full design.

## Setup

```bash
npm install
npm run check   # validate + test + build
```

Requires Node 24 (any recent Node with native TypeScript support works).

## Commands

| Command | What it does |
| --- | --- |
| `npm run validate` | Validates `content/profile.json` and everything under `projects/` |
| `npm run test` | Runs unit and integration tests (vitest) |
| `npm run build` | Builds the site into `dist/` |
| `npm run optimize` | Converts JPEG/PNG images to WebP ahead of a build (same pipeline the build runs) |
| `npm run check` | All of the above — what CI runs before deploying |

(There is no dev server: sources are native TypeScript, and the site is
previewed from the build output as shown below.)

## Previewing a build

`dist/index.html` needs HTTP for `<base>`/`fetch` (not `file://`):

```bash
npm run build
python3 -m http.server 8123 -d dist
# open http://127.0.0.1:8123
```

## Adding a project

1. Create a folder `projects/YYYY-MM-DD/` named with the project's date.
2. Add exactly one featured image named `0` with a supported image extension
   (`0.jpg`, `0.jpeg`, `0.png`, `0.webp`, `0.avif`, or `0.gif`).
3. Add a nonempty `0.txt` with a short description.
4. Add any other supported images (`.jpg/.jpeg/.png/.webp/.avif/.gif`) or
   text files (`.txt`, `.md`, `.markdown`) for the gallery. Text renders
   on the gallery cards: `.md`/`.markdown` formatted, `.txt` as plain
   text.
5. Run `npm run validate` and `npm run build`, then commit and push.

JPEG/PNG sources (`.jpg`, `.jpeg`, `.png`) are converted to WebP
automatically during `npm run build` — see [Image optimization](#image-optimization).
Commit the generated `.webp` files; the originals are moved to the
gitignored `original-images/` archive, so nothing large lands in git.

No source-code changes are needed for an ordinary new project.

## Image optimization

The build converts every `.jpg`/`.jpeg`/`.png` it discovers (project
images and the profile photo) to `.webp` in place:

- **Dimensions capped** at 1920px on the long edge (never upscaled),
  quality 82, EXIF rotation baked in, metadata stripped.
- **Originals are archived**, never deleted: each source moves to
  `original-images/` mirroring the tree (`original-images/<project-date>/`,
  `original-images/assets/`). That folder is gitignored and never
  deployed — the manifest is the allowlist for what lands in `dist/`.
- **Existing `.webp`/`.avif`/`.gif` files are untouched** (already web
  formats; gifs may be animated).
- **`content/profile.json` is rewritten** automatically when the profile
  photo converts, so `"image": "assets/profile.png"` becomes
  `assets/profile.webp` with all other fields and formatting preserved.

Conversion needs [ImageMagick](https://imagemagick.org) on `PATH`
(`brew install imagemagick` on macOS, `sudo apt-get install -y imagemagick`
on Ubuntu — CI installs it automatically). Trees with nothing to convert
skip the tool entirely, so a fully-WebP repository builds anywhere.

Two safety rules: a project conversion never overwrites an existing file
(`x.jpg` + `x.webp`, or `x.jpg` + `x.jpeg`, fails the build naming both
files); replacing the checked-in `assets/profile.webp` placeholder is the
one allowed overwrite. `npm run optimize` runs the same pipeline on its
own, reporting `0 image(s)` when there is nothing to do.

On the page, timeline thumbnails load lazily as you scroll (`loading="lazy"`),
and gallery images load when a project is opened (first tile eager, the
rest lazy) — only the profile photo and the initial viewport cost
bandwidth on load.

## Profile configuration

`content/profile.json`:

```json
{
  "name": "Your Name",
  "headline": "Engineer, builder, and curious human.",
  "intro": "A short introduction about who you are, what you build, and what interests you.",
  "image": "assets/profile.webp",
  "imageAlt": "Portrait of Your Name"
}
```

The image path is relative to the repository root and must point to a
supported image that exists. If you point it at a `.jpg`/`.png`, the
build converts the file to `assets/profile.webp` and rewrites the field
automatically — see [Image optimization](#image-optimization).

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) validates, tests, builds,
and publishes `dist/` on every push to `main`.

**Repository settings:** under Settings → Pages, set **Source** to
"GitHub Actions". The workflow declares the required
`pages: write` / `id-token: write` permissions itself.

**Base path:** the workflow builds with
`PORTFOLIO_BASE_PATH=/<repo-name>/`, matching the default
`https://<user>.github.io/<repo-name>/` URL. For a custom domain, change
that environment variable to an empty string (or pass `--base ""` locally)
and rebuild.
