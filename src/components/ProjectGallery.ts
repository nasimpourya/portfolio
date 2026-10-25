import type { Project, ProjectAsset } from "../data/types.ts";
import { loadTextAsset } from "../services/text-assets.ts";
import { isMarkdown, renderMarkdown } from "../utils/markdown.ts";

/**
 * Gallery asset rendering (TASK-027, Sections 4.3 and 6.5; text content
 * on cards TASK-041).
 *
 * Renders one tile per eligible manifest asset into #mosaic. The build
 * already guarantees the manifest contains only supported, existing
 * assets (0.txt and the featured image excluded), so the renderer's job
 * is faithful presentation and resilience: a broken image or a failed
 * text fetch degrades its own tile, never the gallery.
 *
 * A text file that shares an image's basename becomes that image's
 * caption (Section 4.3) rather than a separate tile. Both standalone
 * text tiles and captions render the file's content itself — `.md`/
 * `.markdown` formatted through the DOM-constructing renderer, other
 * text as plain text — fetched lazily as the tile scrolls into view
 * (Section 8.4).
 */

/** One composed tile: an image (optionally with a paired text caption), or a standalone text file. */
export type GalleryTile =
  | { kind: "image"; image: ProjectAsset; imageIndex: number; caption: ProjectAsset | null }
  | { kind: "text"; asset: ProjectAsset; assetIndex: number };

/** Basename without the final extension ("a.b.txt" → "a.b"). */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/**
 * Deterministic editorial composition (TASK-028, Section 6.5): tile
 * size classes repeat on fixed cycles, so the same project always
 * renders the same art-directed arrangement — varied sizes, occasional
 * full-width features, never per-render randomness.
 */
const IMAGE_SIZE_CYCLE = ["large", "small", "medium", "medium", "full"] as const;
const TEXT_SIZE_CYCLE = ["wide", "narrow"] as const;

/**
 * Group a project's assets into tiles, preserving the manifest's
 * deterministic filename order. A text asset pairs with the first
 * image sharing its basename — regardless of file order — and each
 * text asset captions at most one image; leftovers become text tiles.
 */
export function groupGalleryTiles(project: Project): GalleryTile[] {
  const imageBaseNames = new Set(
    project.assets
      .filter((asset) => asset.type === "image")
      .map((asset) => baseName(asset.name)),
  );
  // Pass 1: text assets sharing an image basename are caption candidates
  // (Section 4.3), so pairing works whether the text comes before or
  // after its image.
  const captionCandidates = new Set(
    project.assets.filter(
      (asset) => asset.type === "text" && imageBaseNames.has(baseName(asset.name)),
    ),
  );
  // Each candidate captions the first unused image with the same
  // basename; leftovers fall through as text tiles.
  const captionFor = new Map<ProjectAsset, ProjectAsset>();
  const usedCaptions = new Set<ProjectAsset>();
  for (const asset of project.assets) {
    if (asset.type !== "image" || !captionCandidates.size) continue;
    const caption =
      project.assets.find(
        (other) =>
          other.type === "text" &&
          captionCandidates.has(other) &&
          !usedCaptions.has(other) &&
          baseName(other.name) === baseName(asset.name),
      ) ?? null;
    if (caption !== null) {
      captionFor.set(asset, caption);
      usedCaptions.add(caption);
    }
  }

  const tiles: GalleryTile[] = [];
  project.assets.forEach((asset, assetIndex) => {
    if (asset.type === "text") {
      if (!usedCaptions.has(asset)) {
        tiles.push({ kind: "text", asset, assetIndex });
      }
      return;
    }
    tiles.push({
      kind: "image",
      image: asset,
      imageIndex: assetIndex,
      caption: captionFor.get(asset) ?? null,
    });
  });

  return tiles;
}

export type GalleryHandlers = {
  /** Activated with the image asset's index within project.assets. */
  onOpenImage: (assetIndex: number) => void;
};

/**
 * Lazy text fetching (TASK-041): one shared IntersectionObserver starts
 * each tile's fetch only when the tile scrolls into view, mirroring
 * `loading="lazy"` on images (Section 8.4). Environments without the
 * observer (jsdom) fetch immediately.
 */
let textObserver: IntersectionObserver | null = null;
const pendingTextFetches = new Map<Element, () => void>();

function fetchTextWhenVisible(target: Element, start: () => void): void {
  if (typeof IntersectionObserver === "undefined") {
    start();
    return;
  }
  if (textObserver === null) {
    textObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const pending = pendingTextFetches.get(entry.target);
        if (pending !== undefined) {
          pendingTextFetches.delete(entry.target);
          textObserver?.unobserve(entry.target);
          pending();
        }
      }
    });
  }
  pendingTextFetches.set(target, start);
  textObserver.observe(target);
}

/**
 * Populate #mosaic with `project`'s tiles. Clear-then-render: repeated
 * activation cannot duplicate the gallery, and the text observer is
 * disconnected first so a project switch can never fire a stale fetch
 * into a detached tile (Section 8.3).
 */
