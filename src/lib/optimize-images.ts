import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DiscoveredProject } from "./discover.ts";

/**
 * Build-time image optimization: convert JPEG/PNG sources to WebP so the
 * deployed site ships small files instead of multi-megabyte originals.
 *
 * - jpg/jpeg/png are converted in place (`x.jpg` → `x.webp`); existing
 *   webp/avif/gif files are left untouched — they are already web formats
 *   (and gif may be animated).
 * - The long edge is capped at MAX_LONG_EDGE pixels; EXIF rotation is
 *   baked in (`-auto-orient`) before metadata is dropped (`-strip`) and
 *   before resizing, so the cap measures oriented dimensions.
 * - Originals are never deleted: each source is moved into a gitignored
 *   archive (original-images/) mirroring the source tree, so the manifest
 *   — the dist copy allowlist — can never deploy them.
 *
 * Filesystem and process access is injected via dependency objects so
 * unit tests run hermetically (no ImageMagick, no disk), mirroring the
 * reader seam of discover.ts.
 */

/** Extensions whose files are converted to WebP during the build. */
export const CONVERTIBLE_EXTENSIONS = ["jpg", "jpeg", "png"] as const;

/** Converted images never exceed this many pixels on their long edge. */
export const MAX_LONG_EDGE = 1920;

/** WebP encoder quality, on ImageMagick's 0–100 scale. */
export const WEBP_QUALITY = 82;

/** One planned jpg/jpeg/png → webp conversion. */
export type PlannedConversion = {
  /** Absolute path of the convertible source file. */
  source: string;
  /** Absolute path of the WebP file written next to the source. */
  target: string;
  /** Absolute path under the archive the source is moved to after converting. */
  archivePath: string;
  /**
   * Profile conversions may overwrite an existing target (the checked-in
   * placeholder WebP); project targets must not exist.
   */
  isProfile: boolean;
  /** Root-relative source path for diagnostics, e.g. "projects/2026-12-03/0.jpg". */
  label: string;
};

/** The ImageMagick executable to invoke. IM7 ships `magick`; IM6 only `convert`. */
export type ImageTool = { command: "magick" | "convert" };

/** Runs `<command> -version` and returns its output, or null if it cannot run. */
export type Probe = (command: string) => string | null;

/**
 * Find a usable ImageMagick: probe `magick -version`, then `convert -version`,
 * accepting only output that mentions "ImageMagick". The fallback ordering
 * matters — CI's apt ImageMagick is IM6, which has no `magick` binary — and
 * the output check guards against the historical SysV `convert` utility that
 * collides with IM6's binary name. Returns null when nothing usable is found.
 */
export function detectImageTool(probe: Probe = defaultProbe): ImageTool | null {
  for (const command of ["magick", "convert"] as const) {
    const version = probe(command);
    if (version !== null && version.includes("ImageMagick")) {
      return { command };
    }
  }
  return null;
}

