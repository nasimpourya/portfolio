import { describe, expect, it, vi } from "vitest";
import {
  createViewStateManager,
  type ViewState,
} from "../../src/services/view-state";

const IDS = ["2026-12-03", "2026-11-20", "2025-04-17"] as const;

function manager() {
  return createViewStateManager(IDS);
}

describe("createViewStateManager (TASK-023)", () => {
  it("starts in the overview state", () => {
    const state = manager();
    expect(state.get()).toEqual({ mode: "overview" });
  });

  describe("openProject", () => {
    it("opens a known project from overview", () => {
      const state = manager();
      expect(state.openProject("2026-12-03")).toBe(true);
      expect(state.get()).toEqual({ mode: "project", projectId: "2026-12-03" });
    });

    it("rejects unknown and malformed project ids without changing state", () => {
      const state = manager();
      const listener = vi.fn();
      state.subscribe(listener);

      expect(state.openProject("1999-01-01")).toBe(false); // unknown but well-formed
      expect(state.openProject("")).toBe(false); // empty
      expect(state.openProject("../../etc")).toBe(false); // junk input
      expect(state.openProject("2026-12-03; drop table")).toBe(false);
      expect(state.get()).toEqual({ mode: "overview" });
      expect(listener).not.toHaveBeenCalled();
    });

    it("switches directly between projects without stale state", () => {
      const state = manager();
      state.openProject("2026-12-03");
      state.openImage("2026-12-03", 2);
      // Selecting another marker while a viewer is open must resolve
      // cleanly to the new project (Section 6.4) — no leftover overlay.
      expect(state.openProject("2026-11-20")).toBe(true);
      expect(state.get()).toEqual({ mode: "project", projectId: "2026-11-20" });
    });

    it("re-opening the already-open project does not re-notify", () => {
      const state = manager();
      state.openProject("2026-12-03");
      const listener = vi.fn();
      state.subscribe(listener);
      expect(state.openProject("2026-12-03")).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("openImage", () => {
    it("opens a viewer only for the active project", () => {
      const state = manager();
      state.openProject("2026-12-03");

      expect(state.openImage("2026-11-20", 0)).toBe(false); // not the active project
      expect(state.openImage("2026-12-03", 0)).toBe(true);
      expect(state.get()).toEqual({ mode: "image", projectId: "2026-12-03", assetIndex: 0 });
    });

    it("refuses viewers while in overview", () => {
      const state = manager();
      expect(state.openImage("2026-12-03", 0)).toBe(false);
      expect(state.get()).toEqual({ mode: "overview" });
    });

    it("rejects invalid image indexes", () => {
      const state = manager();
      state.openProject("2026-12-03");
      expect(state.openImage("2026-12-03", -1)).toBe(false);
      expect(state.openImage("2026-12-03", 1.5)).toBe(false);
      expect(state.openImage("2026-12-03", Number.NaN)).toBe(false);
      expect(state.get()).toEqual({ mode: "project", projectId: "2026-12-03" });
    });
  });

  describe("closeOverlay", () => {
    it("returns a viewer to its project's detail state", () => {
      const state = manager();
      state.openProject("2026-11-20");
      state.openImage("2026-11-20", 0);
      expect(state.closeOverlay()).toBe(true);
      expect(state.get()).toEqual({ mode: "project", projectId: "2026-11-20" });
    });

    it("is a no-op outside viewer modes", () => {
      const state = manager();
      expect(state.closeOverlay()).toBe(false); // overview
      state.openProject("2026-12-03");
      expect(state.closeOverlay()).toBe(false); // project detail has no overlay
      expect(state.get()).toEqual({ mode: "project", projectId: "2026-12-03" });
    });
  });

  describe("closeProject", () => {
    it("returns to overview from every mode", () => {
      const cases: Array<(s: ReturnType<typeof manager>) => void> = [
        (s) => s.openProject("2026-12-03"),
        (s) => {
          s.openProject("2026-12-03");
          s.openImage("2026-12-03", 0);
        },
      ];
      for (const open of cases) {
        const state = manager();
        open(state);
        expect(state.closeProject()).toBe(true);
        expect(state.get()).toEqual({ mode: "overview" });
      }
    });

    it("is a no-op in overview", () => {
      const state = manager();
      expect(state.closeProject()).toBe(false);
      expect(state.get()).toEqual({ mode: "overview" });
    });
  });

  describe("subscribe", () => {
    it("notifies with (next, previous) after each real transition", () => {
      const state = manager();
      const calls: Array<[ViewState, ViewState]> = [];
      state.subscribe((next, previous) => calls.push([next, previous]));

      state.openProject("2026-12-03");
      state.openImage("2026-12-03", 1);
      state.closeOverlay();
      state.closeProject();

      expect(calls).toEqual([
        [
          { mode: "project", projectId: "2026-12-03" },
          { mode: "overview" },
        ],
        [
          { mode: "image", projectId: "2026-12-03", assetIndex: 1 },
          { mode: "project", projectId: "2026-12-03" },
        ],
        [
          { mode: "project", projectId: "2026-12-03" },
          { mode: "image", projectId: "2026-12-03", assetIndex: 1 },
        ],
        [{ mode: "overview" }, { mode: "project", projectId: "2026-12-03" }],
      ]);
    });

    it("unsubscribe stops notifications (Section 8.3)", () => {
      const state = manager();
      const listener = vi.fn();
      const unsubscribe = state.subscribe(listener);
      unsubscribe();
      state.openProject("2026-12-03");
      expect(listener).not.toHaveBeenCalled();
    });

    it("later transitions see removals made during notification", () => {
      const state = manager();
      const second = vi.fn();
      state.subscribe(() => {
        // A listener may unsubscribe itself mid-notification.
        second();
      });
      state.openProject("2026-12-03");
      expect(second).toHaveBeenCalledTimes(1);
    });
  });
});
