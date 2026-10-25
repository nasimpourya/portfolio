/**
 * Choreography service (TASK-025): the single state-model subscription
 * that drives the overview ↔ detail page transition. Everything here
 * reacts to `(next, previous)` state diffs — no competing booleans
 * (Section 6.10) — so closing (TASK-026's close button) automatically
 * restores the overview by the same code path.
 *
 * The transition (Section 6.4 / Section 1):
 * - `data-mode` on <body> mirrors the view state's mode; CSS keys the
 *   detail composition off it (detail.css).
 * - The intro recedes (intro.css fades it to a quiet ghost) while the
 *   document scrolls down until only the bottom tenth of the intro
 *   remains in the viewport.
 * - The timeline region pins to the lower viewport (detail.css), so it
 *   stays rendered and usable for the whole detail state.
 */

import { setIntroHidden } from "../components/Intro.ts";
import type { ViewState, ViewStateManager } from "./view-state.ts";

/** Section 1: the intro's bottom tenth stays visible in detail mode. */
export const INTRO_EXIT_VISIBILITY = 0.1;

/**
 * Scroll position that leaves `introHeight × (1 − INTRO_EXIT_VISIBILITY)`
 * of the intro above the viewport top. Clamped to `maxScroll` so an
 * unexpectedly short document never over-scrolls.
 */
export function detailScrollTarget(
  introHeight: number,
  maxScroll: number,
): number {
  const target = Math.max(0, introHeight) * (1 - INTRO_EXIT_VISIBILITY);
  return Math.min(target, Math.max(0, maxScroll));
}

export type ScrollBehavior = "auto" | "smooth";
export type ScrollFn = (top: number, behavior: ScrollBehavior) => void;

/**
 * Subscribe the page choreography to the view state. Returns the
 * unsubscribe function (Section 8.3). `scroll` is injectable for tests;
 * it defaults to `window.scrollTo`.
 */
export function initTransitions(
  doc: Document,
  state: ViewStateManager,
  scroll: ScrollFn = defaultScroll(doc),
): () => void {
  const reducedMotion =
    doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ===
    true;

  // Reflect the initial state before any transition can fire.
  const initial = state.get();
  applyMode(doc, initial.mode);
  setIntroHidden(doc, initial.mode !== "overview");

  return state.subscribe((next, previous) => {
    applyMode(doc, next.mode);

    const isDetail = next.mode !== "overview";
    const wasDetail = previous.mode !== "overview";
    setIntroHidden(doc, isDetail);

    // Only the overview boundary moves the document: switching between
    // projects or opening a viewer keeps the composition in place.
    if (isDetail === wasDetail) return;

    if (isDetail) {
      const intro = doc.getElementById("intro");
      const maxScroll = maxScrollY(doc);
      scroll(
        detailScrollTarget(intro?.offsetHeight ?? 0, maxScroll),
        reducedMotion ? "auto" : "smooth",
      );
    } else {
      scroll(0, reducedMotion ? "auto" : "smooth");
    }
  });
}

function applyMode(doc: Document, mode: ViewState["mode"]): void {
  doc.body.dataset.mode = mode;
}

function maxScrollY(doc: Document): number {
  const win = doc.defaultView;
  if (win === null) return 0;
  return Math.max(0, doc.documentElement.scrollHeight - win.innerHeight);
}

function defaultScroll(doc: Document): ScrollFn {
  return (top, behavior) =>
    doc.defaultView?.scrollTo({ top, behavior });
}
