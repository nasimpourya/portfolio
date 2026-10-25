// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initImageViewer } from "../../src/components/ImageViewer";
import { initProjectDetail } from "../../src/components/ProjectDetail";
import { resetTextAssetCache } from "../../src/services/text-assets";
import { initTransitions } from "../../src/services/navigation";
import { createViewStateManager, type ViewStateManager } from "../../src/services/view-state";
import { renderTimeline } from "../../src/components/Timeline";
import type { Project, ProjectAsset } from "../../src/data/types";

/**
 * Overlay/transition coordination (TASK-031): the full wiring as in
 * main.ts — detail region, the image viewer, gallery rendering, and
 * the TASK-025 choreography on one state model — exercised across the
 * nested states of Section 6.10. Interrupted and interleaved
 * transitions must always resolve to one unambiguous state (Section
 * 6.8) with no duplicated regions, stale overlays, or repeated scrolls.
 * (The text viewer half moved onto the gallery cards in TASK-041.)
 */

const doc = document;

function asset(type: "image" | "text", name: string): ProjectAsset {
  return { type, name, path: `projects/${name}`, mimeType: "image/png" };
}

const projects: Project[] = [
  {
    id: "2026-12-03",
    date: "2026-12-03",
    description: "Newest project",
    featuredImage: "projects/2026-12-03/0.webp",
    assets: [asset("image", "a.png"), asset("text", "notes.txt")],
  },
  {
    id: "2026-11-20",
    date: "2026-11-20",
    description: "Older project",
    featuredImage: "projects/2026-11-20/0.webp",
    assets: [asset("image", "b.png"), asset("image", "c.png")],
  },
];

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
    <dialog id="image-viewer" class="viewer image-viewer" aria-label="Image viewer">
      <button class="viewer__close" type="button" aria-label="Close image viewer"></button>
      <img id="image-viewer-img" alt="" />
      <nav class="viewer__nav" aria-label="Image navigation">
        <button id="image-prev" type="button" aria-label="Previous image"></button>
        <button id="image-next" type="button" aria-label="Next image"></button>
      </nav>
    </dialog>
  `;
  document.body.dataset.mode = "overview";
  shimDialogs();
  // Gallery cards fetch their text content (TASK-041); stub every
  // fetch deterministically (failures are cached, so a wrong body is
  // quieter than a missing stub).
  resetTextAssetCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, text: async () => "card text" }) as unknown as Response),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** jsdom implements no <dialog> methods; shim the modal bits the components rely on. */
function shimDialogs() {
  const dialog = document.getElementById("image-viewer") as HTMLDialogElement;
  dialog.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  dialog.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

/**
 * Full main.ts wiring (minus the empty-project guards): detail region,
 * the image viewer, gallery rendering on activation, and the
 * choreography with a scroll spy. Returns the state and the recorded
 * scroll targets.
 */
function setup() {
  const state = createViewStateManager(projects.map((project) => project.id));
  const scrolls: number[] = [];
  const card = doc.getElementById("timeline-hover-card") as HTMLElement;
  initProjectDetail(doc, state, projects, card);
  initImageViewer(doc, state, projects);
  initTransitions(doc, state, (top) => scrolls.push(top));
  renderTimeline(doc, { schemaVersion: 1, projects }, (id) => {
    state.openProject(id);
  });
  return { state, scrolls };
}

const imageView = () => doc.getElementById("image-viewer") as HTMLDialogElement;

function openFirstImage(state: ViewStateManager): HTMLButtonElement {
  const frame = doc.querySelector("#mosaic .mosaic__frame") as HTMLButtonElement;
  frame.focus();
  frame.click();
  expect(state.get().mode).toBe("image");
  return frame;
}

describe("overlays and project detail share one state (TASK-031)", () => {
  it("closing an overlay returns to that project's detail, region intact", () => {
    const { state, scrolls } = setup();
    (doc.querySelector(".timeline__marker") as HTMLButtonElement).click();
    expect(state.get()).toEqual({ mode: "project", projectId: "2026-12-03" });
    scrolls.length = 0; // the overview→detail scroll already happened

    const frame = openFirstImage(state);
    imageView().close(); // what Escape triggers
    expect(state.get()).toEqual({ mode: "project", projectId: "2026-12-03" });
    expect(doc.getElementById("project-detail")?.hidden).toBe(false);
    expect(doc.activeElement).toBe(frame); // tile focus restored
    expect(doc.body.dataset.mode).toBe("project");
    expect(scrolls).toEqual([]); // viewer↔detail never re-scrolls (Section 6.4)
  });

  it("closing the project from a viewer dismisses the overlay and restores the overview", () => {
    const { state, scrolls } = setup();
    const marker = doc.querySelector(".timeline__marker") as HTMLButtonElement;
    marker.focus();
    marker.click();
    openFirstImage(state);
    scrolls.length = 0;

    state.closeProject();
    expect(state.get()).toEqual({ mode: "overview" });
    expect(imageView().open).toBe(false); // overlay closed, not orphaned
    expect(doc.getElementById("project-detail")?.hidden).toBe(true);
    expect(doc.body.dataset.mode).toBe("overview");
    expect(doc.activeElement).toBe(marker); // marker focus, not the tile's
    expect(scrolls).toEqual([0]); // one restore scroll, exactly once
  });

  it("selecting another marker from a viewer switches projects cleanly", () => {
    const { state } = setup();
    (doc.querySelector(".timeline__marker") as HTMLButtonElement).click();
    openFirstImage(state);

    (doc.querySelectorAll(".timeline__marker")[1] as HTMLButtonElement).click();
    expect(state.get()).toEqual({ mode: "project", projectId: "2026-11-20" });
    expect(imageView().open).toBe(false); // no stale overlay
    expect(doc.getElementById("project-date")?.textContent).toBe("Nov 20, 2026");
    expect(
      doc.querySelector('.timeline__item[data-project-id="2026-11-20"]')?.hasAttribute("data-active"),
    ).toBe(true);
    // The new project's mosaic replaced the old one — exactly one region.
    expect(doc.querySelectorAll("#mosaic")).toHaveLength(1);
    expect(doc.querySelectorAll("#mosaic .mosaic__frame")).toHaveLength(2); // b.png, c.png
    expect(doc.body.dataset.mode).toBe("project");
  });

  it("a close event after the state moved on is a no-op, not a conflict", () => {
    const { state } = setup();
    (doc.querySelector(".timeline__marker") as HTMLButtonElement).click();
    openFirstImage(state);
    state.closeProject(); // dialog closes via the viewer subscription...
    // ...and its own close event then fires; the state must stay overview.
    expect(state.get()).toEqual({ mode: "overview" });
    expect(imageView().open).toBe(false);
  });

  it("repeated open/close cycles leave exactly one of everything", () => {
    const { state } = setup();
    const marker = doc.querySelector(".timeline__marker") as HTMLButtonElement;
    marker.focus();
    marker.click();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      openFirstImage(state);
      (imageView().querySelector(".viewer__close") as HTMLButtonElement).click();
      expect(state.get()).toEqual({ mode: "project", projectId: "2026-12-03" });
    }
    state.closeProject();
    expect(state.get()).toEqual({ mode: "overview" });
    expect(doc.querySelectorAll("#project-detail")).toHaveLength(1);
    expect(doc.querySelectorAll(".timeline__item[data-active]")).toHaveLength(0);
    expect(doc.querySelectorAll("dialog[open]")).toHaveLength(0);
  });
});

describe("dialog focus wrap (TASK-034)", () => {
  it("wraps forward Tab at the last control back to the first", () => {
    const { state } = setup();
    state.openProject(projects[0]!.id);
    openFirstImage(state);
    const dialog = imageView();
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    buttons[buttons.length - 1]!.focus();
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(doc.activeElement).toBe(buttons[0]);
    expect(dialog.contains(doc.activeElement)).toBe(true);
  });

  it("wraps Shift+Tab at the first control back to the last", () => {
    const { state } = setup();
    state.openProject(projects[0]!.id);
    openFirstImage(state);
    const dialog = imageView();
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    buttons[0]!.focus();
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(doc.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it("skips disabled controls when wrapping (single-image viewer)", () => {
    const single: Project = { ...projects[0]!, assets: [projects[0]!.assets[0]!] };
    const state = createViewStateManager([single.id]);
    const card = doc.getElementById("timeline-hover-card") as HTMLElement;
    initProjectDetail(doc, state, [single], card);
    initImageViewer(doc, state, [single]);
    state.openProject(single.id);
    const frame = doc.querySelector("#mosaic .mosaic__frame") as HTMLButtonElement;
    frame.focus();
    frame.click();
    const dialog = imageView();
    // prev/next are disabled: the only wrap targets are close and itself.
    const enabled = [...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    expect(enabled).toHaveLength(1);
    enabled[0]!.focus();
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(doc.activeElement).toBe(enabled[0]); // stays put, never escapes
  });
});
