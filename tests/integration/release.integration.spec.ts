import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectManifest } from "../../src/data/types.ts";

/**
 * TASK-036 release-readiness integration tests: the built dist is internally
 * consistent (every manifest reference resolves, nothing unreferenced is
 * copied), invalid content fails with actionable diagnostics, and builds are
 * clean and deterministic.
 */
const repoRoot = join(import.meta.dirname, "..", "..");
const fixturesProjects = join(repoRoot, "tests", "fixtures", "projects");
const fixturesContent = join(repoRoot, "tests", "fixtures", "content");

let workRoot: string;

beforeEach(() => {
  workRoot = join(tmpdir(), `portfolio-release-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(workRoot, "projects"), { recursive: true });
  mkdirSync(join(workRoot, "content"), { recursive: true });
  mkdirSync(join(workRoot, "assets"), { recursive: true });
  cpSync(fixturesContent, join(workRoot, "content"), { recursive: true });
  cpSync(join(fixturesContent, "profile.webp"), join(workRoot, "assets", "profile.webp"));
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

/** Create a minimal valid project with one named extra asset. */
function makeProject(date: string, extraAsset?: string): void {
  const dir = join(workRoot, "projects", date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "0.txt"), `Project dated ${date}.`);
  cpSync(join(fixturesProjects, "2026-12-03", "0.webp"), join(dir, "0.webp"));
  if (extraAsset !== undefined) {
    cpSync(join(fixturesProjects, "2026-12-03", extraAsset), join(dir, extraAsset));
  }
}

function runBuild(options: { base?: string } = {}): string {
  const args = ["scripts/build.mjs", "--root", workRoot, "--out", join(workRoot, "dist")];
  if (options.base !== undefined) args.push("--base", options.base);
  return runBuildScript(args);
}

/**
 * Run the build in a controlled environment: CI exports
 * PORTFOLIO_BASE_PATH for the deploy build, and without pinning it here
 * that ambient base leaks into every build that passes no --base.
 */
function runBuildScript(args: string[]): string {
  return execFileSync("node", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PORTFOLIO_BASE_PATH: "" },
  });
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

function readBuiltManifest(base = ""): ProjectManifest {
  const html = readFileSync(join(workRoot, "dist", "index.html"), "utf8");
  const match = html.match(/<script id="app-data" type="application\/json">(.*?)<\/script>/s);
  if (!match) throw new Error("app-data script not found in built HTML");
  // The embedded JSON escapes <, >, and & — all valid JSON escapes, so it
  // parses as-is.
  const appData = JSON.parse(match[1]!) as { manifest: ProjectManifest };
  return appData.manifest;
}

describe("output reference consistency", () => {
  it("resolves every manifest reference to a real file in dist", () => {
    useProjects("2026-12-03", "2026-11-20");
    runBuild({ base: "/portfolio" });

    const manifest = readBuiltManifest("/portfolio");
    expect(manifest.projects.length).toBe(2);
    // With a base path the manifest URLs are deployment-prefixed while dist
    // is the site root (TASK-013), so resolve against the unprefixed path.
    const deployed = (reference: string) => reference.replace(`portfolio/`, "");
    for (const project of manifest.projects) {
      expect(project.featuredImage).toMatch(/^\/portfolio\//);
      expect(existsSync(join(workRoot, "dist", deployed(project.featuredImage)))).toBe(true);
      for (const asset of project.assets) {
        expect(existsSync(join(workRoot, "dist", deployed(asset.path))), asset.path).toBe(true);
      }
    }
    expect(existsSync(join(workRoot, "dist", "assets", "profile.webp"))).toBe(true);
  });

  it("copies exactly the referenced project files and nothing else", () => {
    useProjects("2026-12-03");
    runBuild();

    const copied = readdirSync(join(workRoot, "dist", "projects", "2026-12-03")).sort();
    const manifest = readBuiltManifest();
    const referenced = [
      manifest.projects[0]!.featuredImage.split("/").pop(),
      ...manifest.projects[0]!.assets.map((asset) => asset.path.split("/").pop()),
    ].sort();
    expect(copied).toEqual(referenced);
    // Explicitly: the unsupported fixture and the metadata file never ship.
    expect(copied).not.toContain("archive.zip");
    expect(copied).not.toContain("0.txt");
  });

  it("strips stale output from previous builds", () => {
    makeProject("2026-12-03", "notes.txt");
    runBuild();
    expect(existsSync(join(workRoot, "dist", "projects", "2026-12-03", "notes.txt"))).toBe(true);

    // A clean rebuild (project changed on disk) must not leave stale files.
    rmSync(join(workRoot, "projects", "2026-12-03", "notes.txt"));
    writeFileSync(join(workRoot, "dist", "projects", "stale-artifact.txt"), "stale");
    runBuild();

    expect(existsSync(join(workRoot, "dist", "projects", "stale-artifact.txt"))).toBe(false);
    expect(existsSync(join(workRoot, "dist", "projects", "2026-12-03", "notes.txt"))).toBe(false);
    expect(existsSync(join(workRoot, "dist", "index.html"))).toBe(true);
  });

  it("never exposes local absolute paths or traversal in the output", () => {
    useProjects("2026-12-03");
    runBuild();

    for (const file of readdirSync(join(workRoot, "dist"), { recursive: true })) {
      const path = file.toString();
      if (path.endsWith(".html")) {
        const html = readFileSync(join(workRoot, "dist", path), "utf8");
        expect(html).not.toContain("/Users/");
        expect(html).not.toContain('src="..');
      }
    }
    const manifest = readBuiltManifest();
    for (const project of manifest.projects) {
      for (const reference of [project.featuredImage, ...project.assets.map((a) => a.path)]) {
        expect(reference).not.toMatch(/^\//);
        expect(reference).not.toContain("..");
      }
    }
  });
});

describe("actionable build failures", () => {
  it("fails on a project with no featured image", () => {
    const dir = join(workRoot, "projects", "2026-01-15");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "0.txt"), "No featured image here.");
    try {
      runBuild();
      throw new Error("expected the build to fail");
    } catch (error) {
      const message = (error as { stdout?: Buffer; stderr?: Buffer }).stderr?.toString() ?? String(error);
      expect(message).toMatch(/2026-01-15/);
      expect(message).toMatch(/featured image/i);
    }
  });

  it("fails on an ambiguous featured image", () => {
    const dir = join(workRoot, "projects", "2026-02-02");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "0.txt"), "Two featured images.");
    cpSync(join(fixturesProjects, "2026-12-03", "0.webp"), join(dir, "0.webp"));
    cpSync(join(fixturesProjects, "2026-11-20", "0.gif"), join(dir, "0.gif"));
    try {
      runBuild();
      throw new Error("expected the build to fail");
    } catch (error) {
      const message = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
      expect(message).toMatch(/2026-02-02/);
      expect(message).toMatch(/featured-image candidates|featured image/i);
    }
  });

  it("fails on an empty 0.txt", () => {
    const dir = join(workRoot, "projects", "2026-03-03");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "0.txt"), "   \n\t ");
    cpSync(join(fixturesProjects, "2026-12-03", "0.webp"), join(dir, "0.webp"));
    try {
      runBuild();
      throw new Error("expected the build to fail");
    } catch (error) {
      const message = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
      expect(message).toMatch(/2026-03-03/);
      expect(message).toMatch(/0\.txt|description/i);
    }
  });

  it("fails on an unresolvable profile image", () => {
    useProjects("2026-12-03");
    const profile = JSON.parse(readFileSync(join(workRoot, "content", "profile.json"), "utf8")) as {
      image: string;
    };
    profile.image = "assets/missing.webp";
    writeFileSync(join(workRoot, "content", "profile.json"), JSON.stringify(profile));
    try {
      runBuild();
      throw new Error("expected the build to fail");
    } catch (error) {
      const message = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
      expect(message).toMatch(/missing\.webp|profile/i);
    }
  });
});

describe("clean deterministic builds", () => {
  it("produces byte-identical output from two independent temp roots", () => {
    // Same inputs, two completely separate build environments.
    const secondRoot = join(tmpdir(), `portfolio-release-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      for (const root of [workRoot, secondRoot]) {
        mkdirSync(join(root, "projects"), { recursive: true });
        mkdirSync(join(root, "content"), { recursive: true });
        mkdirSync(join(root, "assets"), { recursive: true });
        cpSync(fixturesContent, join(root, "content"), { recursive: true });
        cpSync(join(fixturesContent, "profile.webp"), join(root, "assets", "profile.webp"));
        cpSync(join(fixturesProjects, "2026-12-03"), join(root, "projects", "2026-12-03"), { recursive: true });
        cpSync(join(fixturesProjects, "2026-11-20"), join(root, "projects", "2026-11-20"), { recursive: true });
        runBuildScript(["scripts/build.mjs", "--root", root, "--out", join(root, "dist")]);
      }

      const inventory = (root: string) =>
        listFiles(join(root, "dist")).map((file) => ({
          path: file.slice(root.length), // relative to the root: temp names differ
          size: statSync(file).size,
          content: readFileSync(file, "utf8"),
        }));
      expect(inventory(secondRoot)).toEqual(inventory(workRoot));
    } finally {
      rmSync(secondRoot, { recursive: true, force: true });
    }
  });
});
