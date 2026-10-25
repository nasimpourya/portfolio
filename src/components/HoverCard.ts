import type { Project } from "../data/types.ts";
import { formatDate } from "../utils/dates.ts";

/**
 * Custom hover cards (TASK-022, Section 6.3).
 *
 * One shared card element lives outside the timeline's scrolling
 * container, so the scroller's `overflow-x: auto` can never clip it
 * (Section 6.2). It is shown for a marker on mouse hover and on keyboard
 * focus, positioned in viewport coordinates near the marker, flipping
 * above/below and clamping horizontally to stay inside the viewport.
 *
 * The card is `aria-hidden`: each marker's `aria-label` already carries
 * the same date and description for assistive technology (Section 7),
 * so the card duplicates that information for sighted users only.
 *
 * All project text is untrusted (Section 8.1) and set via `textContent`.
 */

/** Viewport gap kept between the card and the viewport edges. */
export const HOVER_CARD_GAP_PX = 12;

/**
 * Grace period after the pointer leaves the marker before the card
 * hides. The card is purely informational (`pointer-events: none`), so
 * there is nothing to "move into" today; the delay simply keeps the
 * card from flickering while the pointer crosses the marker's
 * sub-elements or an adjacent gap.
 */
const HIDE_DELAY_MS = 150;

export type CardPlacement = "above" | "below";

/** A computed fixed-position location for the card. */
export type CardPosition = { left: number; top: number; placement: CardPlacement };

/**
 * Position the card near a marker (pure computation for unit tests):
 * below the marker when the viewport has room, otherwise above; always
 * clamped so the card never leaves the viewport (Section 6.3).
 */
export function computeCardPosition(
  anchor: { left: number; top: number; width: number; height: number; bottom: number },
  cardSize: { width: number; height: number },
  viewport: { width: number; height: number },
  gap: number = HOVER_CARD_GAP_PX,
): CardPosition {
  const belowTop = anchor.bottom + gap;
  const placement: CardPlacement =
    belowTop + cardSize.height <= viewport.height ? "below" : "above";
  const top =
    placement === "below"
      ? belowTop
      : Math.max(gap, anchor.top - gap - cardSize.height);
  // Center on the marker, clamped to the viewport gutters.
  const maxLeft = Math.max(gap, viewport.width - gap - cardSize.width);
  const left = Math.min(
    maxLeft,
    Math.max(gap, anchor.left + anchor.width / 2 - cardSize.width / 2),
  );
  return { left, top, placement };
}

/** Create the single shared card element and append it to the body. */
export function createHoverCard(doc: Document): HTMLElement {
  const card = doc.createElement("div");
  card.className = "hover-card";
  card.id = "timeline-hover-card";
  card.setAttribute("aria-hidden", "true");
  card.dataset.visible = "false";

  const image = doc.createElement("img");
  image.className = "hover-card__image";
  image.alt = ""; // decorative; the marker's aria-label carries the meaning
  image.decoding = "async";

  const date = doc.createElement("p");
  date.className = "hover-card__date";

  const description = doc.createElement("p");
  description.className = "hover-card__description";

  card.append(image, date, description);
  doc.body.append(card);
  return card;
}

/**
 * Populate and position the card for `project`, anchored to `marker`.
 * Internal to `enableHoverCards`; exported for tests.
 */
export function showHoverCard(
  card: HTMLElement,
  project: Project,
  marker: Element,
): void {
  const image = card.querySelector<HTMLImageElement>(".hover-card__image");
  const date = card.querySelector<HTMLElement>(".hover-card__date");
  const description = card.querySelector<HTMLElement>(".hover-card__description");
  if (image === null || date === null || description === null) return;

  image.src = project.featuredImage;
  date.textContent = formatDate(project.date);
  description.textContent = project.description; // untrusted: textContent only
  card.dataset.projectId = project.id;
  positionCard(card, marker);
  card.dataset.visible = "true";
}

