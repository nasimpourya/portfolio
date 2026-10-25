import { join } from "node:path";
import {
  REQUIRED_DESCRIPTION_FILE,
  type ProjectAsset,
} from "../data/types.ts";
import {
  findFeaturedImageCandidates,
  getExtension,
  isExcludedFileName,
  isSupportedImageFile,
  isSupportedTextFile,
  isValidProjectDirName,
} from "./validate.ts";

/**
 * Project discovery: scan dated folders under `projects/` and turn each
 * eligible one into manifest-ready data (Section 4 of the plan).
 *
 * Rules:
 * - Folder names that are not real `YYYY-MM-DD` dates are validation errors.
 * - A folder without `0.txt` is skipped with a warning (TASK-007), not
 *   silently published.
 * - An empty or whitespace-only `0.txt` is a validation error (Section 4.2).
 * - A folder with 0 or 2+ featured-image candidates is a validation error —
 *   never an arbitrary pick (Section 4.2).
 * - Output is deterministic: assets sorted by filename, projects newest first.
 *
 * Filesystem access is injected via callbacks so unit tests need no fixtures.
 */

export type DiscoveryIssue = { folder: string; message: string };

export type DiscoveryResult = {
  projects: DiscoveredProject[];
  errors: DiscoveryIssue[];
  warnings: DiscoveryIssue[];
};

export type DiscoveredProject = {
  /** The folder date, e.g. "2026-12-03". Also the stable project ID. */
  id: string;
  /** Trimmed contents of `0.txt`. */
  description: string;
  /** Filename of the featured image, e.g. "0.webp". */
  featuredImage: string;
  /** Gallery assets, sorted by filename; excludes 0.txt and the featured image. */
  assets: ProjectAsset[];
};

/** Minimal filesystem interface, implemented with node:fs by the CLI. */
export type FilesystemReader = {
  list: (dir: string) => { name: string; isDirectory: boolean }[];
  readTextFile: (path: string) => string;
};

const TEXT_MIME_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

/** Compare by Unicode code points so sorting is stable across platforms. */
function byFileName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Newest first: descending by ISO date string, which sorts correctly lexically. */
function newestFirst(a: DiscoveredProject, b: DiscoveredProject): number {
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Scan one project folder and produce its data, or report why it is not
 * eligible. `folder` is the folder name (also its ID); `fileNames` are its
 * entries; `descriptionFile` is the raw contents of `0.txt` when present.
 */
export function discoverProject(
  folder: string,
  fileNames: string[],
  descriptionFile: string | undefined,
): { project?: DiscoveredProject; error?: string; warning?: string } {
  if (!isValidProjectDirName(folder)) {
    return {
      error: `Invalid project folder name "${folder}" — expected a real calendar date as YYYY-MM-DD.`,
    };
  }

  if (!fileNames.includes(REQUIRED_DESCRIPTION_FILE)) {
    return {
      warning: `Project "${folder}" is skipped: missing ${REQUIRED_DESCRIPTION_FILE}.`,
    };
  }

  if (descriptionFile === undefined) {
    return {
      error: `Project "${folder}": could not read ${REQUIRED_DESCRIPTION_FILE}.`,
    };
  }
  const description = descriptionFile.trim();
  if (description === "") {
    return {
      error: `Project "${folder}": ${REQUIRED_DESCRIPTION_FILE} is empty or whitespace-only.`,
    };
  }

  const featured = findFeaturedImageCandidates(fileNames);
  if (featured.length === 0) {
    return {
      error: `Project "${folder}" has no featured image — expected one supported image named "0" (e.g. 0.webp).`,
    };
  }
  if (featured.length > 1) {
    return {
      error: `Project "${folder}" has ${featured.length} featured-image candidates (${featured.sort(byFileName).join(", ")}) — keep exactly one.`,
    };
  }

  return {
    project: { id: folder, description, featuredImage: featured[0]!, assets: [] },
  };
}

/**
 * Classify the non-featured gallery files of a project folder.
 * Images and text files become tiles; everything else is reported as
 * unsupported. `name` keeps the full file name (extension included) so
 * paths, MIME types, and tile labels can be derived downstream; `path`
 * is left empty here and filled in during manifest generation.
 */
export function classifyGalleryAssets(
  fileNames: string[],
  featuredImage: string,
): { assets: ProjectAsset[]; unsupported: string[] } {
  const assets: ProjectAsset[] = [];
  const unsupported: string[] = [];

  const gallery = fileNames
    .filter((name) => name !== REQUIRED_DESCRIPTION_FILE && name !== featuredImage)
    .filter((name) => !isExcludedFileName(name))
    .sort(byFileName);

  for (const name of gallery) {
    const ext = getExtension(name);
    if (ext !== null && isSupportedImageFile(name)) {
      assets.push({
        type: "image",
        name,
        path: "",
        mimeType: `image/${ext === "jpg" ? "jpeg" : ext}`,
      });
    } else if (ext !== null && isSupportedTextFile(name)) {
      assets.push({
        type: "text",
        name,
        path: "",
        mimeType: TEXT_MIME_TYPES[ext] ?? "text/plain",
      });
    } else {
      unsupported.push(name);
    }
  }

  return { assets, unsupported };
}

/**
 * Discover all eligible projects under `projectsDir`.
 * Never throws for content problems — all failures surface as errors or
 * warnings in the result so the CLI can print actionable diagnostics.
 */
export function discoverProjects(
  reader: FilesystemReader,
  projectsDir: string,
): DiscoveryResult {
  const result: DiscoveryResult = { projects: [], errors: [], warnings: [] };

  let entries: { name: string; isDirectory: boolean }[];
  try {
    entries = reader.list(projectsDir);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return result;
    }
    throw error;
  }

  const folders = entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort(byFileName);

  for (const folder of folders) {
    const dirPath = join(projectsDir, folder);
    const fileNames = reader
      .list(dirPath)
      .map((entry) => entry.name)
      .sort(byFileName);

    let descriptionFile: string | undefined;
    if (fileNames.includes(REQUIRED_DESCRIPTION_FILE)) {
      try {
        descriptionFile = reader.readTextFile(
          join(dirPath, REQUIRED_DESCRIPTION_FILE),
        );
      } catch {
        descriptionFile = undefined;
      }
    }

    const outcome = discoverProject(folder, fileNames, descriptionFile);
    if (outcome.error) {
      result.errors.push({ folder, message: outcome.error });
      continue;
    }
    if (outcome.warning) {
      result.warnings.push({ folder, message: outcome.warning });
      continue;
    }
    if (!outcome.project) continue;

    const { assets, unsupported } = classifyGalleryAssets(
      fileNames,
      outcome.project.featuredImage,
    );
    result.projects.push({ ...outcome.project, assets });
    for (const name of unsupported) {
      result.warnings.push({
        folder,
        message: `Unsupported file ignored: ${name}.`,
      });
    }
  }

  result.projects.sort(newestFirst);
  return result;
}
