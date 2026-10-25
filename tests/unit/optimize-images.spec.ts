import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DiscoveredProject } from "../../src/lib/discover";
import {
  checkCollisions,
  detectImageTool,
  isConvertibleImage,
  planProfileConversion,
  planProjectConversions,
  rewriteProfileImage,
  runConversions,
  webpNameFor,
  type OptimizeDeps,
  type PlannedConversion,
} from "../../src/lib/optimize-images";

/**
 * Hermetic unit tests for the image-optimization pipeline: no ImageMagick
 * and no real filesystem — process and disk access go through the injected
 * seams, mirroring discover.ts's reader-based tests. Real conversions are
 * covered by tests/integration/optimize-images.integration.spec.ts.
 */

function makeProject(id: string, featuredImage: string, assetNames: string[]): DiscoveredProject {
  return {
    id,
    description: `Project ${id}`,
    featuredImage,
    assets: assetNames.map((name) => ({
      type: name.endsWith(".txt") || name.endsWith(".md") ? "text" : "image",
      name,
      path: "",
      mimeType: "image/jpeg",
    })),
  };
}

describe("isConvertibleImage", () => {
  it("converts jpg, jpeg, and png regardless of case", () => {
    expect(isConvertibleImage("0.jpg")).toBe(true);
    expect(isConvertibleImage("photo.jpeg")).toBe(true);
    expect(isConvertibleImage("shot.PNG")).toBe(true);
    expect(isConvertibleImage("shot.Jpg")).toBe(true);
  });

  it("leaves web formats and non-images alone", () => {
    expect(isConvertibleImage("0.webp")).toBe(false);
    expect(isConvertibleImage("0.avif")).toBe(false);
    expect(isConvertibleImage("0.gif")).toBe(false);
    expect(isConvertibleImage("archive.zip")).toBe(false);
    expect(isConvertibleImage("notes.txt")).toBe(false);
    expect(isConvertibleImage("no-extension")).toBe(false);
  });
});

describe("webpNameFor", () => {
  it("replaces only the final extension", () => {
    expect(webpNameFor("photo.jpg")).toBe("photo.webp");
    expect(webpNameFor("bruno.el2SpbIEEw8-unsplash.jpeg")).toBe(
      "bruno.el2SpbIEEw8-unsplash.webp",
    );
    expect(webpNameFor("a.b.png")).toBe("a.b.webp");
  });

  it("appends .webp when there is no extension", () => {
    expect(webpNameFor("README")).toBe("README.webp");
  });
});

describe("detectImageTool", () => {
  it("prefers magick and never probes convert when it answers", () => {
    const probed: string[] = [];
    const tool = detectImageTool((command) => {
      probed.push(command);
      return command === "magick" ? "Version: ImageMagick 7.1.1-47" : null;
    });
    expect(tool).toEqual({ command: "magick" });
    expect(probed).toEqual(["magick"]);
  });

  it("falls back to convert for ImageMagick 6", () => {
    const tool = detectImageTool((command) =>
      command === "convert" ? "Version: ImageMagick 6.9.12" : null,
    );
    expect(tool).toEqual({ command: "convert" });
  });

  it("returns null when no candidate command runs", () => {
    expect(detectImageTool(() => null)).toBeNull();
  });

  it("rejects the historical SysV convert that is not ImageMagick", () => {
    // The SysV utility's usage text must not be mistaken for IM6.
    const tool = detectImageTool(
      () => "usage: convert [-blocksize] [file ...]\nconvert: converts files",
    );
    expect(tool).toBeNull();
  });
});

