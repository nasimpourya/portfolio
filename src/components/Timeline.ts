import type { ProjectManifest } from "../data/types.ts";
import { formatDate, yearOf } from "../utils/dates.ts";

/**
 * Timeline component (TASK-018): renders one marker per manifest entry,
 * newest first (manifest order). Markers are buttons so they are keyboard
 * operable; the state model (TASK-023) supplies the selection callback.
 *
 * Each item is a node on a horizontal rail: thumbnails alternate above
 * and below it (`data-side`), joined by a stem, with the date label on
 * the opposite side of the rail. Where consecutive projects cross a year
 * boundary, a decorative year tick (a separate, presentational li)
 * marks the transition on the rail. The geometry is all CSS and fixed
 * (never image-dependent), so layout measurements are final at render.
 *
 * The timeline itself stays in the DOM with zero projects — the designed
 * empty state (Section 6.1) takes over instead.
 */

export function renderTimeline(
  doc: Document,
  manifest: ProjectManifest,
  onSelect: (projectId: string) => void,
): void {
  const list = doc.getElementById("timeline");
  if (list === null) return;

  list.replaceChildren();

  const emptyState = doc.getElementById("empty-state");
  const isEmpty = manifest.projects.length === 0;
  if (emptyState !== null) {
    emptyState.hidden = !isEmpty;
  }
  if (isEmpty) return;

  for (const [index, project] of manifest.projects.entries()) {
    // Chronology beats at year boundaries: a tick labeled with the older
    // year (manifests are newest-first, so the current project's year).
    if (index > 0) {
      const year = yearOf(project.date);
      const previousYear = yearOf(manifest.projects[index - 1].date);
      if (year !== "" && year !== previousYear) {
        list.append(createYearTick(doc, index, year));
      }
    }
    list.append(createMarker(doc, project, index, onSelect));
  }
}

function createMarker(
  doc: Document,
  project: ProjectManifest["projects"][number],
  index: number,
  onSelect: (projectId: string) => void,
): HTMLLIElement {
  const item = doc.createElement("li");
  item.className = "timeline__item";
  item.dataset.projectId = project.id;
  // Zigzag: newest (index 0) rides above the rail, then alternate.
  item.dataset.side = index % 2 === 0 ? "above" : "below";
  // Staggered entrance (timeline.css): each marker enters 45ms later.
  item.style.setProperty("--timeline-index", String(index));

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "timeline__marker";
  // The description is screen-reader-visible without needing hover.
  button.setAttribute("aria-label", `${formatDate(project.date)} — ${project.description}`);

  const image = doc.createElement("img");
  image.className = "timeline__image";
  image.src = project.featuredImage;
  image.alt = ""; // decorative; the aria-label carries the meaning
  // Featured images lazy-load off-screen (Section 8.4) — the timeline
  // renders every marker up front, so distant thumbnails defer their
  // downloads. setAttribute so the state is observable even where the
  // property is not reflected (matches the gallery's approach).
  image.setAttribute("loading", "lazy");
  image.decoding = "async";
  // Graceful fallback for broken featured images (Section 6.1).
  image.addEventListener("error", () => {
    item.classList.add("timeline__item--image-failed");
  });

  // The date sits beside the item on the rail (across from its
  // thumbnail), outside the button: hover cards anchor the button, so
  // its box must stay exactly the thumbnail box.
  const date = doc.createElement("span");
  date.className = "timeline__date";
  date.textContent = formatDate(project.date);

  button.append(image);
  button.addEventListener("click", () => onSelect(project.id));
  item.append(button, date);
  return item;
}

/**
 * A decorative year marker between two projects of different years.
 * A separate li (never a span inside an item) so the ol's children
 * remain one-li-per-project for every `.timeline__item` selector and
 * `centerNewest`'s first-item lookup; `role="presentation"` +
 * `aria-hidden` keep the list semantics intact.
 */
function createYearTick(
  doc: Document,
  index: number,
  year: string,
): HTMLLIElement {
  const tick = doc.createElement("li");
  tick.className = "timeline__year";
  tick.setAttribute("role", "presentation");
  tick.setAttribute("aria-hidden", "true");
  // Share the entrance stagger with the project it precedes.
  tick.style.setProperty("--timeline-index", String(index));

  const label = doc.createElement("span");
  label.className = "timeline__year-label";
  label.textContent = year;
  tick.append(label);
  return tick;
}

/**
 * Active-marker state: visually distinct, one at a time (or none).
 * Unknown IDs clear the active state rather than throwing.
 */
export function setActiveMarker(doc: Document, projectId: string | null): void {
  const list = doc.getElementById("timeline");
  if (list === null) return;
  for (const item of list.querySelectorAll(".timeline__item[data-active]")) {
    item.removeAttribute("data-active");
  }
  if (projectId === null) return;
  // Project IDs are validated YYYY-MM-DD strings, so a direct dataset
  // comparison is safe (and avoids CSS.escape for older engines).
  const item = [...list.querySelectorAll(".timeline__item")].find(
    (element) => (element as HTMLElement).dataset.projectId === projectId,
  );
  item?.setAttribute("data-active", "true");
}

