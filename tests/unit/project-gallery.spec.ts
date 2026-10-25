// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  baseName,
  groupGalleryTiles,
  renderMosaic,
} from "../../src/components/ProjectGallery";
import { initProjectDetail } from "../../src/components/ProjectDetail";
import { resetTextAssetCache } from "../../src/services/text-assets";
import { createViewStateManager } from "../../src/services/view-state";
import type { Project, ProjectAsset } from "../../src/data/types";

const doc = document;

/**
 * Text content renders on the cards (TASK-041), so every gallery test
 * exercises real (stubbed) fetches. jsdom has no IntersectionObserver,
 * so lazy text fetching falls back to immediate starts — the same code
 * path the browser takes for in-view tiles. The module-level session
 * cache persists across tests: it is reset here and every test builds
 * assets under a unique path.
 */

let folderCounter = 0;

function asset(type: "image" | "text", name: string): ProjectAsset {
  folderCounter += 1;
  return {
    type,
    name,
    path: `projects/g${folderCounter}/${name}`,
    mimeType: type === "image" ? "image/png" : "text/plain",
  };
}

function project(assets: ProjectAsset[]): Project {
  return {
    id: "2026-01-01",
    date: "2026-01-01",
    description: "Test project",
    featuredImage: "projects/2026-01-01/0.webp",
    assets,
  };
}

/** Catch-all fetch so any rendered gallery can resolve its text. */
beforeEach(() => {
  resetTextAssetCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, text: async () => "default" }) as unknown as Response),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(responses: Record<string, string | Error>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      const response = responses[path];
      if (response instanceof Error) throw response;
      return { ok: true, status: 200, text: async () => response } as unknown as Response;
    }),
  );
}

describe("baseName", () => {
  it("strips the final extension only", () => {
    expect(baseName("notes.txt")).toBe("notes");
    expect(baseName("a.b.png")).toBe("a.b");
    expect(baseName("retrospective.markdown")).toBe("retrospective");
  });

  it("returns names without extensions unchanged", () => {
    expect(baseName("no-extension")).toBe("no-extension");
  });
});

describe("groupGalleryTiles (Section 4.3 pairing)", () => {
  it("creates one tile per unpaired asset, in manifest order", () => {
    const tiles = groupGalleryTiles(
      project([asset("image", "dashboard.png"), asset("text", "notes.txt")]),
    );
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toMatchObject({ kind: "image", imageIndex: 0, caption: null });
    expect(tiles[1]).toMatchObject({ kind: "text", assetIndex: 1 });
  });

  it("pairs a text asset with a same-basename image as a caption, not a tile", () => {
    const tiles = groupGalleryTiles(
      project([asset("image", "diagram.png"), asset("text", "diagram.txt")]),
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      kind: "image",
      imageIndex: 0,
      caption: { name: "diagram.txt", type: "text" },
    });
  });

  it("pairs case-insensitively on the basename across extensions", () => {
    const tiles = groupGalleryTiles(
      project([asset("image", "shot.webp"), asset("text", "shot.markdown")]),
    );
    expect(tiles[0]).toMatchObject({ kind: "image", caption: { name: "shot.markdown" } });
  });

  it("each text asset captions at most one image; unpaired candidates stay text tiles", () => {
    const tiles = groupGalleryTiles(
      project([
        asset("image", "a.png"),
        asset("text", "a.txt"),
        asset("image", "b.png"),
        asset("text", "a.md"),
      ]),
    );
    // a.txt pairs with a.png (same basename "a"); a.md and b.png have no
    // partner, so a.md stays a text tile and b.png is captionless.
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toMatchObject({ kind: "image", imageIndex: 0, caption: { name: "a.txt" } });
    expect(tiles[1]).toMatchObject({ kind: "image", imageIndex: 2, caption: null });
    expect(tiles[2]).toMatchObject({ kind: "text", assetIndex: 3 });
  });

  it("a text asset before its image still pairs (order-independent captions)", () => {
    const tiles = groupGalleryTiles(
      project([asset("text", "data.txt"), asset("image", "data.png")]),
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ kind: "image", imageIndex: 1, caption: { name: "data.txt" } });
  });
});