describe("planProjectConversions", () => {
  const projectsDir = join("/site", "projects");
  const archiveRoot = join("/site", "original-images");

  it("plans featured and gallery conversions, skipping non-convertibles", () => {
    const projects = [
      makeProject("2026-12-03", "0.jpg", ["01-workspace.png", "notes.txt", "02-diagram.webp"]),
    ];
    const plan = planProjectConversions(projects, projectsDir, archiveRoot);
    expect(plan.map((item) => item.label)).toEqual([
      "projects/2026-12-03/0.jpg",
      "projects/2026-12-03/01-workspace.png",
    ]);
  });

  it("mirrors the project layout in the archive and targets beside the source", () => {
    const plan = planProjectConversions(
      [makeProject("2023-11-02", "0.jpg", ["shot.png"])],
      projectsDir,
      archiveRoot,
    );
    expect(plan).toHaveLength(2);
    const [featured, gallery] = plan as [PlannedConversion, PlannedConversion];
    expect(featured.source).toBe(join(projectsDir, "2023-11-02", "0.jpg"));
    expect(featured.target).toBe(join(projectsDir, "2023-11-02", "0.webp"));
    expect(featured.archivePath).toBe(join(archiveRoot, "2023-11-02", "0.jpg"));
    expect(featured.isProfile).toBe(false);
    expect(gallery.archivePath).toBe(join(archiveRoot, "2023-11-02", "shot.png"));
  });
});

describe("planProfileConversion", () => {
  const root = "/site";
  const archiveRoot = join(root, "original-images");

  it("plans the conversion and mirrors the root-relative path in the archive", () => {
    const plan = planProfileConversion("assets/profile.png", root, archiveRoot);
    expect(plan).not.toBeNull();
    expect(plan!.source).toBe(join(root, "assets", "profile.png"));
    expect(plan!.target).toBe(join(root, "assets", "profile.webp"));
    expect(plan!.archivePath).toBe(join(archiveRoot, "assets", "profile.png"));
    expect(plan!.isProfile).toBe(true);
    expect(plan!.label).toBe("assets/profile.png");
  });

  it("returns null when the profile image needs no conversion", () => {
    expect(planProfileConversion("assets/profile.webp", root, archiveRoot)).toBeNull();
    expect(planProfileConversion("assets/profile.gif", root, archiveRoot)).toBeNull();
    expect(planProfileConversion("assets/profile.avif", root, archiveRoot)).toBeNull();
  });
});