/** Place the card in viewport coordinates near `marker`. */
function positionCard(card: HTMLElement, marker: Element): void {
  const rect = marker.getBoundingClientRect();
  const position = computeCardPosition(
    rect,
    { width: card.offsetWidth, height: card.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );
  card.style.left = `${Math.round(position.left)}px`;
  card.style.top = `${Math.round(position.top)}px`;
  card.dataset.placement = position.placement;
}

/** Hide the card without removing it from the DOM. */
export function hideHoverCard(card: HTMLElement): void {
  card.dataset.visible = "false";
}

/**
 * Wire the hover-card behavior to the timeline scroller (Section 6.3).
 *
 * - Mouse hover on a marker shows the card; leaving it schedules a
 *   short hide so the card does not flicker. The card itself is inert
 *   (`pointer-events: none`) — it has no interactive parts yet, so it
 *   can never obstruct the timeline or its controls.
 * - Keyboard focus on a marker shows the same card; blur hides it.
 * - Touch pointers never trigger the card — a tap opens the project
 *   directly, so hover is never required (Section 6.3).
 * - Escape, any scroll, resize, or a pointer press hides it immediately.
 * - A pressed mouse button (a drag in progress) never shows the card, so
 *   it cannot chase the cursor during drag scrolling (TASK-021).
 *
 * Returns a cleanup function (Section 8.3).
 */
export function enableHoverCards(
  container: HTMLElement,
  card: HTMLElement,
  getProject: (projectId: string) => Project | undefined,
  options: { hideDelayMs?: number } = {},
): () => void {
  const hideDelayMs = options.hideDelayMs ?? HIDE_DELAY_MS;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let anchor: Element | null = null;
  /** A mouse button is down on the timeline (a press or drag start). */
  let pressed = false;

  function cancelHide(): void {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide(): void {
    cancelHide();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hide();
    }, hideDelayMs);
  }

  function hide(): void {
    cancelHide();
    anchor = null;
    hideHoverCard(card);
  }

  function markerFrom(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>(".timeline__marker");
  }

  function projectFor(marker: Element): Project | undefined {
    const projectId =
      marker.closest<HTMLElement>(".timeline__item")?.dataset.projectId ?? "";
    return getProject(projectId);
  }

  function showFor(marker: HTMLElement): void {
    // A press (mousedown) focuses the marker, which would immediately
    // re-show the card after the press hid it — and make it follow a
    // drag. While the button is down, never show.
    if (pressed) return;
    const project = projectFor(marker);
    if (project === undefined) return;
    cancelHide();
    anchor = marker;
    showHoverCard(card, project, marker);
  }

  function onPointerOver(event: PointerEvent): void {
    // Touch and pen taps must open projects directly, never via hover.
    // A pressed button means drag scrolling is in progress.
    if (event.pointerType !== "mouse" || event.buttons !== 0) return;
    const marker = markerFrom(event.target);
    if (marker === null || marker === anchor) return;
    showFor(marker);
  }

  function onPointerOut(event: PointerEvent): void {
    if (event.pointerType !== "mouse") return;
    const marker = markerFrom(event.target);
    if (marker === null || marker !== anchor) return;
    // Moving within the marker keeps the card open.
    const to = event.relatedTarget;
    if (to instanceof Node && marker.contains(to)) return;
    scheduleHide();
  }

  function onFocusIn(event: FocusEvent): void {
    const marker = markerFrom(event.target);
    if (marker === null || marker === anchor) return;
    showFor(marker);
  }

  function onFocusOut(event: FocusEvent): void {
    const marker = markerFrom(event.target);
    if (marker === null || marker !== anchor) return;
    const to = event.relatedTarget;
    if (to instanceof Node && marker.contains(to)) return;
    hide();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") hide();
  }

  // A scroll or resize moves the anchored marker under the fixed card:
  // follow it (keyboard focus and programmatic scrolls re-position
  // instead of flicker). With no anchor — a drag or pointer press, say —
  // the card would only go stale, so hide it.
  function onViewportChange(): void {
    if (anchor !== null) positionCard(card, anchor);
    else hide();
  }
  function onPointerDown(): void {
    pressed = true;
    hide();
  }
  // Release listeners live on window: the press may end outside the
  // timeline (mirrors enableDragScrolling, TASK-021).
  function onWindowPointerUp(): void {
    pressed = false;
  }

  container.addEventListener("pointerover", onPointerOver);
  container.addEventListener("pointerout", onPointerOut);
  container.addEventListener("focusin", onFocusIn);
  container.addEventListener("focusout", onFocusOut);
  container.addEventListener("keydown", onKeyDown);
  container.addEventListener("pointerdown", onPointerDown);
  // Capture: catches scrolls on the scroller and any inner region alike.
  window.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("pointerup", onWindowPointerUp);
  window.addEventListener("pointercancel", onWindowPointerUp);

  return () => {
    container.removeEventListener("pointerover", onPointerOver);
    container.removeEventListener("pointerout", onPointerOut);
    container.removeEventListener("focusin", onFocusIn);
    container.removeEventListener("focusout", onFocusOut);
    container.removeEventListener("keydown", onKeyDown);
    container.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("scroll", onViewportChange, { capture: true });
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);
    hide();
  };
}