export function renderMosaic(
  doc: Document,
  project: Project,
  handlers: GalleryHandlers,
): void {
  const mosaic = doc.getElementById("mosaic");
  if (mosaic === null) return;

  textObserver?.disconnect();
  pendingTextFetches.clear();

  let renderedImage = false; // the first image loads eagerly
  let imageOrdinal = 0;
  let textOrdinal = 0;
  mosaic.replaceChildren(
    ...groupGalleryTiles(project).map((tile) => {
      if (tile.kind === "image") {
        const size = IMAGE_SIZE_CYCLE[imageOrdinal % IMAGE_SIZE_CYCLE.length]!;
        imageOrdinal += 1;
        const element = createImageTile(doc, tile, renderedImage, size, handlers);
        renderedImage = true;
        return element;
      }
      const size = TEXT_SIZE_CYCLE[textOrdinal % TEXT_SIZE_CYCLE.length]!;
      textOrdinal += 1;
      return createTextTile(doc, tile, size);
    }),
  );
}

/**
 * Fill a text host with the asset's fetched content (TASK-041): a
 * loading state first, then either the rendered markdown or a plain
 * text node. A failed fetch degrades only this host (Section 8.3).
 * Every async step re-checks `host.isConnected`, so a fetch resolving
 * after a re-render never writes into a detached tile.
 */
function fillTextContent(
  doc: Document,
  host: HTMLElement,
  asset: ProjectAsset,
  onFail?: () => void,
): void {
  host.classList.add("mosaic__text--loading");
  host.textContent = "Loading…";

  loadTextAsset(asset.path).then(
    (text) => {
      if (!host.isConnected) return;
      host.classList.remove("mosaic__text--loading");
      if (isMarkdown(asset.name)) {
        // Cards live under the h2 date heading; markdown headings slot
        // beneath it rather than competing with the page structure.
        host.replaceChildren(renderMarkdown(doc, text, { headingOffset: 2 }));
      } else {
        host.classList.add("mosaic__text--plain");
        host.textContent = text;
      }
    },
    () => {
      if (!host.isConnected) return;
      host.classList.remove("mosaic__text--loading");
      host.classList.add("mosaic__text--failed");
      host.textContent = `${asset.name} — unavailable`;
      onFail?.();
    },
  );
}

function createImageTile(
  doc: Document,
  tile: Extract<GalleryTile, { kind: "image" }>,
  alreadyRenderedImage: boolean,
  size: (typeof IMAGE_SIZE_CYCLE)[number],
  handlers: GalleryHandlers,
): HTMLElement {
  const figure = doc.createElement("figure");
  figure.className = `mosaic__tile mosaic__tile--image mosaic__tile--${size}`;

  const frame = doc.createElement("button");
  frame.type = "button";
  frame.className = "mosaic__frame";
  frame.setAttribute("aria-label", `Open image ${tile.image.name}`);

  const image = doc.createElement("img");
  image.className = "mosaic__image";
  image.src = tile.image.path;
  image.alt = tile.image.name; // the filename is the honest description
  image.decoding = "async";
  // Nonessential gallery images lazy-load (Section 8.4); the first tile
  // is usually in the initial viewport. setAttribute so the state is
  // observable even where the property is not reflected.
  image.setAttribute("loading", alreadyRenderedImage ? "lazy" : "eager");
  // A broken asset degrades to a labeled placeholder on its own tile
  // (Sections 6.5 and 8.3); the rest of the gallery is unaffected.
  image.addEventListener("error", () => {
    figure.classList.add("mosaic__tile--image-failed");
    const fallback = doc.createElement("span");
    fallback.className = "mosaic__fallback";
    fallback.textContent = `${tile.image.name} — image unavailable`;
    image.replaceWith(fallback);
  });

  frame.append(image);
  frame.addEventListener("click", () => handlers.onOpenImage(tile.imageIndex));
  figure.append(frame);

  const captionAsset = tile.caption;
  if (captionAsset !== null) {
    // A paired caption renders the text file's content beneath its
    // image (Section 4.3); only its own degradation touches the tile.
    const caption = doc.createElement("figcaption");
    caption.className = "mosaic__caption";
    const body = doc.createElement("div");
    body.className = "mosaic__text";
    caption.append(body);
    figure.append(caption);
    fetchTextWhenVisible(caption, () =>
      fillTextContent(doc, body, captionAsset, () =>
        caption.classList.add("mosaic__caption--failed"),
      ),
    );
  }
  return figure;
}

function createTextTile(
  doc: Document,
  tile: Extract<GalleryTile, { kind: "text" }>,
  size: (typeof TEXT_SIZE_CYCLE)[number],
): HTMLElement {
  // A text tile is a reading surface, not a control (TASK-041): the
  // content renders on the card, so there is nothing to activate —
  // no button, no tab stop (Section 7).
  const article = doc.createElement("article");
  article.className = `mosaic__tile mosaic__tile--text mosaic__tile--${size}`;

  // The card shows the content itself — no filename header (Section
  // 4.3 as amended for TASK-041, per user feedback). The filename
  // surfaces only in the failure state, where it is the file's sole
  // identification. Content is fetched lazily as the card scrolls
  // into view.
  const body = doc.createElement("div");
  body.className = "mosaic__text";
  article.append(body);
  fetchTextWhenVisible(article, () => fillTextContent(doc, body, tile.asset));
  return article;
}
