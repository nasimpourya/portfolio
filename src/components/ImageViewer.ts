import type { Project } from "../data/types.ts";
import type { ViewStateManager } from "../services/view-state.ts";
import { bindViewerDismissal, dismissViewer } from "./ViewerDialog.ts";

/**
 * Image viewer (TASK-029, Section 6.6): a modal dialog driven by the
 * state model's `image` mode. Opening populates the dialog with the
 * selected asset and shows it modally (background becomes inert);
 * closing routes through `closeOverlay` back to the project detail.
 *
 * Dismissal wiring (Escape, close button, backdrop) is the shared
 * ViewerDialog coordination (TASK-031): the dialog's `close` event is
 * the single source of truth, so state and DOM can never disagree.
 */

export function initImageViewer(
  doc: Document,
  state: ViewStateManager,
  projects: readonly Project[],
): () => void {
  const dialog = doc.getElementById("image-viewer");
  if (!(dialog instanceof HTMLDialogElement)) return () => {};

  const image = dialog.querySelector<HTMLImageElement>("#image-viewer-img");
  const closeButton = dialog.querySelector<HTMLButtonElement>(".viewer__close");
  const prevButton = dialog.querySelector<HTMLButtonElement>("#image-prev");
  const nextButton = dialog.querySelector<HTMLButtonElement>("#image-next");
  if (image === null) return () => {};

  // The gallery tile that opened the viewer; focus returns to it when
  // the overlay closes back into the project detail (Section 6.6).
  let opener: HTMLElement | null = null;

  /** Indices (within project.assets) of the project's image assets. */
  const imageIndices = (project: Project): number[] =>
    project.assets
      .map((asset, index) => (asset.type === "image" ? index : -1))
      .filter((index) => index !== -1);

  const show = (project: Project, assetIndex: number): void => {
    const asset = project.assets[assetIndex];
    if (asset === undefined || asset.type !== "image") return;

    // A press/click on a tile focuses it before the transition, so the
    // focused frame is the opener; keyboard activation behaves the same.
    const active = doc.activeElement;
    if (active instanceof HTMLElement && active.classList.contains("mosaic__frame")) {
      opener = active;
    }

    // Reset the fallback: each image gets a fresh chance to load.
    image.hidden = false;
    dialog.classList.remove("image-viewer--failed");
    image.src = asset.path;
    image.alt = asset.name;

    // Left/right navigation cycles this project's images (Section 6.6);
    // a single-image project disables the controls instead.
    const indices = imageIndices(project);
    const position = indices.indexOf(assetIndex);
    const canNavigate = indices.length > 1;
    if (prevButton !== null) prevButton.disabled = !canNavigate;
    if (nextButton !== null) nextButton.disabled = !canNavigate;
    if (canNavigate && prevButton !== null && nextButton !== null) {
      prevButton.onclick = () =>
        state.openImage(project.id, indices[(position - 1 + indices.length) % indices.length]!);
      nextButton.onclick = () =>
        state.openImage(project.id, indices[(position + 1) % indices.length]!);
    }

    if (!dialog.open) {
      dialog.showModal(); // background becomes inert: no background scrolling
      closeButton?.focus();
    }
  };

  const dismiss = (): void => dismissViewer(dialog);

  bindViewerDismissal(dialog, state, "image");

  // Arrow keys navigate while the dialog is open (Section 6.6).
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") prevButton?.click();
    if (event.key === "ArrowRight") nextButton?.click();
  });

  // A failed load shows a labeled fallback instead of a broken image;
  // the viewer itself remains fully closable (Section 6.6).
  image.addEventListener("error", () => {
    image.hidden = true;
    dialog.classList.add("image-viewer--failed");
  });

  const unsubscribe = state.subscribe((next, previous) => {
    if (next.mode === "image") {
      const project = projects.find((candidate) => candidate.id === next.projectId);
      if (project === undefined) return; // defensive; ids are pre-validated
      show(project, next.assetIndex);
      return;
    }
    if (previous?.mode === "image") {
      dismiss();
      // Focus returns to the opening tile only when returning to that
      // project's detail; the overview's focus target is the marker
      // (handled by the detail region's own subscription).
      if (next.mode === "project" && next.projectId === previous.projectId) {
        const target = opener;
        target?.focus({ preventScroll: true });
      }
      opener = null;
    }
  });

  return unsubscribe;
}
