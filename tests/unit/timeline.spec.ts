// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  centeredScrollLeft,
  centerNewest,
  enableDragScrolling,
  enableWheelNavigation,
  renderTimeline,
  setActiveMarker,
} from "../../src/components/Timeline";
import { formatDate, isIsoDate, yearOf } from "../../src/utils/dates";
import type { ProjectManifest } from "../../src/data/types";

const doc = document;

function makeManifest(projectIds: string[]): ProjectManifest {
  return {
    schemaVersion: 1,
    projects: projectIds.map((id) => ({
      id,
      date: id,
      description: `Project ${id}`,
      featuredImage: `projects/${id}/0.webp`,
      assets: [],
    })),
  };
}

beforeEach(() => {
  document.body.innerHTML = `
    <main><p id="empty-state" hidden></p></main>
    <nav><div class="timeline-scroller"><ol id="timeline"></ol></div></nav>
  `;
});

describe("renderTimeline", () => {
  it("renders one keyboard-operable marker per manifest entry, newest first", () => {
    renderTimeline(doc, makeManifest(["2026-12-03", "2026-11-20"]), () => {});
    const items = doc.querySelectorAll(".timeline__item");
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute("data-project-id")).toBe("2026-12-03");
    const marker = items[0]?.querySelector("button.timeline__marker");
    expect(marker?.getAttribute("type")).toBe("button");
    expect(marker?.getAttribute("aria-label")).toContain("Dec 3, 2026");
    expect(marker?.getAttribute("aria-label")).toContain("Project 2026-12-03");
  });

  it("renders the featured image and formatted date", () => {
    renderTimeline(doc, makeManifest(["2026-12-03"]), () => {});
    const image = doc.querySelector(".timeline__image") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("projects/2026-12-03/0.webp");
    expect(image.getAttribute("alt")).toBe("");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(doc.querySelector(".timeline__date")?.textContent).toBe("Dec 3, 2026");
  });

  it("shows the empty state and no markers when there are no projects", () => {
    renderTimeline(doc, { schemaVersion: 1, projects: [] }, () => {});
    expect(doc.querySelectorAll(".timeline__item")).toHaveLength(0);
    expect(doc.getElementById("empty-state")?.hidden).toBe(false);
  });

  it("replaces previous markers instead of duplicating", () => {
    renderTimeline(doc, makeManifest(["2026-12-03"]), () => {});
    renderTimeline(doc, makeManifest(["2026-11-20"]), () => {});
    expect(doc.querySelectorAll(".timeline__item")).toHaveLength(1);
    expect(doc.querySelector(".timeline__item")?.getAttribute("data-project-id")).toBe(
      "2026-11-20",
    );
  });

  it("invokes the selection callback with the project ID on click", () => {
    const selected: string[] = [];
    renderTimeline(doc, makeManifest(["2026-12-03"]), (id) => selected.push(id));
    (doc.querySelector(".timeline__marker") as HTMLButtonElement).click();
    expect(selected).toEqual(["2026-12-03"]);
  });

  it("marks the featured image for fallback on error", () => {
    renderTimeline(doc, makeManifest(["2026-12-03"]), () => {});
    const item = doc.querySelector(".timeline__item")!;
    const image = item.querySelector("img")!;
    image.dispatchEvent(new Event("error"));
    expect(item.classList.contains("timeline__item--image-failed")).toBe(true);
  });
});

