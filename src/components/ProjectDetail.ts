import type { Project } from "../data/types.ts";
import { formatDate } from "../utils/dates.ts";
import { hideHoverCard } from "./HoverCard.ts";
import { setActiveMarker } from "./Timeline.ts";
import { renderMosaic } from "./ProjectGallery.ts";
import type { ViewStateManager } from "../services/view-state.ts";

/**
 * Project detail region (TASK-024/026/027): opens a project from the
 * timeline by revealing #project-detail with the active date, renders
 * its gallery mosaic, and closes it back to the overview through the
 * state model — correct, duplicate-free selection and a repeatable,
 * focus-restoring close (Sections 6.4 and 6.8).
 */

/**
 * Reveal the detail region for `project` and move focus to its date
 * heading. Safe to call repeatedly: the mosaic is cleared, never
 * appended to.
 */
export function showProjectDetail(doc: Document, project: Project): void {
  const section = doc.getElementById("project-detail");
  if (section === null) return;
  section.hidden = false;

  const heading = doc.getElementById("project-date");
  if (heading !== null) {
    heading.textContent = formatDate(project.date);
    // preventScroll: the intro/timeline scroll choreography (TASK-025)
    // owns any document movement; focus must not fight it.
    heading.focus({ preventScroll: true });
  }

  // Clear-then-render: repeated activation cannot duplicate the gallery.
  doc.getElementById("mosaic")?.replaceChildren();
}

/** The timeline marker that currently has focus, if any. */
function focusedMarker(doc: Document): HTMLElement | null {
  const active = doc.activeElement;
  return active instanceof doc.defaultView!.HTMLElement &&
    active.classList.contains("timeline__marker")
    ? active
    : null;
}

/**
 * Subscribe the detail region to the view state and wire the close
 * control. Every project state activates its marker and reveals the
 * region (hiding the hover card so it never lingers over the mosaic,
 * TASK-022 note); the overview state hides the region, clears the
 * active marker, and returns focus to the marker the user last
 * activated (Sections 6.4 and 6.8).
 */
export function initProjectDetail(
  doc: Document,
  state: ViewStateManager,
  projects: readonly Project[],
  hoverCard: HTMLElement,
): () => void {
  let opener: HTMLElement | null = null;

  const unsubscribe = state.subscribe((next, previous) => {
    if (next.mode === "project") {
      const project = projects.find((candidate) => candidate.id === next.projectId);
      if (project === undefined) return; // defensive; ids are pre-validated
      // Returning from the same project's image viewer changes
      // nothing visually — the region, date, and mosaic are already
      // correct — and re-rendering here would detach the mosaic tile
      // that the viewer is about to restore focus to (Sections 6.6-6.8).
      const fromViewer =
        previous?.mode === "image" && previous.projectId === next.projectId;
      // Remember the marker the user activated so closing can restore
      // focus to it (Section 6.8) — captured before the date heading
      // takes focus.
      const marker = focusedMarker(doc);
      if (marker !== null) opener = marker;
      setActiveMarker(doc, next.projectId);
      if (!fromViewer) {
        showProjectDetail(doc, project);
        // Gallery image tiles open the viewer through the state model;
        // text renders on the cards themselves (TASK-041).
        renderMosaic(doc, project, {
          onOpenImage: (assetIndex) => state.openImage(next.projectId, assetIndex),
        });
      }
      hideHoverCard(hoverCard);
      return;
    }

    if (next.mode === "overview") {
      // Close: hide the region first so no stale detail survives
      // (Section 6.8), then restore focus. The overview scroll and
      // intro restore belong to the TASK-025 choreography.
      const target = opener;
      opener = null;
      target?.focus({ preventScroll: true });
      // Focus restore fires focusin, which would re-show the hover
      // card; for a pointer user it could never leave (the pointer
      // never enters the marker), so suppress it explicitly.
      hideHoverCard(hoverCard);
      const section = doc.getElementById("project-detail");
      if (section !== null) section.hidden = true;
      setActiveMarker(doc, null);
    }
  });

  // Close control (Section 6.8): repeatable and safe — closeProject is
  // a no-op outside detail/viewer states, so interrupted or repeated
  // activations resolve through one code path.
  doc.getElementById("close-project")?.addEventListener("click", () => {
    state.closeProject();
  });

  return unsubscribe;
}
