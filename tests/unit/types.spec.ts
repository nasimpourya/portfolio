import { describe, expect, it } from "vitest";
import {
  FEATURED_IMAGE_BASENAME,
  MANIFEST_SCHEMA_VERSION,
  PROJECT_DATE_PATTERN,
  REQUIRED_DESCRIPTION_FILE,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_TEXT_EXTENSIONS,
  type Project,
  type ProjectAsset,
  type ProjectManifest,
} from "../../src/data/types";

describe("manifest schema constants", () => {
  it("uses schema version 1", () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(1);
  });

  it("supports the documented image extensions", () => {
    expect(SUPPORTED_IMAGE_EXTENSIONS).toEqual([
      "jpg",
      "jpeg",
      "png",
      "webp",
      "avif",
      "gif",
    ]);
  });

  it("supports the documented text extensions", () => {
    expect(SUPPORTED_TEXT_EXTENSIONS).toEqual(["txt", "md", "markdown"]);
  });

  it("defines the required description file and featured-image basename", () => {
    expect(REQUIRED_DESCRIPTION_FILE).toBe("0.txt");
    expect(FEATURED_IMAGE_BASENAME).toBe("0");
  });

  it("matches strict YYYY-MM-DD folder dates", () => {
    expect(PROJECT_DATE_PATTERN.test("2026-12-03")).toBe(true);
    expect(PROJECT_DATE_PATTERN.test("2026-12-3")).toBe(false);
    expect(PROJECT_DATE_PATTERN.test("20261203")).toBe(false);
  });

  it("accepts a manifest conforming to the documented shape", () => {
    const image: ProjectAsset = {
      type: "image",
      name: "01-workspace",
      path: "projects/2026-12-03/01-workspace.jpg",
      mimeType: "image/jpeg",
    };
    const text: ProjectAsset = {
      type: "text",
      name: "notes",
      path: "projects/2026-12-03/notes.txt",
      mimeType: "text/plain",
    };
    const project: Project = {
      id: "2026-12-03",
      date: "2026-12-03",
      description: "Designed and launched a new architecture.",
      featuredImage: "projects/2026-12-03/0.webp",
      assets: [image, text],
    };
    const manifest: ProjectManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      projects: [project],
    };

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0]?.id).toBe("2026-12-03");
    expect(manifest.projects[0]?.assets[0]?.type).toBe("image");
  });
});
