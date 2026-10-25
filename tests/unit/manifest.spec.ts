import { describe, expect, it } from "vitest";
import type { DiscoveredProject } from "../../src/lib/discover";
import {
  buildManifest,
  normalizeBasePath,
  projectWithPaths,
  safeJsonForHtml,
  toDeployedPath,
} from "../../src/lib/manifest";

const discovered: DiscoveredProject[] = [
  {
    id: "2026-12-03",
    description: "A newer project.",
    featuredImage: "0.webp",
    assets: [
      { type: "image", name: "01-workspace.png", path: "", mimeType: "image/png" },
      { type: "text", name: "notes.txt", path: "", mimeType: "text/plain" },
    ],
  },
  {
    id: "2026-11-20",
    description: "An older project.",
    featuredImage: "0.gif",
    assets: [],
  },
];

describe("toDeployedPath", () => {
  it("builds root-relative paths with an empty base", () => {
    expect(toDeployedPath("", "2026-12-03", "0.webp")).toBe(
      "projects/2026-12-03/0.webp",
    );
  });

  it("supports a repository-subpath base", () => {
    expect(toDeployedPath("/portfolio", "2026-12-03", "notes.txt")).toBe(
      "/portfolio/projects/2026-12-03/notes.txt",
    );
  });

  it("normalizes trailing slashes in the base path", () => {
    expect(toDeployedPath("/portfolio/", "2026-12-03", "0.png")).toBe(
      "/portfolio/projects/2026-12-03/0.png",
    );
  });

  it("rejects traversal and absolute paths", () => {
    expect(() => toDeployedPath("", "../../etc", "passwd")).toThrow();
    expect(() => toDeployedPath("", "2026-12-03", "../0.webp")).toThrow();
    expect(() => toDeployedPath("", "/etc", "passwd")).toThrow();
    expect(() => normalizeBasePath("portfolio")).toThrow();
    expect(() => normalizeBasePath("/a/../b")).toThrow();
    expect(() => normalizeBasePath("/a//b")).toThrow();
  });
});

describe("projectWithPaths", () => {
  it("fills in deployed paths for the featured image and assets", () => {
    const project = projectWithPaths("", discovered[0]!);
    expect(project.featuredImage).toBe("projects/2026-12-03/0.webp");
    expect(project.assets[0]?.path).toBe("projects/2026-12-03/01-workspace.png");
    expect(project.assets[1]?.path).toBe("projects/2026-12-03/notes.txt");
    expect(project.description).toBe("A newer project.");
  });
});

describe("buildManifest", () => {
  it("orders projects newest first regardless of input order", () => {
    const manifest = buildManifest([discovered[1]!, discovered[0]!]);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.projects.map((project) => project.id)).toEqual([
      "2026-12-03",
      "2026-11-20",
    ]);
  });

  it("exposes no local filesystem paths", () => {
    const manifest = buildManifest(discovered, "/portfolio");
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("..");
    for (const project of manifest.projects) {
      expect(project.featuredImage.startsWith("/portfolio/projects/")).toBe(true);
      for (const asset of project.assets) {
        expect(asset.path.startsWith("/portfolio/projects/")).toBe(true);
      }
    }
  });

  it("handles an empty project list", () => {
    expect(buildManifest([])).toEqual({ schemaVersion: 1, projects: [] });
  });
});

describe("safeJsonForHtml", () => {
  it("prevents closing the containing script element", () => {
    const json = safeJsonForHtml({
      description: '</script><script>alert("pwned")</script>',
    });
    expect(json).not.toContain("</script>");
    expect(json).not.toContain("<script>");
  });

  it("escapes line separators and ampersands", () => {
    expect(safeJsonForHtml({ text: "a b c&d" })).toBe(
      '{"text":"a\\u2028b\\u2029c\\u0026d"}',
    );
  });

  it("round-trips through JSON.parse unchanged", () => {
    const original = {
      description: '</script> & "quotes"   done',
    };
    const parsed = JSON.parse(safeJsonForHtml(original)) as typeof original;
    expect(parsed.description).toBe(original.description);
  });
});