describe("zigzag sides and year ticks", () => {
  it("alternates data-side above/below by index, newest first", () => {
    renderTimeline(doc, makeManifest(["2026-12-03", "2026-11-20", "2026-10-15"]), () => {});
    const sides = [...doc.querySelectorAll(".timeline__item")].map(
      (item) => (item as HTMLElement).dataset.side,
    );
    expect(sides).toEqual(["above", "below", "above"]);
  });

  it("sets a stagger index on each item", () => {
    renderTimeline(doc, makeManifest(["2026-12-03", "2026-11-20"]), () => {});
    const indexes = [...doc.querySelectorAll(".timeline__item")].map((item) =>
      (item as HTMLElement).style.getPropertyValue("--timeline-index"),
    );
    expect(indexes).toEqual(["0", "1"]);
  });

  it("inserts one hidden tick per year boundary, labeled with the older year", () => {
    renderTimeline(
      doc,
      makeManifest(["2026-12-03", "2026-01-05", "2025-11-02", "2025-03-01", "2024-06-10"]),
      () => {},
    );
    const ticks = [...doc.querySelectorAll(".timeline__year")];
    expect(ticks).toHaveLength(2);
    expect(ticks[0]?.textContent).toBe("2025"); // 2026-01-05 → 2025-11-02
    expect(ticks[1]?.textContent).toBe("2024"); // 2025-03-01 → 2024-06-10
    for (const tick of ticks) {
      expect(tick.getAttribute("aria-hidden")).toBe("true");
      expect(tick.getAttribute("role")).toBe("presentation");
    }
  });

  it("places each tick between the correct neighboring items in DOM order", () => {
    renderTimeline(doc, makeManifest(["2026-01-05", "2025-11-02"]), () => {});
    const children = [...doc.querySelectorAll("#timeline > li")].map((li) =>
      li.classList.contains("timeline__year") ? "year" : li.getAttribute("data-project-id"),
    );
    expect(children).toEqual(["2026-01-05", "year", "2025-11-02"]);
  });

  it("adds no tick within a single year", () => {
    renderTimeline(doc, makeManifest(["2026-12-03", "2026-11-20", "2026-01-02"]), () => {});
    expect(doc.querySelectorAll(".timeline__year")).toHaveLength(0);
  });

  it("adds no tick for a single project", () => {
    renderTimeline(doc, makeManifest(["2026-12-03"]), () => {});
    expect(doc.querySelectorAll(".timeline__year")).toHaveLength(0);
  });

  it("keeps ticks out of the item count but inside the list", () => {
    renderTimeline(doc, makeManifest(["2026-01-05", "2025-11-02"]), () => {});
    expect(doc.querySelectorAll(".timeline__item")).toHaveLength(2);
    expect(doc.querySelectorAll("#timeline > li")).toHaveLength(3);
  });

  it("keeps the image inside the marker and the date beside it", () => {
    renderTimeline(doc, makeManifest(["2026-12-03"]), () => {});
    const marker = doc.querySelector("button.timeline__marker")!;
    expect(marker.querySelector(".timeline__image")).not.toBeNull();
    // The date must not be part of the hover-card anchor box.
    expect(marker.querySelector(".timeline__date")).toBeNull();
    const item = doc.querySelector(".timeline__item")!;
    expect(item.querySelector(".timeline__date")).not.toBeNull();
  });
});

describe("setActiveMarker", () => {
  it("marks exactly one marker active and clears on null", () => {
    renderTimeline(doc, makeManifest(["2026-12-03", "2026-11-20"]), () => {});
    setActiveMarker(doc, "2026-11-20");
    expect(doc.querySelectorAll(".timeline__item[data-active]")).toHaveLength(1);
    expect(
      doc.querySelector('.timeline__item[data-project-id="2026-11-20"]')?.hasAttribute("data-active"),
    ).toBe(true);
    setActiveMarker(doc, null);
    expect(doc.querySelectorAll(".timeline__item[data-active]")).toHaveLength(0);
  });

  it("handles unknown project IDs safely", () => {
    renderTimeline(doc, makeManifest(["2026-12-03"]), () => {});
    expect(() => setActiveMarker(doc, "1999-01-01")).not.toThrow();
    expect(doc.querySelectorAll(".timeline__item[data-active]")).toHaveLength(0);
  });
});

describe("date formatting", () => {
  it("formats real dates and rejects invalid ones to the ISO fallback", () => {
    expect(formatDate("2026-12-03")).toBe("Dec 3, 2026");
    expect(formatDate("2026-02-30")).toBe("2026-02-30"); // impossible date
    expect(isIsoDate("2026-12-03")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
  });

  it("extracts the year of a real date and rejects invalid ones", () => {
    expect(yearOf("2026-12-03")).toBe("2026");
    expect(yearOf("not-a-date")).toBe("");
  });
});

describe("enableWheelNavigation (TASK-020)", () => {
  /** jsdom has no layout: fake the scroll geometry on the container. */
  function scrollableContainer(): HTMLElement {
    const container = doc.querySelector(".timeline-scroller") as HTMLElement;
    Object.defineProperty(container, "clientWidth", { value: 500, configurable: true });
    Object.defineProperty(container, "scrollWidth", { value: 2000, configurable: true });
    container.scrollLeft = 100;
    return container;
  }

  it("translates vertical wheel movement into horizontal scrolling", () => {
    const container = scrollableContainer();
    const cleanup = enableWheelNavigation(container);
    const event = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
    container.dispatchEvent(event);
    expect(container.scrollLeft).toBe(220);
    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  it("scrolls up-wheel toward the start and down-wheel toward the end", () => {
    const container = scrollableContainer();
    const cleanup = enableWheelNavigation(container);
    container.dispatchEvent(new WheelEvent("wheel", { deltaY: -80, cancelable: true }));
    expect(container.scrollLeft).toBe(20);
    cleanup();
  });

  it("leaves native horizontal gestures alone", () => {
    const container = scrollableContainer();
    const cleanup = enableWheelNavigation(container);
    const event = new WheelEvent("wheel", { deltaX: 100, deltaY: 10, cancelable: true });
    container.dispatchEvent(event);
    expect(container.scrollLeft).toBe(100); // unchanged
    expect(event.defaultPrevented).toBe(false);
    cleanup();
  });

  it("hands the gesture back to page scrolling at the timeline edges", () => {
    const container = scrollableContainer();
    const cleanup = enableWheelNavigation(container);

    // At the start: up-wheel must not be consumed.
    container.scrollLeft = 0;
    const up = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
    container.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
    expect(container.scrollLeft).toBe(0);

    // At the end: down-wheel must not be consumed.
    container.scrollLeft = 1500; // 1500 + 500 = 2000 = scrollWidth
    const down = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    container.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(container.scrollLeft).toBe(1500);
    cleanup();
  });

  it("cleanup removes the listener (Section 8.3)", () => {
    const container = scrollableContainer();
    const cleanup = enableWheelNavigation(container);
    cleanup();
    container.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }));
    expect(container.scrollLeft).toBe(100);
  });
});

