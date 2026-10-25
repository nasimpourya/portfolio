import { cpSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Integration test: base-path support (TASK-013, Section 5.4). The same
 * content must build correctly for a root-domain deployment and a
 * repository-subpath deployment, with no malformed URLs.
 */
const repoRoot = join(import.meta.dirname, "..", "..");
const fixturesProjects = join(repoRoot, "tests", "fixtures", "projects");
const fixturesContent = join(repoRoot, "tests", "fixtures", "content");

let workRoot: string;

beforeEach(() => {
  workRoot = join(tmpdir(), `portfolio-base-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(workRoot, "projects"), { recursive: true });
  mkdirSync(join(workRoot, "content"), { recursive: true });
  mkdirSync(join(workRoot, "assets"), { recursive: true });
  cpSync(fixturesContent, join(workRoot, "content"), { recursive: true });
  cpSync(join(fixturesContent, "profile.webp"), join(workRoot, "assets", "profile.webp"));
  cpSync(join(fixturesProjects, "2026-12-03"), join(workRoot, "projects", "2026-12-03"), {
    recursive: true,
  });
});

afterEach(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

function runBuild(options: { base?: string; env?: Record<string, string>; out?: string } = {}): string {
  const out = options.out ?? join(workRoot, "dist");
  const args = ["scripts/build.mjs", "--root", workRoot, "--out", out];
  if (options.base !== undefined) args.push("--base", options.base);
  execFileSync("node", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
  return readFileSync(join(out, "index.html"), "utf8");
}

describe("base-path configurations", () => {
  it("works at the root: site-relative URLs, no leading slash", () => {
    const html = runBuild({ base: "" });
    expect(html).toContain('href="/"');
    expect(html).toContain('"projects/2026-12-03/0.webp"');
    expect(html).not.toContain('"/projects/');
    expect(existsSync(join(workRoot, "dist", "projects", "2026-12-03", "0.webp"))).toBe(true);
  });

  it("works under a repository subpath: prefixed URLs, no double slashes", () => {
    const html = runBuild({ base: "/portfolio" });
    expect(html).toContain('href="/portfolio/"');
    expect(html).toContain('"/portfolio/projects/2026-12-03/0.webp"');
    expect(html).not.toContain('"//');
    expect(html).not.toContain("/portfolio//");
    expect(existsSync(join(workRoot, "dist", "portfolio", "projects", "2026-12-03", "0.webp"))).toBe(
      false,
    );
  });

  it("accepts the base path from the PORTFOLIO_BASE_PATH environment variable", () => {
    const html = runBuild({ env: { PORTFOLIO_BASE_PATH: "/envbase" }, out: join(workRoot, "dist-env") });
    expect(html).toContain('href="/envbase/"');
    expect(html).toContain('"/envbase/projects/2026-12-03/0.webp"');
  });

  it("rejects malformed base paths with a clear error", () => {
    expect(() => runBuild({ base: "portfolio" })).toThrow(/must start with/);
    expect(() => runBuild({ base: "/a/../b" })).toThrow();
  });
});
