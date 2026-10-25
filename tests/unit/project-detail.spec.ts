// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { initProjectDetail, showProjectDetail } from "../../src/components/ProjectDetail";
import { createViewStateManager } from "../../src/services/view-state";
import { initTransitions } from "../../src/services/navigation";
import { renderTimeline } from "../../src/components/Timeline";
import type { Project } from "../../src/data/types";

const doc = document;

const projects: Project[] = [
  {
    id: "2026-12-03",
    date: "2026-12-03",
    description: "Newest project",
    featuredImage: "projects/2026-12-03/0.webp",
    assets: [],
  },
  {
    id: "2026-11-20",
    date: "2026-11-20",
    description: "Older project",
    featuredImage: "projects/2026-11-20/0.webp",
    assets: [],
  },
];

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
  `;
  document.body.dataset.mode = "overview";
});

describe("showProjectDetail (TASK-024)", () => {
  it("reveals the detail region and shows the folder date", () => {
    showProjectDetail(doc, projects[0]!);
    expect(doc.getElementById("project-detail")?.hidden).toBe(false);
    expect(doc.getElementById("project-date")?.textContent).toBe("Dec 3, 2026");
  });

  it("moves focus to the date heading", () => {
    showProjectDetail(doc, projects[0]!);
    expect(doc.activeElement).toBe(doc.getElementById("project-date"));
  });

  it("clears the mosaic on repeated activation instead of duplicating", () => {
    const mosaic = doc.getElementById("mosaic")!;
    mosaic.append(doc.createElement("p"), doc.createElement("p"));
    showProjectDetail(doc, projects[0]!);
    expect(mosaic.childElementCount).toBe(0);
    showProjectDetail(doc, projects[1]!);
    expect(mosaic.childElementCount).toBe(0);
  });

  it("switches the visible date when another project is shown", () => {
    showProjectDetail(doc, projects[0]!);
    showProjectDetail(doc, projects[1]!);
    expect(doc.getElementById("project-date")?.textContent).toBe("Nov 20, 2026");
    expect(doc.querySelectorAll("#project-detail")).toHaveLength(1); // never duplicated
  });
});

describe("initProjectDetail wiring (TASK-024)", () => {
  function setup() {
    const state = createViewStateManager(projects.map((p) => p.id));
    const card = doc.getElementById("timeline-hover-card") as HTMLElement;
    initProjectDetail(doc, state, projects, card);
    const selected: string[] = [];
    renderTimeline(doc, { schemaVersion: 1, projects }, (id) => {
      selected.push(id);
      state.openProject(id); // mirrors main.ts's marker wiring
    });
    return { state, card, selected };
  }

  it("selecting a marker opens the correct project end-to-end", () => {
    const { state, selected } = setup();
    (doc.querySelectorAll(".timeline__marker")[1] as HTMLButtonElement).click();
    expect(selected).toEqual(["2026-11-20"]);
    expect(state.get()).toEqual({ mode: "project", projectId: "2026-11-20" });
    expect(doc.getElementById("project-detail")?.hidden).toBe(false);
    expect(doc.getElementById("project-date")?.textContent).toBe("Nov 20, 2026");
    expect(
      doc.querySelector('.timeline__item[data-project-id="2026-11-20"]')?.hasAttribute("data-active"),
    ).toBe(true);
  });

  it("hides the hover card when a project opens", () => {
    const { card } = setup();
    card.dataset.visible = "true";
    (doc.querySelector(".timeline__marker") as HTMLButtonElement).click();
    expect(card.dataset.visible).toBe("false");
  });

  it("repeated activation of the same marker is a state-model no-op", () => {
    const { state } = setup();
    const marker = doc.querySelector(".timeline__marker") as HTMLButtonElement;
    marker.click();
    marker.click();
    marker.click();
    expect(state.get()).toEqual({ mode: "project", projectId: "2026-12-03" });
    expect(doc.querySelectorAll("#project-detail")).toHaveLength(1);
    expect(doc.querySelectorAll(".timeline__item[data-active]")).toHaveLength(1);
  });

  it("switching projects updates marker, date, and region in one transition", () => {
    const { state } = setup();
    (doc.querySelectorAll(".timeline__marker")[0] as HTMLButtonElement).click();
    (doc.querySelectorAll(".timeline__marker")[1] as HTMLButtonElement).click();
    expect(state.get()).toEqual({ mode: "project", projectId: "2026-11-20" });
    expect(doc.querySelectorAll(".timeline__item[data-active]")).toHaveLength(1);
    expect(doc.getElementById("project-date")?.textContent).toBe("Nov 20, 2026");
  });

  it("an unknown project id never opens the detail region", () => {
    const { state } = setup();
    expect(state.openProject("1999-01-01")).toBe(false);
    expect(doc.getElementById("project-detail")?.hidden).toBe(true);
    expect(doc.querySelectorAll(".timeline__item[data-active]")).toHaveLength(0);
  });
});

describe("close control (TASK-026)", () => {
  /**
   * Full wiring as in main.ts: detail region + close button, the
   * TASK-025 choreography (with a scroll spy), and the timeline.
   */
  function setup() {
    const state = createViewStateManager(projects.map((p) => p.id));
    const card = doc.getElementById("timeline-hover-card") as HTMLElement;
    const scrolls: number[] = [];
    initProjectDetail(doc, state, projects, card);
    initTransitions(doc, state, (top) => scrolls.push(top));
    renderTimeline(doc, { schemaVersion: 1, projects }, (id) => {
      state.openProject(id);
    });
    return { state, card, scrolls };
  }

  it("the close button restores the overview", () => {
    const { state, scrolls } = setup();
    const marker = doc.querySelector(".timeline__marker") as HTMLButtonElement;
    marker.focus();
    marker.click();
    expect(state.get().mode).toBe("project");
    scrolls.length = 0;

    doc.getElementById("close-project")!.click();
    expect(state.get()).toEqual({ mode: "overview" });
    expect(doc.getElementById("project-detail")?.hidden).toBe(true);
    expect(doc.body.dataset.mode).toBe("overview");
    expect(doc.getElementById("intro")?.getAttribute("data-hidden")).toBe("false");
    expect(scrolls).toEqual([0]); // overview scroll target (jsdom: no layout)
    expect(doc.querySelectorAll(".timeline__item[data-active]")).toHaveLength(0);
  });

  it("focus returns to the marker that opened the project", () => {
    const { state } = setup();
    const marker = doc.querySelector(".timeline__marker") as HTMLButtonElement;
    marker.focus();
    marker.click();
    expect(doc.activeElement).toBe(doc.getElementById("project-date"));
    doc.getElementById("close-project")!.click();
    expect(doc.activeElement).toBe(marker);
  });

  it("focus is not stolen on a project switch; the newest marker wins on close", () => {
    const { state } = setup();
    const first = doc.querySelectorAll(".timeline__marker")[0] as HTMLButtonElement;
    const second = doc.querySelectorAll(".timeline__marker")[1] as HTMLButtonElement;
    first.focus();
    first.click();
    second.focus();
    second.click();
    expect(state.get()).toEqual({ mode: "project", projectId: "2026-11-20" });
    doc.getElementById("close-project")!.click();
    expect(doc.activeElement).toBe(second);
  });

  it("repeated close clicks are state no-ops", () => {
    const { state, scrolls } = setup();
    (doc.querySelector(".timeline__marker") as HTMLButtonElement).click();
    scrolls.length = 0;
    doc.getElementById("close-project")!.click();
    doc.getElementById("close-project")!.click();
    doc.getElementById("close-project")!.click();
    expect(state.get()).toEqual({ mode: "overview" });
    expect(scrolls).toEqual([0]); // no repeated scroll transitions
  });
});
