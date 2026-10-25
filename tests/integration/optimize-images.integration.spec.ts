import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectImageTool } from "../../src/lib/optimize-images";

/**
 * Integration tests for build-time image optimization: real ImageMagick
 * conversions in a temporary root, never real portfolio content. The
 * conversion tests are skipped when ImageMagick is unavailable; the
 * failure-path tests (install hint, invalid folders, clean fast path)
 * never invoke a converter and always run.
 */
const repoRoot = join(import.meta.dirname, "..", "..");
const fixturesProjects = join(repoRoot, "tests", "fixtures", "projects");
const fixturesContent = join(repoRoot, "tests", "fixtures", "content");
const conversionFixtures = join(repoRoot, "tests", "fixtures", "conversion");

const imageTool = detectImageTool();

let workRoot: string;

beforeEach(() => {
  workRoot = join(tmpdir(), `portfolio-optimize-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(workRoot, "projects"), { recursive: true });
  cpSync(fixturesContent, join(workRoot, "content"), { recursive: true });
  mkdirSync(join(workRoot, "assets"), { recursive: true });
  cpSync(join(fixturesContent, "profile.webp"), join(workRoot, "assets", "profile.webp"));
});

afterEach(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** Write a profile.json with the given `image` value into the temp root. */
function writeProfile(image: string, intro = "Fixture introduction text."): void {
  writeFileSync(
    join(workRoot, "content", "profile.json"),
    `${JSON.stringify(
      {
        name: "Fixture Name",
        headline: "Fixture headline for integration tests.",
        intro,
        image,
        imageAlt: "Fixture portrait",
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Create a project folder. `files` maps file names to either a source path
 * to copy from or a string to write as text content.
 */
function makeProject(
  date: string,
  files: Record<string, string>,
): void {
  const dir = join(workRoot, "projects", date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "0.txt"), `Project dated ${date}.`);
  for (const [name, source] of Object.entries(files)) {
    if (name === "0.txt") continue;
    if (existsSync(source)) cpSync(source, join(dir, name));
    else writeFileSync(join(dir, name), source);
  }
}

function runBuild(): string {
  return execFileSync(
    process.execPath,
    ["scripts/build.mjs", "--root", workRoot, "--out", join(workRoot, "dist")],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

function runOptimize(): string {
  return execFileSync(process.execPath, ["scripts/optimize-images.mjs", "--root", workRoot], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

/** "WxH" pixel dimensions, via the ImageMagick suite's identify. */
function identify(path: string): string {
  return execFileSync("identify", ["-format", "%wx%h", path], { encoding: "utf8" });
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files.sort();
}

function inventory(dir: string): { path: string; size: number; content: string }[] {
  return listFiles(dir).map((file) => ({
    path: file.slice(dir.length),
    size: statSync(file).size,
    content: readFileSync(file, "utf8"),
  }));
}

describe.skipIf(imageTool === null)("image conversion (requires ImageMagick)", () => {
  it("converts jpg and png to capped WebP and archives the originals", () => {
    makeProject("2026-01-10", {
      "0.jpg": join(conversionFixtures, "wide.jpg"), // 2000x1000 → 1920x960
      "tower.png": join(conversionFixtures, "tall.png"), // 1000x2000 → 960x1920
    });
    runBuild();

    const projectDir = join(workRoot, "projects", "2026-01-10");
    // Converted files replace the sources; originals moved to the archive.
    expect(existsSync(join(projectDir, "0.webp"))).toBe(true);
    expect(existsSync(join(projectDir, "tower.webp"))).toBe(true);
    expect(existsSync(join(projectDir, "0.jpg"))).toBe(false);
    expect(existsSync(join(projectDir, "tower.png"))).toBe(false);
    expect(existsSync(join(workRoot, "original-images", "2026-01-10", "0.jpg"))).toBe(true);
    expect(existsSync(join(workRoot, "original-images", "2026-01-10", "tower.png"))).toBe(true);

    // The resize cap applies to both orientations, never upscaling.
    expect(identify(join(projectDir, "0.webp"))).toBe("1920x960");
    expect(identify(join(projectDir, "tower.webp"))).toBe("960x1920");

    // The manifest (and dist) reference the converted WebP only.
    expect(existsSync(join(workRoot, "dist", "projects", "2026-01-10", "0.webp"))).toBe(true);
    expect(existsSync(join(workRoot, "dist", "projects", "2026-01-10", "tower.webp"))).toBe(true);
    expect(existsSync(join(workRoot, "dist", "projects", "2026-01-10", "0.jpg"))).toBe(false);
  });

  it("rewrites profile.json and replaces the placeholder WebP", () => {
    writeProfile("assets/profile.png", "Uncommitted local intro edit.");
    cpSync(join(conversionFixtures, "tall.png"), join(workRoot, "assets", "profile.png"));
    // The checked-in 34-byte placeholder copied in beforeEach must be replaced.
    expect(statSync(join(workRoot, "assets", "profile.webp")).size).toBe(34);
    makeProject("2026-01-10", {
      "0.webp": join(fixturesProjects, "2026-12-03", "0.webp"),
    });
    runBuild();

    const raw = readFileSync(join(workRoot, "content", "profile.json"), "utf8");
    expect((JSON.parse(raw) as { image: string }).image).toBe("assets/profile.webp");
    // Formatting and concurrent edits survive the rewrite.
    expect(raw.startsWith('{\n  "name"')).toBe(true);
    expect(raw.endsWith("}\n")).toBe(true);
    expect(raw).toContain("Uncommitted local intro edit.");

    const webp = join(workRoot, "assets", "profile.webp");
    expect(statSync(webp).size).toBeGreaterThan(34);
    expect(identify(webp)).toBe("960x1920");
    expect(existsSync(join(workRoot, "assets", "profile.png"))).toBe(false);
    expect(existsSync(join(workRoot, "original-images", "assets", "profile.png"))).toBe(true);
    // The deployed copy is the real conversion.
    expect(statSync(join(workRoot, "dist", "assets", "profile.webp")).size).toBe(
      statSync(webp).size,
    );
  });

  it("keeps the second build byte-identical via the no-conversion fast path", () => {
    makeProject("2026-01-10", { "0.jpg": join(conversionFixtures, "wide.jpg") });
    const first = runBuild();
    expect(first).toContain("converted");
    const firstInventory = inventory(join(workRoot, "dist"));

    const second = runBuild();
    expect(second).not.toContain("converted"); // nothing left to convert
    expect(inventory(join(workRoot, "dist"))).toEqual(firstInventory);
  });

  it("leaves gif and webp sources untouched", () => {
    makeProject("2026-01-10", {
      "0.gif": join(fixturesProjects, "2026-11-20", "0.gif"),
      "shot.webp": join(fixturesProjects, "2026-12-03", "01-workspace.webp"),
    });
    runBuild();
    const projectDir = join(workRoot, "projects", "2026-01-10");
    expect(existsSync(join(projectDir, "0.gif"))).toBe(true);
    expect(existsSync(join(projectDir, "shot.webp"))).toBe(true);
    expect(existsSync(join(workRoot, "original-images"))).toBe(false);
  });

  it("fails with both file names on a gallery target collision", () => {
    makeProject("2026-01-10", {
      "0.jpg": join(conversionFixtures, "wide.jpg"),
      "shot.jpg": join(conversionFixtures, "wide.jpg"),
      "shot.webp": join(fixturesProjects, "2026-12-03", "01-workspace.webp"),
    });
    try {
      runBuild();
      throw new Error("expected the build to fail");
    } catch (error) {
      const message =
        (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
      expect(message).toContain("shot.jpg");
      expect(message).toContain("shot.webp");
    }
    // Nothing was mutated: the sources stay, no archive is created.
    expect(existsSync(join(workRoot, "projects", "2026-01-10", "shot.jpg"))).toBe(true);
    expect(existsSync(join(workRoot, "original-images"))).toBe(false);
  });

  it("standalone CLI converts, then reports clean on a second run", () => {
    writeProfile("assets/profile.png");
    cpSync(join(conversionFixtures, "tall.png"), join(workRoot, "assets", "profile.png"));
    makeProject("2026-01-10", { "0.jpg": join(conversionFixtures, "wide.jpg") });

    const first = runOptimize();
    expect(first).toContain("converted 2 image(s)");
    expect(existsSync(join(workRoot, "projects", "2026-01-10", "0.webp"))).toBe(true);
    expect(existsSync(join(workRoot, "original-images", "2026-01-10", "0.jpg"))).toBe(true);
    expect(
      (JSON.parse(readFileSync(join(workRoot, "content", "profile.json"), "utf8")) as { image: string }).image,
    ).toBe("assets/profile.webp");

    const second = runOptimize();
    expect(second).toContain("0 image(s)");
  });
});

describe("failure paths (no ImageMagick required)", () => {
  it("fails with an install hint when conversions are needed but no tool is on PATH", () => {
    makeProject("2026-01-10", { "0.jpg": join(conversionFixtures, "wide.jpg") });
    try {
      execFileSync(
        process.execPath,
        ["scripts/build.mjs", "--root", workRoot, "--out", join(workRoot, "dist")],
        { cwd: repoRoot, encoding: "utf8", env: { PATH: "" } },
      );
      throw new Error("expected the build to fail");
    } catch (error) {
      const message =
        (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
      expect(message).toMatch(/imagemagick/i);
      expect(message).toMatch(/brew install|apt-get install/);
    }
    // The failing build mutated nothing.
    expect(existsSync(join(workRoot, "projects", "2026-01-10", "0.jpg"))).toBe(true);
    expect(existsSync(join(workRoot, "original-images"))).toBe(false);
  });

  it("fails on invalid folders before touching any convertible image", () => {
    makeProject("2026-01-10", { "0.jpg": join(conversionFixtures, "wide.jpg") });
    makeProject("2026-13-99", { "0.jpg": join(conversionFixtures, "wide.jpg") });
    try {
      runBuild();
      throw new Error("expected the build to fail");
    } catch (error) {
      const message =
        (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
      expect(message).toMatch(/2026-13-99/);
    }
    expect(existsSync(join(workRoot, "projects", "2026-01-10", "0.jpg"))).toBe(true);
    expect(existsSync(join(workRoot, "projects", "2026-13-99", "0.jpg"))).toBe(true);
    expect(existsSync(join(workRoot, "original-images"))).toBe(false);
  });

  it("standalone CLI exits clean on an already-converted tree", () => {
    cpSync(
      join(fixturesProjects, "2026-12-03"),
      join(workRoot, "projects", "2026-12-03"),
      { recursive: true },
    );
    const output = runOptimize();
    expect(output).toContain("0 image(s)");
    expect(existsSync(join(workRoot, "original-images"))).toBe(false);
  });
});
