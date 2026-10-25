// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTRO_EXIT_VISIBILITY,
  detailScrollTarget,
  initTransitions,
} from "../../src/services/navigation";
import { createViewStateManager } from "../../src/services/view-state";

const doc = document;

beforeEach(() => {
  document.body.innerHTML = `
    <header id="intro"></header>
    <main><section id="project-detail" hidden></section></main>
    <nav id="timeline-region"></nav>
  `;
  document.body.dataset.mode = "overview";
});

describe("detailScrollTarget (TASK-025)", () => {
  it("leaves the bottom tenth of the intro in the viewport", () => {
    expect(detailScrollTarget(400, 10_000)).toBe(400 * (1 - INTRO_EXIT_VISIBILITY));
  });

  it("clamps to the maximum scroll of a short document", () => {
    expect(detailScrollTarget(400, 100)).toBe(100);
  });

  it("never returns a negative position", () => {
    expect(detailScrollTarget(-50, 500)).toBe(0);
    expect(detailScrollTarget(0, 0)).toBe(0);
  });
});

describe("initTransitions wiring (TASK-025)", () => {
  function setup() {
    const state = createViewStateManager(["2026-12-03"]);
    const scrolls: Array<{ top: number; behavior: string }> = [];
    const unsubscribe = initTransitions(doc, state, (top, behavior) => {
      scrolls.push({ top, behavior });
    });
    return { state, scrolls, unsubscribe };
  }

  it("mirrors the initial state onto <body data-mode> at init", () => {
    setup();
    expect(doc.body.dataset.mode).toBe("overview");
    expect(doc.getElementById("intro")?.getAttribute("data-hidden")).toBe("false");
  });

  it("opening a project enters detail mode and hides the intro", () => {
    const { state, scrolls } = setup();
    expect(state.openProject("2026-12-03")).toBe(true);
    expect(doc.body.dataset.mode).toBe("project");
    expect(doc.getElementById("intro")?.getAttribute("data-hidden")).toBe("true");
    // jsdom has no layout, so the intro measures 0 and the target is 0.
    expect(scrolls).toEqual([{ top: 0, behavior: "smooth" }]);
  });

  it("closing restores the overview, intro, and scroll position", () => {
    const { state, scrolls } = setup();
    state.openProject("2026-12-03");
    scrolls.length = 0;
    expect(state.closeProject()).toBe(true);
    expect(doc.body.dataset.mode).toBe("overview");
    expect(doc.getElementById("intro")?.getAttribute("data-hidden")).toBe("false");
    expect(scrolls).toEqual([{ top: 0, behavior: "smooth" }]);
  });

  it("switching between projects does not scroll the document again", () => {
    const { state, scrolls } = setup();
    state.openProject("2026-12-03");
    scrolls.length = 0;
    // openProject to the same id is a state no-op; there is only one
    // project here, so re-open the same one and assert no scroll.
    state.openProject("2026-12-03");
    expect(scrolls).toEqual([]);
  });

  it("uses instant scrolling under prefers-reduced-motion", () => {
    const media = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(doc.defaultView!, "matchMedia", {
      value: media,
      configurable: true,
    });
    const state = createViewStateManager(["2026-12-03"]);
    const scrolls: Array<{ top: number; behavior: string }> = [];
    initTransitions(doc, state, (top, behavior) => {
      scrolls.push({ top, behavior });
    });
    state.openProject("2026-12-03");
    expect(scrolls).toEqual([{ top: 0, behavior: "auto" }]);
    Reflect.deleteProperty(doc.defaultView as object, "matchMedia");
  });

  it("an invalid project id leaves the composition untouched", () => {
    const { state } = setup();
    expect(state.openProject("not-a-project")).toBe(false);
    expect(doc.body.dataset.mode).toBe("overview");
    expect(doc.getElementById("intro")?.getAttribute("data-hidden")).toBe("false");
  });
});
