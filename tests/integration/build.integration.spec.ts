import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Integration test: the complete build pipeline (TASK-012) run against
 * fixture content in a temporary root, never real portfolio content.
 */
const repoRoot = join(import.meta.dirname, "..", "..");
const fixturesProjects = join(repoRoot, "tests", "fixtures", "projects");
const fixturesContent = join(repoRoot, "tests", "fixtures", "content");

let workRoot: string;

beforeEach(() => {
  workRoot = join(tmpdir(), `portfolio-build-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(workRoot, "projects"), { recursive: true });
  mkdirSync(join(workRoot, "content"), { recursive: true });
  mkdirSync(join(workRoot, "assets"), { recursive: true });
  cpSync(fixturesContent, join(workRoot, "content"), { recursive: true });
  cpSync(
    join(fixturesContent, "profile.webp"),
    join(workRoot, "assets", "profile.webp"),
  );
});

afterEach(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** Copy the named valid fixture projects into the temporary root. */
function useProjects(...ids: string[]): void {
  for (const id of ids) {
    cpSync(join(fixturesProjects, id), join(workRoot, "projects", id), { recursive: true });
  }
}

function runBuild(options: { base?: string } = {}): { stdout: string } {
  const args = [
    "scripts/build.mjs",
    "--root",
    workRoot,
    "--out",
    join(workRoot, "dist"),
  ];
  if (options.base !== undefined) args.push("--base", options.base);
  const stdout = execFileSync("node", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return { stdout };
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

describe("build pipeline", () => {
  it("generates a deployable dist with manifest, code, and copied assets", () => {
    useProjects("2026-12-03", "2026-11-20");
    runBuild();

    const outDir = join(workRoot, "dist");
    const html = readFileSync(join(outDir, "index.html"), "utf8");

    // HTML assembled from the template with the manifest embedded.
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('id="app-data"');
    expect(html).toContain("2026-12-03");
    expect(html).toContain("Fixture Name");
    expect(html).not.toContain("{{"); // every token replaced

    // Bundled application code and CSS are inlined.
    expect(html).toMatch(/<style>/);
    expect(html).toContain("--page-max-width"); // from src/styles/base.css
    expect(html).not.toMatch(/<script src=/);

    // Project assets and the profile image exist in the output.
    expect(existsSync(join(outDir, "projects", "2026-12-03", "0.webp"))).toBe(true);
    expect(existsSync(join(outDir, "projects", "2026-12-03", "notes.txt"))).toBe(true);
    expect(existsSync(join(outDir, "assets", "profile.webp"))).toBe(true);

    // Invalid/ignored fixture content is not copied.
    expect(existsSync(join(outDir, "projects", "2026-13-99"))).toBe(false);
  });

  it("excludes folders without 0.txt and unsupported files", () => {
    useProjects("2026-12-03");
    runBuild();
    const outDir = join(workRoot, "dist");
    const files = listFiles(join(outDir, "projects"));
    const names = files.map((file) => file.split("/").pop());
    expect(names).not.toContain("archive.zip");
    expect(names).not.toContain(".hidden.png");
  });

  it("supports a repository-subpath base without malformed URLs", () => {
    useProjects("2026-11-20");
    runBuild({ base: "/portfolio" });
    const html = readFileSync(join(workRoot, "dist", "index.html"), "utf8");
    expect(html).toContain('<base href="/portfolio/"');
    expect(html).not.toContain("//projects");
  });

  it("produces equivalent output on repeated builds", () => {
    useProjects("2026-12-03", "2025-04-17");
    runBuild();
    const first = listFiles(join(workRoot, "dist")).map((file) => ({
      path: file,
      size: statSync(file).size,
      content: readFileSync(file, "utf8"),
    }));
    runBuild();
    const second = listFiles(join(workRoot, "dist")).map((file) => ({
      path: file,
      size: statSync(file).size,
      content: readFileSync(file, "utf8"),
    }));
    expect(second).toEqual(first);
  });

  it("fails with actionable errors on invalid project content", () => {
    useProjects("2026-13-99");
    expect(() => runBuild()).toThrow(/Invalid project folder name/);
  });

  it("fails when the profile configuration is missing", () => {
    rmSync(join(workRoot, "content", "profile.json"));
    expect(() => runBuild()).toThrow(/Missing profile configuration/);
  });

  it("builds an empty site when no projects exist", () => {
    runBuild();
    expect(existsSync(join(workRoot, "dist", "index.html"))).toBe(true);
  });
});