describe("centerNewest (TASK-019)", () => {
  /** Give an element fake geometry the way a real browser would. */
  function withGeometry(element: Element, geometry: { offsetLeft: number; offsetWidth: number; clientWidth?: number }): void {
    const target = element as HTMLElement;
    Object.defineProperty(target, "offsetLeft", { value: geometry.offsetLeft, configurable: true });
    Object.defineProperty(target, "offsetWidth", { value: geometry.offsetWidth, configurable: true });
    if (geometry.clientWidth !== undefined) {
      Object.defineProperty(target, "clientWidth", { value: geometry.clientWidth, configurable: true });
    }
  }

  it("computes the centered scroll position", () => {
    // Item at x=900, 96 wide; container 400 wide → center: 900 - (400-96)/2 = 748.
    const container = { clientWidth: 400 } as HTMLElement;
    const item = { offsetLeft: 900, offsetWidth: 96 } as HTMLElement;
    expect(centeredScrollLeft(container, item)).toBe(748);
  });

  it("never scrolls left of the timeline start", () => {
    const container = { clientWidth: 800 } as HTMLElement;
    const item = { offsetLeft: 100, offsetWidth: 96 } as HTMLElement;
    expect(centeredScrollLeft(container, item)).toBe(0);
  });

  it("centers the newest (first) marker on desktop", () => {
    renderTimeline(doc, makeManifest(["2026-12-03", "2026-11-20"]), () => {});
    const container = doc.querySelector(".timeline-scroller") as HTMLElement;
    withGeometry(container, { offsetLeft: 0, offsetWidth: 1000, clientWidth: 500 });
    withGeometry(doc.querySelector(".timeline__item")!, {
      offsetLeft: 48,
      offsetWidth: 96,
    });
    centerNewest(doc, { isDesktop: () => true });
    expect(container.scrollLeft).toBe(0); // 48 - (500-96)/2 < 0 → clamped
  });

  it("does nothing on mobile", () => {
    renderTimeline(doc, makeManifest(["2026-12-03"]), () => {});
    const container = doc.querySelector(".timeline-scroller") as HTMLElement;
    withGeometry(container, { offsetLeft: 0, offsetWidth: 1000, clientWidth: 500 });
    withGeometry(doc.querySelector(".timeline__item")!, { offsetLeft: 300, offsetWidth: 96 });
    centerNewest(doc, { isDesktop: () => false });
    expect(container.scrollLeft).toBe(0);
  });

  it("handles an empty timeline without scrolling", () => {
    renderTimeline(doc, { schemaVersion: 1, projects: [] }, () => {});
    const container = doc.querySelector(".timeline-scroller") as HTMLElement;
    withGeometry(container, { offsetLeft: 0, offsetWidth: 1000, clientWidth: 500 });
    expect(() => centerNewest(doc, { isDesktop: () => true })).not.toThrow();
    expect(container.scrollLeft).toBe(0);
  });

  it("computes a positive offset for a marker beyond the viewport center", () => {
    renderTimeline(doc, makeManifest(["2026-12-03"]), () => {});
    const container = doc.querySelector(".timeline-scroller") as HTMLElement;
    withGeometry(container, { offsetLeft: 0, offsetWidth: 2000, clientWidth: 500 });
    withGeometry(doc.querySelector(".timeline__item")!, { offsetLeft: 900, offsetWidth: 96 });
    centerNewest(doc, { isDesktop: () => true });
    expect(container.scrollLeft).toBe(698); // 900 - (500-96)/2
  });
});

