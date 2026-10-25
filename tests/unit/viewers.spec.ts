// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initImageViewer } from "../../src/components/ImageViewer";
import { renderMosaic } from "../../src/components/ProjectGallery";
import { resetTextAssetCache } from "../../src/services/text-assets";
import { createViewStateManager, type ViewStateManager } from "../../src/services/view-state";
import type { Project, ProjectAsset } from "../../src/data/types";

const doc = document;

function asset(type: "image" | "text", name: string): ProjectAsset {
  return { type, name, path: `projects/2026-01-01/${name}`, mimeType: "image/png" };
}

const testProject: Project = {
  id: "2026-01-01",
  date: "2026-01-01",
  description: "Test project",
  featuredImage: "projects/2026-01-01/0.webp",
  assets: [asset("image", "a.png"), asset("text", "a.txt"), asset("text", "notes.txt"), asset("image", "b.png")],
};

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
  // Text content renders on the gallery cards (TASK-041), so any
  // rendered gallery issues text fetches; stub them deterministically.
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
  dialog.show = function show() {
    this.setAttribute("open", "");
  };
  dialog.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

function setup(): { state: ViewStateManager } {
  const state = createViewStateManager([testProject.id]);
  initImageViewer(doc, state, [testProject]);
  renderMosaic(doc, testProject, {
    onOpenImage: (index) => state.openImage(testProject.id, index),
  });
  return { state };
}

describe("image viewer (TASK-029)", () => {
  it("opens the correct image, modally, with honest alt text", () => {
    const { state } = setup();
    state.openProject(testProject.id);
    (doc.querySelectorAll("#mosaic .mosaic__frame")[1] as HTMLButtonElement).click(); // b.png
    const dialog = doc.getElementById("image-viewer") as HTMLDialogElement;
    expect(state.get()).toEqual({ mode: "image", projectId: testProject.id, assetIndex: 3 });
    expect(dialog.open).toBe(true);
    const image = doc.querySelector<HTMLImageElement>("#image-viewer-img")!;
    expect(image.getAttribute("src")).toBe("projects/2026-01-01/b.png");
    expect(image.alt).toBe("b.png");
  });

  it("the close button returns to the project detail and restores tile focus", () => {
    const { state } = setup();
    state.openProject(testProject.id);
    const frame = doc.querySelector("#mosaic .mosaic__frame") as HTMLButtonElement;
    frame.focus(); // jsdom's click() does not move focus; browsers do
    frame.click();
    (doc.querySelector("#image-viewer .viewer__close") as HTMLButtonElement).click();
    expect(state.get()).toEqual({ mode: "project", projectId: testProject.id });
    expect((doc.getElementById("image-viewer") as HTMLDialogElement).open).toBe(false);
    expect(doc.activeElement).toBe(frame);
  });

  it("a dialog dismissal (Escape's close event) syncs the state model", () => {
    const { state } = setup();
    state.openProject(testProject.id);
    (doc.querySelector("#mosaic .mosaic__frame") as HTMLButtonElement).click();
    (doc.getElementById("image-viewer") as HTMLDialogElement).close(); // what Escape triggers
    expect(state.get()).toEqual({ mode: "project", projectId: testProject.id });
  });

  it("clicking the backdrop closes; clicking the image does not", () => {
    const { state } = setup();
    state.openProject(testProject.id);
    (doc.querySelector("#mosaic .mosaic__frame") as HTMLButtonElement).click();
    const dialog = doc.getElementById("image-viewer") as HTMLDialogElement;
    dialog.querySelector("#image-viewer-img")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(state.get().mode).toBe("image"); // image click never closes
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true })); // target === dialog
    expect(state.get().mode).toBe("project");
  });

  it("arrow navigation cycles the project's images", () => {
    const { state } = setup();
    state.openProject(testProject.id);
    (doc.querySelector("#mosaic .mosaic__frame") as HTMLButtonElement).click(); // a.png (index 0)
    const next = doc.querySelector("#image-next") as HTMLButtonElement;
    const prev = doc.querySelector("#image-prev") as HTMLButtonElement;
    expect(next.disabled).toBe(false); // two images: navigation available
    next.click();
    expect(state.get()).toMatchObject({ mode: "image", assetIndex: 3 }); // b.png
    next.click();
    expect(state.get()).toMatchObject({ assetIndex: 0 }); // wraps to a.png
    prev.click();
    expect(state.get()).toMatchObject({ assetIndex: 3 });
  });

  it("a single-image project disables navigation", () => {
    const state = createViewStateManager([testProject.id]);
    const single: Project = { ...testProject, assets: [asset("image", "only.png")] };
    initImageViewer(doc, state, [single]);
    state.openProject(single.id);
    state.openImage(single.id, 0);
    expect((doc.querySelector("#image-prev") as HTMLButtonElement).disabled).toBe(true);
    expect((doc.querySelector("#image-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a failed image shows a fallback and the viewer still closes", () => {
    const { state } = setup();
    state.openProject(testProject.id);
    (doc.querySelector("#mosaic .mosaic__frame") as HTMLButtonElement).click();
    const dialog = doc.getElementById("image-viewer") as HTMLDialogElement;
    const image = doc.querySelector<HTMLImageElement>("#image-viewer-img")!;
    image.dispatchEvent(new Event("error"));
    expect(dialog.classList.contains("image-viewer--failed")).toBe(true);
    (dialog.querySelector(".viewer__close") as HTMLButtonElement).click();
    expect(state.get().mode).toBe("project"); // closed normally
  });

  it("closing the whole project from the viewer lands in the overview without tile focus", () => {
    const { state } = setup();
    state.openProject(testProject.id);
    (doc.querySelector("#mosaic .mosaic__frame") as HTMLButtonElement).click();
    state.closeProject();
    expect(state.get()).toEqual({ mode: "overview" });
    expect((doc.getElementById("image-viewer") as HTMLDialogElement).open).toBe(false);
  });
});