describe("checkCollisions", () => {
  function projectConversion(source: string, target: string, label: string): PlannedConversion {
    return { source, target, archivePath: `${source}.archive`, isProfile: false, label };
  }

  it("errors when a project target already exists, naming both files", () => {
    const plan = [
      projectConversion("/p/shot.jpg", "/p/shot.webp", "projects/2026-12-03/shot.jpg"),
    ];
    const errors = checkCollisions(plan, { exists: (path) => path === "/p/shot.webp" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("shot.jpg");
    expect(errors[0]).toContain("shot.webp");
  });

  it("allows a profile target to exist (placeholder replacement)", () => {
    const plan: PlannedConversion[] = [
      {
        source: "/site/assets/profile.png",
        target: "/site/assets/profile.webp",
        archivePath: "/archive/assets/profile.png",
        isProfile: true,
        label: "assets/profile.png",
      },
    ];
    expect(checkCollisions(plan, { exists: () => true })).toEqual([]);
  });

  it("errors when two conversions would produce the same target", () => {
    const plan = [
      projectConversion("/p/x.jpg", "/p/x.webp", "projects/2026-12-03/x.jpg"),
      projectConversion("/p/x.jpeg", "/p/x.webp", "projects/2026-12-03/x.jpeg"),
    ];
    const errors = checkCollisions(plan, { exists: () => false });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("x.jpg");
    expect(errors[0]).toContain("x.jpeg");
  });

  it("passes a clean plan", () => {
    const plan = [projectConversion("/p/0.jpg", "/p/0.webp", "projects/2026-12-03/0.jpg")];
    expect(checkCollisions(plan, { exists: () => false })).toEqual([]);
  });
});

describe("runConversions", () => {
  function fakeDeps(overrides: Partial<OptimizeDeps> = {}): OptimizeDeps & {
    calls: { exec: [string, readonly string[]][]; mkdir: string[]; rename: [string, string][]; rm: string[] };
  } {
    const calls = { exec: [] as [string, readonly string[]][], mkdir: [] as string[], rename: [] as [string, string][], rm: [] as string[] };
    return {
      calls,
      execFileSync: (command, args) => {
        calls.exec.push([command, args]);
        return "";
      },
      existsSync: () => true,
      statSync: () => ({ size: 4096 }),
      mkdirSync: (path) => {
        calls.mkdir.push(path);
      },
      renameSync: (from, to) => {
        calls.rename.push([from, to]);
      },
      rmSync: (path) => {
        calls.rm.push(path);
      },
      ...overrides,
    };
  }

  const conversion: PlannedConversion = {
    source: "/p/0.jpg",
    target: "/p/0.webp",
    archivePath: "/archive/2026-12-03/0.jpg",
    isProfile: false,
    label: "projects/2026-12-03/0.jpg",
  };

  it("converts with auto-orient before strip and resize, then archives the original", () => {
    const deps = fakeDeps();
    runConversions([conversion], { command: "magick" }, deps);
    expect(deps.calls.exec).toHaveLength(1);
    const [command, args] = deps.calls.exec[0]!;
    expect(command).toBe("magick");
    expect(args).toEqual([
      "/p/0.jpg",
      "-auto-orient",
      "-strip",
      "-resize",
      "1920x1920>",
      "-quality",
      "82",
      "/p/0.webp",
    ]);
    expect(args!.indexOf("-auto-orient")).toBeLessThan(args!.indexOf("-strip"));
    expect(args!.indexOf("-strip")).toBeLessThan(args!.indexOf("-resize"));
    // The archive directory is created before the source is moved into it.
    expect(deps.calls.mkdir).toEqual(["/archive/2026-12-03"]);
    expect(deps.calls.rename).toEqual([["/p/0.jpg", "/archive/2026-12-03/0.jpg"]]);
    expect(deps.calls.rm).toEqual([]);
  });

  it("removes the partial target and throws when the converter fails", () => {
    const deps = fakeDeps({
      execFileSync: () => {
        throw new Error("boom");
      },
    });
    expect(() => runConversions([conversion], { command: "convert" }, deps)).toThrow(
      /projects\/2026-12-03\/0\.jpg.*boom/s,
    );
    expect(deps.calls.rm).toEqual(["/p/0.webp"]);
    expect(deps.calls.rename).toEqual([]); // the source stays in place
  });

  it("removes the partial target and throws on empty converter output", () => {
    const deps = fakeDeps({ statSync: () => ({ size: 0 }) });
    expect(() => runConversions([conversion], { command: "magick" }, deps)).toThrow(
      /produced no output/,
    );
    expect(deps.calls.rm).toEqual(["/p/0.webp"]);
    expect(deps.calls.rename).toEqual([]);
  });
});

describe("rewriteProfileImage", () => {
  const original = [
    "{",
    '  "name": "Nasim Pourya",',
    '  "headline": "Passionate artist to be",',
    '  "intro": "Uncommitted local edit.",',
    '  "image": "assets/profile.png",',
    '  "imageAlt": "Portrait of Nasim Pourya"',
    "}",
    "",
  ].join("\n");

  it("rewrites the image field preserving order, indentation, newline, and edits", () => {
    let written = "";
    const newValue = rewriteProfileImage("/site/content/profile.json", "assets/profile.png", {
      readTextFile: () => original,
      writeTextFile: (path, contents) => {
        written = contents;
      },
    });
    expect(newValue).toBe("assets/profile.webp");
    expect(written.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(written) as Record<string, string>;
    expect(Object.keys(parsed)).toEqual(["name", "headline", "intro", "image", "imageAlt"]);
    expect(parsed["image"]).toBe("assets/profile.webp");
    expect(parsed["intro"]).toBe("Uncommitted local edit.");
    expect(written).toContain('\n  "name"'); // 2-space indentation kept
  });

  it("refuses a profile file that is not a JSON object", () => {
    expect(() =>
      rewriteProfileImage("/site/content/profile.json", "assets/profile.png", {
        readTextFile: () => "[]",
        writeTextFile: () => {},
      }),
    ).toThrow(/not a JSON object/);
  });
});
