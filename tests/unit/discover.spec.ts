import { describe, expect, it } from "vitest";
import {
  classifyGalleryAssets,
  discoverProject,
  discoverProjects,
  type FilesystemReader,
} from "../../src/lib/discover";

/** In-memory reader standing in for the real filesystem. */
function makeReader(
  tree: Record<string, string[] | string>,
): FilesystemReader & { files: Map<string, string> } {
  const dirs = new Map<string, string[]>();
  const files = new Map<string, string>();
  for (const [path, value] of Object.entries(tree)) {
    if (Array.isArray(value)) dirs.set(path, value);
    else files.set(path, value);
  }
  return {
    files,
    list(dir: string) {
      const names = dirs.get(dir);
      if (!names) {
        const error = new Error(`${dir} not found`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return names.map((name) => ({
        name,
        isDirectory: dirs.has(`${dir}/${name}`) || dirs.has(name),
      }));
    },
    readTextFile(path: string) {
      const content = files.get(path);
      if (content === undefined) {
        const error = new Error(`${path} not found`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return content;
    },
  };
}

describe("discoverProject", () => {
  const folder = "2026-12-03";
  const files = ["0.webp", "0.txt", "01-workspace.png", ".DS_Store"];

  it("accepts a fully valid project and trims the description", () => {
    const result = discoverProject(folder, files, "  Hello world. \n");
    expect(result.error).toBeUndefined();
    expect(result.project?.id).toBe("2026-12-03");
    expect(result.project?.description).toBe("Hello world.");
    expect(result.project?.featuredImage).toBe("0.webp");
  });

  it("warns when 0.txt is missing", () => {
    const result = discoverProject(folder, ["0.webp"], undefined);
    expect(result.warning).toContain("missing 0.txt");
    expect(result.project).toBeUndefined();
  });

  it("errors when 0.txt is empty or whitespace-only", () => {
    expect(discoverProject(folder, files, "")?.error).toContain("empty");
    expect(discoverProject(folder, files, "   \n\t ")?.error).toContain("empty");
  });

  it("errors when there is no featured image", () => {
    const result = discoverProject(folder, ["0.txt", "01.png"], "desc");
    expect(result.error).toContain("no featured image");
  });

  it("errors on multiple featured-image candidates", () => {
    const result = discoverProject(folder, ["0.txt", "0.png", "0.webp"], "desc");
    expect(result.error).toContain("featured-image candidates");
    expect(result.error).toContain("0.png, 0.webp");
  });

  it("errors on invalid folder names", () => {
    const result = discoverProject("2026-13-99", ["0.txt", "0.png"], "desc");
    expect(result.error).toContain("Invalid project folder name");
  });
});

describe("classifyGalleryAssets", () => {
  it("collects images and text files, excluding metadata and featured image", () => {
    const { assets, unsupported } = classifyGalleryAssets(
      ["0.webp", "0.txt", "01-workspace.png", "02-diagram.jpg", "notes.txt", "retrospective.md", "archive.zip", ".DS_Store"],
      "0.webp",
    );
    expect(assets.map((asset) => asset.type)).toEqual([
      "image",
      "image",
      "text",
      "text",
    ]);
    expect(assets.map((asset) => asset.name)).toEqual([
      "01-workspace.png",
      "02-diagram.jpg",
      "notes.txt",
      "retrospective.md",
    ]);
    expect(assets[2]?.mimeType).toBe("text/plain");
    expect(assets[3]?.mimeType).toBe("text/markdown");
    expect(unsupported).toEqual(["archive.zip"]);
  });

  it("sorts assets by filename deterministically", () => {
    const { assets } = classifyGalleryAssets(["c.jpg", "a.jpg", "b.txt"], "0.webp");
    expect(assets.map((asset) => asset.name)).toEqual(["a.jpg", "b.txt", "c.jpg"]);
  });

  it("keeps image and text files with the same basename as separate assets", () => {
    const { assets } = classifyGalleryAssets(["photo.jpg", "photo.txt"], "0.webp");
    expect(assets.map((asset) => asset.name)).toEqual(["photo.jpg", "photo.txt"]);
    expect(assets.map((asset) => asset.type)).toEqual(["image", "text"]);
  });
});

describe("discoverProjects", () => {
  const root = "/fake/projects";

  it("discovers multiple projects sorted newest first", () => {
    const reader = makeReader({
      [`${root}`]: ["2026-11-20", "2026-12-03"],
      [`${root}/2026-12-03`]: ["0.webp", "0.txt"],
      [`${root}/2026-12-03/0.webp`]: "img",
      [`${root}/2026-12-03/0.txt`]: "newer project",
      [`${root}/2026-11-20`]: ["0.gif", "0.txt"],
      [`${root}/2026-11-20/0.gif`]: "img",
      [`${root}/2026-11-20/0.txt`]: "older project",
    });
    const result = discoverProjects(reader, root);
    expect(result.projects.map((project) => project.id)).toEqual([
      "2026-12-03",
      "2026-11-20",
    ]);
    expect(result.projects[0]?.description).toBe("newer project");
    expect(result.projects[0]?.featuredImage).toBe("0.webp");
    expect(result.errors).toEqual([]);
  });

  it("returns no projects for a missing directory", () => {
    const reader = makeReader({});
    const result = discoverProjects(reader, root);
    expect(result.projects).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("collects errors and warnings without throwing", () => {
    const reader = makeReader({
      [`${root}`]: ["2026-13-99", "2025-05-01", "2024-01-01"],
      [`${root}/2026-13-99`]: ["0.txt", "0.webp"],
      "2026-13-99/0.txt": "invalid date folder",
      [`${root}/2025-05-01`]: ["0.png"],
      [`${root}/2024-01-01`]: ["0.txt", "0.png"],
      [`${root}/2024-01-01/0.txt`]: "  ",
      [`${root}/2024-01-01/0.png`]: "img",
    });
    const result = discoverProjects(reader, root);
    expect(result.projects.map((project) => project.id)).toEqual([]);
    expect(result.errors).toHaveLength(2); // invalid folder name + empty 0.txt
    expect(result.warnings).toHaveLength(1); // missing 0.txt
    expect(result.warnings[0]?.message).toContain("missing 0.txt");
  });
});