/**
 * Compute the scroll position that centers `item` in `container`
 * (TASK-019). Never negative: when the content is narrower than the
 * container, the timeline stays at its left edge.
 */
export function centeredScrollLeft(container: HTMLElement, item: HTMLElement): number {
  const target =
    item.offsetLeft - (container.clientWidth - item.offsetWidth) / 2;
  return Math.max(0, target);
}

/**
 * Center the newest project (the first marker) horizontally on initial
 * load (Section 6.1). Runs synchronously after render so the position is
 * set before first paint — no visible jump. Desktop only; the mobile
 * timeline is vertical (TASK-032). No-ops on an empty timeline.
 */
export function centerNewest(
  doc: Document,
  options: { isDesktop?: () => boolean } = {},
): void {
  const isDesktop = options.isDesktop ?? defaultIsDesktop;
  if (!isDesktop()) return;

  const container = doc.querySelector<HTMLElement>(".timeline-scroller");
  if (container === null) return;
  const newest = container.querySelector<HTMLElement>(".timeline__item");
  if (newest === null) return;

  // Marker dimensions are fixed in CSS (not image-dependent), so layout
  // measurements are already final here.
  container.scrollLeft = centeredScrollLeft(container, newest);
}

function defaultIsDesktop(): boolean {
  return window.matchMedia("(min-width: 1024px)").matches;
}

/**
 * Wheel/trackpad navigation (TASK-020, Section 6.2).
 *
 * - Native horizontal gestures (trackpad deltaX, shift+wheel) are left to
 *   the browser.
 * - Vertical wheel movement over the timeline is translated into timeline
 *   scrolling — but only while the timeline can still scroll in that
 *   direction, so the page keeps scrolling normally at the edges.
 * - The listener is passive:false only where we may call preventDefault.
 *
 * Returns a cleanup function (Section 8.3).
 */
export function enableWheelNavigation(container: HTMLElement): () => void {
  function onWheel(event: WheelEvent): void {
    // Horizontal gestures scroll natively; nothing to translate.
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;

    const atStart = container.scrollLeft <= 0;
    const atEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth;
    if ((event.deltaY < 0 && atStart) || (event.deltaY > 0 && atEnd)) {
      // Timeline is at its edge: hand the gesture back to page scrolling.
      return;
    }

    event.preventDefault();
    container.scrollLeft += event.deltaY;
  }

  container.addEventListener("wheel", onWheel, { passive: false });
  return () => container.removeEventListener("wheel", onWheel);
}

/**
 * Mouse drag scrolling (TASK-021, Section 6.2).
 *
 * - Desktop pointer only (`pointerType: "mouse"`); touch devices scroll
 *   the timeline natively.
 * - A movement threshold separates clicks from drags: a drag never
 *   activates a marker, a click always does.
 * - Move/release listeners live on window so releasing the pointer
 *   outside the timeline never leaves it stuck in a dragging state.
 * - Text selection and native image dragging are disabled on the
 *   timeline; image dragging would otherwise swallow pointer events.
 *
 * Returns a cleanup function (Section 8.3).
 */
export function enableDragScrolling(container: HTMLElement): () => void {
  const DRAG_THRESHOLD_PX = 5;
  let activePointerId: number | null = null;
  let startX = 0;
  let startScrollLeft = 0;
  let dragging = false;
  let suppressNextClick = false;

  function onPointerDown(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || event.pointerType !== "mouse") {
      return;
    }
    activePointerId = event.pointerId;
    startX = event.clientX;
    startScrollLeft = container.scrollLeft;
    dragging = false;
    // A new press always starts fresh: a drag released outside the
    // timeline fires no click, so the flag must not survive into the
    // next interaction.
    suppressNextClick = false;
    container.classList.add("timeline--dragging");
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    const dx = event.clientX - startX;
    if (!dragging && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    dragging = true;
    container.scrollLeft = startScrollLeft - dx;
  }

  function finishDrag(): void {
    if (activePointerId === null) return;
    suppressNextClick = dragging;
    activePointerId = null;
    dragging = false;
    container.classList.remove("timeline--dragging");
  }

  function onClickCapture(event: MouseEvent): void {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    // A drag must never activate a marker (Section 6.2).
    event.preventDefault();
    event.stopPropagation();
  }

  function onDragStart(event: Event): void {
    event.preventDefault();
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("click", onClickCapture, true);
  container.addEventListener("dragstart", onDragStart);
  // Move/up live on window so a drag that leaves the timeline still
  // scrolls, and a release outside it always ends the drag cleanly.
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", finishDrag);

  return () => {
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("click", onClickCapture, true);
    container.removeEventListener("dragstart", onDragStart);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);
    container.classList.remove("timeline--dragging");
  };
}