describe("mosaic size cycle (TASK-028)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main><section id="project-detail"><div id="mosaic" class="mosaic"></div></section></main>
    `;
  });

  it("assigns size classes on a fixed deterministic cycle", () => {
    renderMosaic(
      doc,
      project([asset("image", "a.png"), asset("image", "b.png"), asset("image", "c.png"), asset("image", "d.png"), asset("image", "e.png"), asset("image", "f.png")]),
      { onOpenImage: () => {} },
    );
    const sizes = [...doc.querySelectorAll("#mosaic .mosaic__tile")].map((tile) =>
      [...tile.classList]
        .find((cls) => cls.startsWith("mosaic__tile--") && !cls.endsWith("--image")),
    );
    // large, small, medium, medium, full, then the cycle repeats.
    expect(sizes).toEqual([
      "mosaic__tile--large",
      "mosaic__tile--small",
      "mosaic__tile--medium",
      "mosaic__tile--medium",
      "mosaic__tile--full",
      "mosaic__tile--large",
    ]);
  });

  it("text tiles cycle their own widths independently of images", () => {
    renderMosaic(
      doc,
      project([asset("text", "a.txt"), asset("text", "b.md"), asset("text", "c.txt")]),
      { onOpenImage: () => {} },
    );
    const sizes = [...doc.querySelectorAll("#mosaic .mosaic__tile")].map((tile) =>
      [...tile.classList].find((cls) => cls.endsWith("--wide") || cls.endsWith("--narrow")),
    );
    expect(sizes).toEqual(["mosaic__tile--wide", "mosaic__tile--narrow", "mosaic__tile--wide"]);
  });

  it("the same project renders the identical composition on re-render", () => {
    const testProject = project([asset("image", "a.png"), asset("text", "b.txt"), asset("image", "c.png")]);
    const handlers = { onOpenImage: () => {} };
    renderMosaic(doc, testProject, handlers);
    const first = [...doc.querySelectorAll("#mosaic .mosaic__tile")].map((t) => t.className);
    renderMosaic(doc, testProject, handlers);
    const second = [...doc.querySelectorAll("#mosaic .mosaic__tile")].map((t) => t.className);
    expect(second).toEqual(first);
  });
});

describe("renderMosaic (TASK-027, text on cards TASK-041)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main><section id="project-detail"><div id="mosaic" class="mosaic"></div></section></main>
    `;
  });

  it("image tiles are interactive buttons; text tiles are non-interactive articles", () => {
    renderMosaic(
      doc,
      project([asset("image", "dashboard.png"), asset("text", "notes.txt")]),
      { onOpenImage: () => {} },
    );
    const tiles = doc.querySelectorAll("#mosaic .mosaic__tile");
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.querySelector("button.mosaic__frame")).toBeInstanceOf(HTMLButtonElement);
    // The text card is a reading surface: an <article> with no button,
    // no tab stop, and no activation semantics (Section 7).
    expect(tiles[1]).toBeInstanceOf(HTMLElement);
    expect(tiles[1]!.tagName).toBe("ARTICLE");
    expect(tiles[1]!.querySelector("button")).toBeNull();
    expect(tiles[1]!.getAttribute("tabindex")).toBeNull();
  });

  it("labels image tiles with aria-labels; text cards carry no filename label", () => {
    renderMosaic(doc, project([asset("image", "dashboard.png"), asset("text", "notes.txt")]), {
      onOpenImage: () => {},
    });
    const frame = doc.querySelector("#mosaic .mosaic__frame")!;
    expect(frame.getAttribute("aria-label")).toBe("Open image dashboard.png");
    // The card shows content only — no filename header (TASK-041
    // follow-up); the name surfaces just once, in the failure state.
    const tile = doc.querySelector("#mosaic .mosaic__tile--text")!;
    expect(tile.querySelector(".mosaic__file-name")).toBeNull();
    expect(tile.getAttribute("aria-label")).toBeNull();
  });

  it("points images at the deployed path with honest alt text", () => {
    renderMosaic(doc, project([asset("image", "dashboard.png")]), {
      onOpenImage: () => {},
    });
    const image = doc.querySelector<HTMLImageElement>("#mosaic img")!;
    expect(image.getAttribute("src")).toMatch(/dashboard\.png$/);
    expect(image.alt).toBe("dashboard.png");
  });

  it("lazy-loads later images but keeps the first eager (Section 8.4)", () => {
    renderMosaic(
      doc,
      project([asset("image", "a.png"), asset("image", "b.png"), asset("image", "c.png")]),
      { onOpenImage: () => {} },
    );
    const images = [...doc.querySelectorAll<HTMLImageElement>("#mosaic img")];
    expect(images.map((image) => image.getAttribute("loading"))).toEqual([
      "eager",
      "lazy",
      "lazy",
    ]);
  });

  it("renders a paired caption beneath its image, not as a separate tile", async () => {
    const [image, caption] = [asset("image", "dashboard.png"), asset("text", "dashboard.txt")];
    stubFetch({ [caption.path]: "paired caption body" });
    renderMosaic(doc, project([image, caption]), { onOpenImage: () => {} });
    const tiles = doc.querySelectorAll("#mosaic .mosaic__tile");
    expect(tiles).toHaveLength(1); // caption is not a tile
    const captionElement = tiles[0]!.querySelector(".mosaic__caption")!;
    await vi.waitFor(() =>
      expect(captionElement.querySelector(".mosaic__text")!.textContent).toBe(
        "paired caption body",
      ),
    );
    // Caption text is untrusted content: textContent only, never markup.
    const host = captionElement.querySelector(".mosaic__text")!;
    expect(host.firstElementChild).toBeNull();
    expect(host.classList.contains("mosaic__text--plain")).toBe(true);
  });

  it("renders plain .txt content on the tile", async () => {
    const text = asset("text", "notes.txt");
    stubFetch({ [text.path]: "plain body\nsecond line" });
    renderMosaic(doc, project([text]), { onOpenImage: () => {} });
    const host = doc.querySelector<HTMLElement>("#mosaic .mosaic__tile--text .mosaic__text")!;
    await vi.waitFor(() => expect(host.textContent).toBe("plain body\nsecond line"));
    expect(host.classList.contains("mosaic__text--plain")).toBe(true);
    expect(host.classList.contains("mosaic__text--loading")).toBe(false);
    expect(host.firstElementChild).toBeNull();
  });

  it("renders .md content through the markdown renderer, shifted under the date heading", async () => {
    const text = asset("text", "notes.md");
    stubFetch({ [text.path]: "# Title\n\n**bold** and *em*" });
    renderMosaic(doc, project([text]), { onOpenImage: () => {} });
    const host = doc.querySelector<HTMLElement>("#mosaic .mosaic__tile--text .mosaic__text")!;
    await vi.waitFor(() => expect(host.querySelector("h3")).not.toBeNull());
    expect(host.querySelector("h3")!.textContent).toBe("Title");
    expect(host.querySelector("strong")!.textContent).toBe("bold");
    expect(host.querySelector("em")!.textContent).toBe("em");
    expect(host.classList.contains("mosaic__text--plain")).toBe(false);
  });

  it("renders .markdown captions as formatted content too", async () => {
    const [image, caption] = [asset("image", "shot.webp"), asset("text", "shot.markdown")];
    stubFetch({ [caption.path]: "## Caption *note*" });
    renderMosaic(doc, project([image, caption]), { onOpenImage: () => {} });
    const host = doc.querySelector<HTMLElement>("#mosaic .mosaic__caption .mosaic__text")!;
    await vi.waitFor(() => expect(host.querySelector("h4")).not.toBeNull());
    expect(host.querySelector("em")!.textContent).toBe("note");
  });

  it("HTML-like content is never markup (Section 8.1)", async () => {
    const payload = '<script>alert("x")<\/script><img src=x onerror="alert(1)"><b>bold</b>';
    const plain = asset("text", "plain.txt");
    stubFetch({ [plain.path]: payload });
    renderMosaic(doc, project([plain]), { onOpenImage: () => {} });
    const host = doc.querySelector<HTMLElement>("#mosaic .mosaic__tile--text .mosaic__text")!;
    await vi.waitFor(() => expect(host.textContent).toBe(payload));
    expect(host.firstElementChild).toBeNull();
    expect(doc.querySelector("#mosaic script")).toBeNull();
    expect(doc.querySelector("#mosaic img[onerror]")).toBeNull();
  });

  it("a failed text fetch degrades its own tile and leaves the gallery intact", async () => {
    const [image, text] = [asset("image", "fine.png"), asset("text", "broken.txt")];
    stubFetch({ [text.path]: new Error("network down") });
    renderMosaic(doc, project([image, text]), { onOpenImage: () => {} });
    const host = doc.querySelector<HTMLElement>("#mosaic .mosaic__tile--text .mosaic__text")!;
    await vi.waitFor(() => expect(host.classList.contains("mosaic__text--failed")).toBe(true));
    expect(host.textContent).toBe("broken.txt — unavailable");
    // The image tile is unaffected.
    expect(doc.querySelectorAll("#mosaic .mosaic__frame")).toHaveLength(1);
    expect(host.closest(".mosaic__tile")!.classList.contains("mosaic__tile--image-failed")).toBe(false);
  });

  it("a failed caption degrades alone; the image tile stays intact", async () => {
    const [image, caption] = [asset("image", "dashboard.png"), asset("text", "dashboard.txt")];
    stubFetch({ [caption.path]: new Error("missing") });
    renderMosaic(doc, project([image, caption]), { onOpenImage: () => {} });
    const captionElement = doc.querySelector<HTMLElement>("#mosaic .mosaic__caption")!;
    await vi.waitFor(() =>
      expect(captionElement.classList.contains("mosaic__caption--failed")).toBe(true),
    );
    expect(captionElement.querySelector(".mosaic__text")!.textContent).toBe(
      "dashboard.txt — unavailable",
    );
    const figure = captionElement.closest(".mosaic__tile")!;
    expect(figure.classList.contains("mosaic__tile--image-failed")).toBe(false);
    expect(figure.querySelector("img")).not.toBeNull();
  });

  it("a fetch resolving after a re-render never writes to the detached tile", async () => {
    const text = asset("text", "slow.txt");
    let resolveFetch: (body: string) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = (body: string) =>
            resolve({ ok: true, status: 200, text: async () => body } as unknown as Response);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const handlers = { onOpenImage: () => {} };
    renderMosaic(doc, project([text]), handlers);
    const detachedHost = doc.querySelector<HTMLElement>("#mosaic .mosaic__text")!;
    expect(detachedHost.textContent).toBe("Loading…");

    renderMosaic(doc, project([text]), handlers); // project switch re-renders
    const liveHost = doc.querySelector<HTMLElement>("#mosaic .mosaic__text")!;
    expect(liveHost).not.toBe(detachedHost);

    // loadTextAsset defers the fetch call to a microtask; wait for it
    // to actually be issued before resolving it.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    resolveFetch("late content");
    await vi.waitFor(() => expect(liveHost.textContent).toBe("late content"));
    // The detached tile was never touched by the resolved fetch.
    expect(detachedHost.isConnected).toBe(false);
    expect(detachedHost.textContent).toBe("Loading…");
  });

  it("re-rendering serves the same asset from the session cache (Section 6.7)", async () => {
    const text = asset("text", "cached.txt");
    const fetchMock = vi.fn(async () =>
      ({ ok: true, status: 200, text: async () => "cached body" }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const handlers = { onOpenImage: () => {} };
    renderMosaic(doc, project([text]), handlers);
    await vi.waitFor(() =>
      expect(doc.querySelector("#mosaic .mosaic__text")!.textContent).toBe("cached body"),
    );
    renderMosaic(doc, project([text]), handlers);
    await vi.waitFor(() =>
      expect(doc.querySelector("#mosaic .mosaic__text")!.textContent).toBe("cached body"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a broken image degrades its own tile and leaves the gallery intact", () => {
    renderMosaic(doc, project([asset("image", "broken.png"), asset("image", "fine.png")]), {
      onOpenImage: () => {},
    });
    const images = [...doc.querySelectorAll<HTMLImageElement>("#mosaic img")];
    images[0]!.dispatchEvent(new Event("error"));
    const figure = doc.querySelectorAll("#mosaic .mosaic__tile")[0]!;
    expect(figure.classList.contains("mosaic__tile--image-failed")).toBe(true);
    expect(figure.querySelector(".mosaic__fallback")?.textContent).toContain("broken.png");
    // The second tile is unaffected.
    expect(doc.querySelectorAll("#mosaic .mosaic__frame")).toHaveLength(2);
  });

  it("image tile clicks pass the asset index into project.assets", () => {
    const opened: number[] = [];
    renderMosaic(
      doc,
      project([asset("text", "notes.txt"), asset("image", "a.png"), asset("image", "b.png")]),
      { onOpenImage: (index) => opened.push(index) },
    );
    const frames = doc.querySelectorAll("#mosaic .mosaic__frame");
    (frames[0] as HTMLButtonElement).click(); // a.png — index 1 in project.assets
    (frames[1] as HTMLButtonElement).click(); // b.png — index 2
    expect(opened).toEqual([1, 2]);
  });

  it("is idempotent: re-rendering never duplicates tiles", () => {
    const handlers = { onOpenImage: () => {} };
    const testProject = project([asset("image", "a.png")]);
    renderMosaic(doc, testProject, handlers);
    renderMosaic(doc, testProject, handlers);
    expect(doc.querySelectorAll("#mosaic .mosaic__tile")).toHaveLength(1);
  });

  it("an empty asset list renders an empty mosaic without error", () => {
    expect(() => renderMosaic(doc, project([]), { onOpenImage: () => {} })).not.toThrow();
    expect(doc.getElementById("mosaic")!.childElementCount).toBe(0);
  });
});

describe("gallery wiring through the state model", () => {
  const testProject = project([
    asset("image", "dashboard.png"),
    asset("text", "dashboard.txt"),
    asset("text", "notes.txt"),
  ]);

  beforeEach(() => {
    document.body.innerHTML = `
      <header id="intro"></header>
      <main>
        <section id="project-detail" hidden aria-labelledby="project-date">
          <div class="project-detail__header">
            <h2 id="project-date" tabindex="-1"></h2>
            <button id="close-project" type="button" aria-label="Close project and return to timeline"></button>
          </div>
          <div id="mosaic" class="mosaic"></div>
        </section>
      </main>
      <nav><div class="timeline-scroller"><ol id="timeline"></ol></div></nav>
      <div id="timeline-hover-card" data-visible="false"></div>
    `;
    document.body.dataset.mode = "overview";
  });

  /** Wiring as in initProjectDetail's subscription. */
  function setup() {
    const state = createViewStateManager([testProject.id]);
    const card = doc.getElementById("timeline-hover-card") as HTMLElement;
    initProjectDetail(doc, state, [testProject], card);
    return state;
  }

  it("opening a project renders its tiles; image tile clicks transition the state model", () => {
    const state = setup();
    state.openProject(testProject.id);
    expect(doc.querySelectorAll("#mosaic .mosaic__tile")).toHaveLength(2); // image tile (with caption) + text tile

    (doc.querySelector("#mosaic .mosaic__frame") as HTMLButtonElement).click();
    expect(state.get()).toEqual({ mode: "image", projectId: testProject.id, assetIndex: 0 });
  });

  it("switching projects re-renders the mosaic without duplication", () => {
    const state = setup();
    state.openProject(testProject.id);
    state.openProject(testProject.id); // repeated activation
    expect(doc.querySelectorAll("#mosaic .mosaic__tile")).toHaveLength(2);
    // Close: the overview hides the region; no stale tiles remain.
    state.closeProject();
    expect(doc.getElementById("project-detail")?.hidden).toBe(true);
  });
});
