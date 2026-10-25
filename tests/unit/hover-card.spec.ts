// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeCardPosition,
  createHoverCard,
  enableHoverCards,
  hideHoverCard,
} from "../../src/components/HoverCard";
import { renderTimeline } from "../../src/components/Timeline";
import type { ProjectManifest } from "../../src/data/types";

const doc = document;

function makeManifest(projectIds: string[]): ProjectManifest {
  return {
    schemaVersion: 1,
    projects: projectIds.map((id) => ({
      id,
      date: id,
      description: `Description of ${id}`,
      featuredImage: `projects/${id}/0.webp`,
      assets: [],
    })),
  };
}

/** jsdom has no layout: stub a marker's viewport rect. */
function stubRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  element.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** jsdom lacks PointerEvent construction; fake one like timeline.spec.ts. */
function pointerEvent(
  type: string,
  options: Record<string, unknown> = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const defaults = { pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0 };
  for (const [key, value] of Object.entries({ ...defaults, ...options })) {
    Object.defineProperty(event, key, { value, configurable: true });
  }
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <nav><div class="timeline-scroller"><ol id="timeline"></ol></div></nav>
  `;
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(projectIds: string[]) {
  renderTimeline(doc, makeManifest(projectIds), () => {});
  const scroller = doc.querySelector(".timeline-scroller") as HTMLElement;
  const card = createHoverCard(doc);
  const manifest = makeManifest(projectIds);
  const getProject = (id: string) =>
    manifest.projects.find((p) => p.id === id);
  const cleanup = enableHoverCards(scroller, card, getProject);
  // Distinct marker geometry per index: x = index * 200.
  doc.querySelectorAll(".timeline__marker").forEach((marker, index) => {
    stubRect(marker, { left: index * 200, top: 300, width: 96, height: 120 });
  });
  return { scroller, card, cleanup };
}

function markerAt(index: number): HTMLElement {
  return doc.querySelectorAll(".timeline__marker")[index] as HTMLElement;
}

describe("computeCardPosition", () => {
  const viewport = { width: 1024, height: 768 };
  const cardSize = { width: 288, height: 140 };

  it("prefers below the marker when the viewport has room", () => {
    const anchor = { left: 500, top: 300, width: 96, height: 120, bottom: 420 };
    const position = computeCardPosition(anchor, cardSize, viewport);
    expect(position.placement).toBe("below");
    expect(position.top).toBe(420 + 12); // anchor.bottom + gap
  });

  it("flips above the marker when it would overflow the bottom", () => {
    const anchor = { left: 500, top: 600, width: 96, height: 120, bottom: 720 };
    const position = computeCardPosition(anchor, cardSize, viewport);
    expect(position.placement).toBe("above");
    expect(position.top).toBe(600 - 12 - 140); // anchor.top - gap - height
  });

  it("clamps left so the card stays inside the viewport", () => {
    // Marker near the left edge: card centering would go negative.
    const nearLeft = computeCardPosition(
      { left: 0, top: 300, width: 96, height: 120, bottom: 420 },
      cardSize,
      viewport,
    );
    expect(nearLeft.left).toBe(12);

    // Marker near the right edge: card would overflow the right side.
    const nearRight = computeCardPosition(
      { left: 980, top: 300, width: 96, height: 120, bottom: 420 },
      cardSize,
      viewport,
    );
    expect(nearRight.left + cardSize.width).toBeLessThanOrEqual(1024);
  });

  it("keeps a taller card inside a short viewport", () => {
    const position = computeCardPosition(
      { left: 500, top: 700, width: 96, height: 60, bottom: 760 },
      cardSize,
      viewport,
    );
    expect(position.placement).toBe("above");
    expect(position.top).toBeGreaterThanOrEqual(12);
  });
});

describe("enableHoverCards (TASK-022)", () => {
  /** Give the card a measurable size for positioning. */
  function withCardSize(card: HTMLElement): void {
    Object.defineProperty(card, "offsetWidth", { value: 288, configurable: true });
    Object.defineProperty(card, "offsetHeight", { value: 140, configurable: true });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the card with the project's date and description on hover", () => {
    const { card, cleanup } = setup(["2026-12-03", "2026-11-20"]);
    withCardSize(card);

    markerAt(0).dispatchEvent(pointerEvent("pointerover"));

    expect(card.dataset.visible).toBe("true");
    expect(card.dataset.projectId).toBe("2026-12-03");
    expect(card.querySelector(".hover-card__date")?.textContent).toBe("Dec 3, 2026");
    expect(card.querySelector(".hover-card__description")?.textContent).toBe(
      "Description of 2026-12-03",
    );
    // Untrusted content is never HTML-injected; the card is decorative
    // to assistive technology (the markers' aria-labels carry the text).
    expect(card.getAttribute("aria-hidden")).toBe("true");
    cleanup();
  });

  it("shows the correct text for each project as the pointer moves between markers", () => {
    const { card, cleanup } = setup(["2026-12-03", "2026-11-20"]);
    withCardSize(card);
    stubRect(markerAt(1)!, { left: 300, top: 300, width: 96, height: 120 });

    markerAt(0).dispatchEvent(pointerEvent("pointerover"));
    markerAt(1).dispatchEvent(pointerEvent("pointerover"));
    expect(card.dataset.projectId).toBe("2026-11-20");
    expect(card.querySelector(".hover-card__description")?.textContent).toBe(
      "Description of 2026-11-20",
    );
    cleanup();
  });

  it("never shows for touch or pen pointers", () => {
    const { card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);

    markerAt(0).dispatchEvent(pointerEvent("pointerover", { pointerType: "touch" }));
    expect(card.dataset.visible).toBe("false");

    markerAt(0).dispatchEvent(pointerEvent("pointerover", { pointerType: "pen" }));
    expect(card.dataset.visible).toBe("false");
    cleanup();
  });

  it("does not appear while a mouse button is pressed (dragging)", () => {
    const { card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);

    markerAt(0).dispatchEvent(pointerEvent("pointerover", { buttons: 1 }));
    expect(card.dataset.visible).toBe("false");
    cleanup();
  });

  it("keeps the card open while the pointer moves within the marker, hides after it leaves", () => {
    const { card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);
    const marker = markerAt(0);
    const image = marker.querySelector(".timeline__image")!;

    marker.dispatchEvent(pointerEvent("pointerover"));
    // Crossing onto the marker's child elements is not a leave.
    image.dispatchEvent(pointerEvent("pointerover"));
    image.dispatchEvent(pointerEvent("pointerout", { relatedTarget: marker }));
    expect(card.dataset.visible).toBe("true");
    vi.advanceTimersByTime(300);
    expect(card.dataset.visible).toBe("true");

    // Leaving the marker toward elsewhere: hidden after the grace period.
    marker.dispatchEvent(pointerEvent("pointerout", { relatedTarget: doc.body }));
    expect(card.dataset.visible).toBe("true"); // still within the grace period
    vi.advanceTimersByTime(200);
    expect(card.dataset.visible).toBe("false");
    cleanup();
  });

  it("shows for keyboard focus and hides on blur (keyboard equivalence)", () => {
    const { card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);

    markerAt(0).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(card.dataset.visible).toBe("true");
    expect(card.querySelector(".hover-card__description")?.textContent).toBe(
      "Description of 2026-12-03",
    );

    markerAt(0).dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
    );
    expect(card.dataset.visible).toBe("false");
    cleanup();
  });

  it("hides on Escape", () => {
    const { card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);

    markerAt(0).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(card.dataset.visible).toBe("true");

    const scroller = doc.querySelector(".timeline-scroller") as HTMLElement;
    scroller.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(card.dataset.visible).toBe("false");
    cleanup();
  });

  it("follows the anchored marker on scroll, and stays hidden once closed", () => {
    const { card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);

    markerAt(0).dispatchEvent(pointerEvent("pointerover"));
    expect(card.dataset.visible).toBe("true");
    // A scroll (e.g. the browser's focus scroll-into-view) re-positions
    // the card instead of flickering it closed.
    window.dispatchEvent(new Event("scroll"));
    expect(card.dataset.visible).toBe("true");

    // With no anchor (after a released press), scrolling must not
    // resurrect it.
    const scroller = doc.querySelector(".timeline-scroller") as HTMLElement;
    scroller.dispatchEvent(pointerEvent("pointerdown"));
    expect(card.dataset.visible).toBe("false");
    window.dispatchEvent(pointerEvent("pointerup"));
    window.dispatchEvent(new Event("scroll"));
    expect(card.dataset.visible).toBe("false");

    // Same for resize.
    markerAt(0).dispatchEvent(pointerEvent("pointerover"));
    window.dispatchEvent(new Event("resize"));
    expect(card.dataset.visible).toBe("true");
    cleanup();
  });

  it("hides on a pointer press inside the timeline", () => {
    const { scroller, card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);

    markerAt(0).dispatchEvent(pointerEvent("pointerover"));
    expect(card.dataset.visible).toBe("true");
    scroller.dispatchEvent(pointerEvent("pointerdown"));
    expect(card.dataset.visible).toBe("false");
    cleanup();
  });

  it("does not let the press-triggered focus re-show the card, and recovers after release", () => {
    const { scroller, card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);

    // Pressing a marker focuses it (mousedown focus), which must not
    // resurrect the card — otherwise it would follow a drag.
    scroller.dispatchEvent(pointerEvent("pointerdown"));
    markerAt(0).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(card.dataset.visible).toBe("false");

    // Releasing ends the suppression; a later hover shows the card again.
    window.dispatchEvent(pointerEvent("pointerup"));
    markerAt(0).dispatchEvent(pointerEvent("pointerover"));
    expect(card.dataset.visible).toBe("true");
    cleanup();
  });

  it("positions the card in viewport coordinates near the marker", () => {
    const { card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);
    // jsdom viewport: 1024 x 768. The marker fits a below placement.
    markerAt(0).dispatchEvent(pointerEvent("pointerover"));

    expect(card.dataset.placement).toBe("below");
    const left = Number.parseFloat(card.style.left);
    const top = Number.parseFloat(card.style.top);
    // Centered on the marker (100 + 96/2 = 148), clamped to the 12px gutter.
    expect(left).toBe(12);
    expect(top).toBe(300 + 120 + 12);
    cleanup();
  });

  it("does nothing for a marker with an unknown project ID", () => {
    const { card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);
    const orphan = doc.createElement("button");
    orphan.className = "timeline__marker";
    doc.querySelector(".timeline-scroller")!.append(orphan);
    stubRect(orphan, { left: 500, top: 300, width: 96, height: 120 });

    expect(() =>
      orphan.dispatchEvent(pointerEvent("pointerover")),
    ).not.toThrow();
    expect(card.dataset.visible).toBe("false");
    cleanup();
  });

  it("cleanup removes the listeners and hides the card (Section 8.3)", () => {
    const { card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);

    cleanup();
    markerAt(0).dispatchEvent(pointerEvent("pointerover"));
    expect(card.dataset.visible).toBe("false");
  });

  it("hideHoverCard clears visibility without removing the element", () => {
    const { card, cleanup } = setup(["2026-12-03"]);
    withCardSize(card);
    markerAt(0).dispatchEvent(pointerEvent("pointerover"));
    hideHoverCard(card);
    expect(card.dataset.visible).toBe("false");
    expect(card.isConnected).toBe(true);
    cleanup();
  });
});