function defaultProbe(command: string): string | null {
  try {
    return execFileSync(command, ["-version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/** True when `fileName`'s final extension is one this pipeline converts. */
export function isConvertibleImage(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return false;
  const extension = fileName.slice(dot + 1).toLowerCase();
  return (CONVERTIBLE_EXTENSIONS as readonly string[]).includes(extension);
}

/** `photo.jpg` → `photo.webp`; only the final extension is replaced. */
export function webpNameFor(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? `${fileName.slice(0, dot)}.webp` : `${fileName}.webp`;
}

/**
 * Plan conversions for the featured image and every image asset of the
 * discovered (already validated) projects. Invalid folders never reach
 * this function — their discovery errors abort the build before any
 * mutation. The archive mirrors the project layout:
 * `<archiveRoot>/<projectId>/<fileName>`.
 */
export function planProjectConversions(
  projects: DiscoveredProject[],
  projectsDir: string,
  archiveRoot: string,
): PlannedConversion[] {
  const plan: PlannedConversion[] = [];
  for (const project of projects) {
    const images = [
      project.featuredImage,
      ...project.assets
        .filter((asset) => asset.type === "image")
        .map((asset) => asset.name),
    ];
    for (const name of images) {
      if (!isConvertibleImage(name)) continue;
      plan.push({
        source: join(projectsDir, project.id, name),
        target: join(projectsDir, project.id, webpNameFor(name)),
        archivePath: join(archiveRoot, project.id, name),
        isProfile: false,
        label: `projects/${project.id}/${name}`,
      });
    }
  }
  return plan;
}

/**
 * Plan the profile-image conversion, or null when the configured image is
 * not convertible (already WebP/AVIF/GIF; unsupported extensions are
 * rejected by profile validation separately). The archive mirrors the
 * root-relative path: `<archiveRoot>/assets/profile.png`.
 */
export function planProfileConversion(
  profileImage: string,
  root: string,
  archiveRoot: string,
): PlannedConversion | null {
  const fileName = profileImage.split("/").pop() ?? profileImage;
  if (!isConvertibleImage(fileName)) return null;
  return {
    source: join(root, profileImage),
    target: join(root, webpNameFor(profileImage)),
    archivePath: join(archiveRoot, profileImage),
    isProfile: true,
    label: profileImage,
  };
}

/**
 * Pre-flight collision check: a project conversion must not overwrite an
 * existing file, and no two conversions may produce the same target
 * (`x.jpg` and `x.jpeg` would both become `x.webp`). Profile targets are
 * exempt — replacing the checked-in placeholder WebP is the design.
 * Returns one diagnostic string per problem, each naming the files
 * involved; an empty list means the plan is safe to run.
 */
export function checkCollisions(
  plan: PlannedConversion[],
  deps: { exists: (path: string) => boolean },
): string[] {
  const errors: string[] = [];
  const plannedTargets = new Map<string, string>(); // target path → source label
  for (const item of plan) {
    const targetLabel = webpNameFor(item.label);
    if (!item.isProfile && deps.exists(item.target)) {
      errors.push(
        `Cannot convert ${item.label} — ${targetLabel} already exists; remove one of the two files and rebuild.`,
      );
      continue;
    }
    const earlierSource = plannedTargets.get(item.target);
    if (earlierSource !== undefined) {
      errors.push(
        `Cannot convert ${earlierSource} and ${item.label} — both would become ${targetLabel}; keep only one source.`,
      );
      continue;
    }
    plannedTargets.set(item.target, item.label);
  }
  return errors;
}

/** Filesystem/process seam; nodeOptimizeDeps is the real adapter. */
export type OptimizeDeps = {
  execFileSync: (command: string, args: readonly string[]) => string;
  existsSync: (path: string) => boolean;
  statSync: (path: string) => { size: number };
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  renameSync: (from: string, to: string) => void;
  rmSync: (path: string) => void;
};

/**
 * Run each conversion: write the WebP next to the source, verify it is a
 * nonempty file, then move the original into the archive. A failed
 * conversion removes its partial target and throws — sources stay in
 * place, and files already archived stay archived (their conversions
 * completed).
 */
export function runConversions(
  plan: PlannedConversion[],
  tool: ImageTool,
  deps: OptimizeDeps,
): void {
  for (const item of plan) {
    try {
      // Order is load-bearing: -auto-orient must precede -strip (bake in
      // EXIF rotation before dropping the tag) and -resize (the cap must
      // measure oriented dimensions).
      deps.execFileSync(tool.command, [
        item.source,
        "-auto-orient",
        "-strip",
        "-resize",
        `${MAX_LONG_EDGE}x${MAX_LONG_EDGE}>`,
        "-quality",
        String(WEBP_QUALITY),
        item.target,
      ]);
    } catch (error) {
      removePartial(deps, item.target);
      throw new Error(`Failed to convert ${item.label}: ${(error as Error).message}`);
    }
    const size = deps.existsSync(item.target) ? deps.statSync(item.target).size : 0;
    if (size <= 0) {
      removePartial(deps, item.target);
      throw new Error(`Failed to convert ${item.label} — the converter produced no output.`);
    }
    deps.mkdirSync(dirname(item.archivePath), { recursive: true });
    deps.renameSync(item.source, item.archivePath);
  }
}

function removePartial(deps: OptimizeDeps, target: string): void {
  try {
    deps.rmSync(target);
  } catch {
    // Best-effort: the real adapter forces, so only exotic failures land here.
  }
}

/** Text-file seam for the profile rewrite. */
export type TextDeps = {
  readTextFile: (path: string) => string;
  writeTextFile: (path: string, contents: string) => void;
};

/**
 * Point profile.json's `image` field at the converted WebP. The file is
 * round-tripped through parse/stringify with 2-space indentation and a
 * trailing newline, so key order, formatting, and any concurrent edits to
 * other fields are preserved. Returns the new image value.
 */
export function rewriteProfileImage(
  profilePath: string,
  profileImage: string,
  deps: TextDeps,
): string {
  const data: unknown = JSON.parse(deps.readTextFile(profilePath));
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${profilePath} is not a JSON object.`);
  }
  const record = data as Record<string, unknown>;
  const webpImage = webpNameFor(profileImage);
  record["image"] = webpImage;
  deps.writeTextFile(profilePath, `${JSON.stringify(record, null, 2)}\n`);
  return webpImage;
}

/** Real-filesystem adapter used by the build and optimize CLIs. */
export const nodeOptimizeDeps: OptimizeDeps = {
  execFileSync: (command, args) =>
    execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  existsSync,
  statSync,
  mkdirSync,
  renameSync,
  rmSync: (path) => rmSync(path, { force: true }),
};

export const nodeTextDeps: TextDeps = {
  readTextFile: (path) => readFileSync(path, "utf8"),
  writeTextFile: (path, contents) => writeFileSync(path, contents),
};