describe("enableDragScrolling (TASK-021)", () => {
  /** jsdom lacks PointerEvent construction in some versions; fake one. */
  function pointerEvent(type: string, options: Record<string, unknown>): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const defaults = { pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: 0, button: 0 };
    for (const [key, value] of Object.entries({ ...defaults, ...options })) {
      Object.defineProperty(event, key, { value, configurable: true });
    }
    return event;
  }

  function draggableContainer(): HTMLElement {
    const container = doc.querySelector(".timeline-scroller") as HTMLElement;
    Object.defineProperty(container, "clientWidth", { value: 500, configurable: true });
    Object.defineProperty(container, "scrollWidth", { value: 2000, configurable: true });
    container.scrollLeft = 100;
    return container;
  }

  it("scrolls horizontally when dragged beyond the threshold", () => {
    const container = draggableContainer();
    const cleanup = enableDragScrolling(container);
    container.dispatchEvent(pointerEvent("pointerdown", { clientX: 200, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    window.dispatchEvent(pointerEvent("pointermove", { clientX: 260, pointerId: 1, pointerType: "mouse" }));
    expect(container.scrollLeft).toBe(40); // 100 - 60
    expect(container.classList.contains("timeline--dragging")).toBe(true);
    window.dispatchEvent(pointerEvent("pointerup", { clientX: 260, pointerId: 1, pointerType: "mouse" }));
    expect(container.classList.contains("timeline--dragging")).toBe(false);
    cleanup();
  });

  it("activates the marker on a click without meaningful movement", () => {
    const container = draggableContainer();
    const selected: string[] = [];
    renderTimeline(doc, makeManifest(["2026-12-03"]), (id) => selected.push(id));
    enableDragScrolling(container);

    const marker = container.querySelector(".timeline__marker") as HTMLButtonElement;
    container.dispatchEvent(pointerEvent("pointerdown", { clientX: 200, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    // Tiny move below the 5px threshold: still a click.
    window.dispatchEvent(pointerEvent("pointermove", { clientX: 202, pointerId: 1, pointerType: "mouse" }));
    window.dispatchEvent(pointerEvent("pointerup", { clientX: 202, pointerId: 1, pointerType: "mouse" }));
    marker.click();
    expect(selected).toEqual(["2026-12-03"]);
  });

  it("does not activate the marker when the click follows a drag", () => {
    const container = draggableContainer();
    const selected: string[] = [];
    renderTimeline(doc, makeManifest(["2026-12-03"]), (id) => selected.push(id));
    enableDragScrolling(container);

    const marker = container.querySelector(".timeline__marker") as HTMLButtonElement;
    container.dispatchEvent(pointerEvent("pointerdown", { clientX: 200, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    window.dispatchEvent(pointerEvent("pointermove", { clientX: 300, pointerId: 1, pointerType: "mouse" }));
    window.dispatchEvent(pointerEvent("pointerup", { clientX: 300, pointerId: 1, pointerType: "mouse" }));
    marker.click(); // browser fires click after drag release; must be suppressed
    expect(selected).toEqual([]);
  });

  it("ends the drag cleanly when released outside the timeline", () => {
    const container = draggableContainer();
    const selected: string[] = [];
    renderTimeline(doc, makeManifest(["2026-12-03"]), (id) => selected.push(id));
    enableDragScrolling(container);
    const marker = container.querySelector(".timeline__marker") as HTMLButtonElement;

    container.dispatchEvent(pointerEvent("pointerdown", { clientX: 200 }));
    window.dispatchEvent(pointerEvent("pointermove", { clientX: 300 }));
    // Release far outside the timeline (no bubbling to container).
    window.dispatchEvent(pointerEvent("pointerup", { clientX: 900 }));
    expect(container.classList.contains("timeline--dragging")).toBe(false);

    // The next press+click must not be suppressed by the old drag,
    // even though no click followed the release.
    container.dispatchEvent(pointerEvent("pointerdown", { clientX: 200 }));
    window.dispatchEvent(pointerEvent("pointerup", { clientX: 200 }));
    marker.click();
    expect(selected).toEqual(["2026-12-03"]);
  });

  it("ignores non-mouse pointers (touch scrolls natively)", () => {
    const container = draggableContainer();
    enableDragScrolling(container);
    container.dispatchEvent(pointerEvent("pointerdown", { clientX: 200, pointerType: "touch" }));
    window.dispatchEvent(pointerEvent("pointermove", { clientX: 300, pointerType: "touch" }));
    expect(container.scrollLeft).toBe(100);
    expect(container.classList.contains("timeline--dragging")).toBe(false);
  });

  it("cleanup removes all listeners (Section 8.3)", () => {
    const container = draggableContainer();
    const cleanup = enableDragScrolling(container);
    cleanup();
    container.dispatchEvent(pointerEvent("pointerdown", { clientX: 200, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    window.dispatchEvent(pointerEvent("pointermove", { clientX: 300, pointerId: 1, pointerType: "mouse" }));
    expect(container.scrollLeft).toBe(100);
    expect(container.classList.contains("timeline--dragging")).toBe(false);
  });
});
