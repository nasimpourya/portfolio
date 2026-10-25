import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverProjects } from "../../src/lib/discover";
import { buildManifest, safeJsonForHtml } from "../../src/lib/manifest";

/**
 * Integration test: real discovery + manifest generation over the committed
 * fixture tree in tests/fixtures/projects. Exercises the same code path as
 * the CLI without touching real portfolio content.
 */
const fixturesDir = join(import.meta.dirname, "..", "fixtures", "projects");

function fixtureReader() {
  return {
    list: (dir: string) =>
      readdirSync(dir, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      })),
    readTextFile: (path: string) => readFileSync(path, "utf8"),
  };
}

describe("discovery over committed fixtures", () => {
  const result = discoverProjects(fixtureReader(), fixturesDir);

  it("discovers the three valid projects, newest first", () => {
    expect(result.projects.map((project) => project.id)).toEqual([
      "2026-12-03",
      "2026-11-20",
      "2025-04-17",
    ]);
  });

  it("classifies gallery assets correctly per project", () => {
    const byId = new Map(result.projects.map((p) => [p.id, p]));
    expect(byId.get("2026-12-03")?.assets.map((a) => a.name)).toEqual([
      "01-workspace.webp",
      "02-diagram.webp",
      "notes.txt",
      "retrospective.md",
    ]);
    expect(byId.get("2026-11-20")?.assets.map((a) => a.name)).toEqual([
      "screenshot.webp",
    ]);
    expect(byId.get("2025-04-17")?.assets.map((a) => a.name)).toEqual([
      "draft.md",
    ]);
  });

  it("excludes hidden files, system junk, and unsupported formats", () => {
    const imageHeavy = result.projects[0]!;
    const names = imageHeavy.assets.map((asset) => asset.name);
    expect(names).not.toContain(".hidden.png");
    expect(names).not.toContain("archive.zip");
    expect(names).not.toContain("0.webp"); // featured image not duplicated
    expect(names).not.toContain("0.txt"); // metadata excluded
  });

  it("reports invalid folder names as errors", () => {
    const folders = result.errors.map((issue) => issue.folder);
    expect(folders).toContain("2026-13-99");
  });

  it("reports empty 0.txt as an error", () => {
    const folders = result.errors.map((issue) => issue.folder);
    expect(folders).toContain("2024-01-01");
  });

  it("reports ambiguous featured images as errors", () => {
    const folders = result.errors.map((issue) => issue.folder);
    expect(folders).toContain("2024-02-02");
  });

  it("skips missing 0.txt with a warning", () => {
    const folders = result.warnings.map((issue) => issue.folder);
    expect(folders).toContain("2025-05-01");
  });

  it("reports unsupported files as warnings without failing", () => {
    const warnings = result.warnings
      .filter((issue) => issue.folder === "2026-12-03")
      .map((issue) => issue.message)
      .join(" ");
    expect(warnings).toContain("archive.zip");
    expect(warnings).not.toContain("error");
  });
});

describe("manifest generation over fixtures", () => {
  const { projects } = discoverProjects(fixtureReader(), fixturesDir);
  const manifest = buildManifest(projects);

  it("matches schema version 1 with newest-first ordering", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.projects.map((project) => project.id)).toEqual([
      "2026-12-03",
      "2026-11-20",
      "2025-04-17",
    ]);
  });

  it("generates site-relative asset paths that escape no directory", () => {
    for (const project of manifest.projects) {
      expect(project.featuredImage).toMatch(/^projects\/[\d-]+\/0\.\w+$/);
      for (const asset of project.assets) {
        expect(asset.path).toMatch(/^projects\/[\d-]+\/[\w.-]+$/);
        expect(asset.path.includes("..")).toBe(false);
      }
    }
  });

  it("safely embeds project text containing script-injection payloads", () => {
    const embedded = safeJsonForHtml(manifest);
    expect(embedded).not.toContain("</script>");
    expect(embedded).not.toContain("<script>");
    // Round-trips to the original data:
    const parsed = JSON.parse(embedded) as typeof manifest;
    expect(parsed.projects[2]?.description).toContain("<script>");
  });

  it("resolves every generated reference to a real fixture file", () => {
    for (const project of manifest.projects) {
      const files = readdirSync(join(fixturesDir, project.id));
      for (const referenced of [project.featuredImage, ...project.assets.map((a) => a.path)]) {
        const fileName = referenced.split("/").pop()!;
        expect(files, referenced).toContain(fileName);
      }
    }
  });
});
