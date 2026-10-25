import {
  MANIFEST_SCHEMA_VERSION,
  type Project,
  type ProjectAsset,
  type ProjectManifest,
} from "../data/types.ts";
import type { DiscoveredProject } from "./discover.ts";

/**
 * Manifest generation (Section 5.3): turn discovered projects into the
 * versioned, deterministic manifest embedded into dist/index.html.
 */

/**
 * Resolve the deployed path for a project file, honoring a base path
 * (Section 5.4). `basePath` may be "" or "/" for a root deployment and
 * "/repo" for a repository-subpath deployment.
 *
 * Throws when any part would escape the allowed directories: no `..`
 * segments, no embedded absolute paths.
 */
export function toDeployedPath(
  basePath: string,
  folderDate: string,
  fileName: string,
): string {
  assertNoTraversal(folderDate, "folder date");
  assertNoTraversal(fileName, "file name");
  const base = normalizeBasePath(basePath);
  // Empty base yields site-root-relative paths (no leading slash);
  // a "/repo" base yields domain-root-absolute paths for subpath deploys.
  return base === ""
    ? `projects/${folderDate}/${fileName}`
    : `${base}/projects/${folderDate}/${fileName}`;
}

/**
 * Normalize "" and "/" to "" ; strip a single trailing slash; reject
 * anything else that is not a "/repo"-style prefix.
 */
export function normalizeBasePath(basePath: string): string {
  if (basePath === "" || basePath === "/") return "";
  if (!basePath.startsWith("/")) {
    throw new Error(`Invalid base path "${basePath}" — must start with "/" or be empty.`);
  }
  const trimmed = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  assertNoTraversal(trimmed.slice(1), "base path");
  return trimmed;
}

/**
 * Reject anything that escapes the allowed directories: no ".", "..", or
 * empty segments, and no absolute paths.
 */
function assertNoTraversal(segment: string, label: string): void {
  if (segment.startsWith("/") || segment.endsWith("/") || segment.includes("//")) {
    throw new Error(`Unsafe ${label}: "${segment}".`);
  }
  for (const part of segment.split("/")) {
    if (part === ".." || part === ".") {
      throw new Error(`Unsafe ${label} contains "${part}" segment: "${segment}".`);
    }
  }
}

/**
 * Fill in deployed asset paths for a discovered project, including the
 * featured image. Paths are relative to the deployed site root.
 */
export function projectWithPaths(
  basePath: string,
  discovered: DiscoveredProject,
): Project {
  const assets: ProjectAsset[] = discovered.assets.map((asset) => ({
    ...asset,
    path: toDeployedPath(basePath, discovered.id, asset.name),
  }));
  return {
    id: discovered.id,
    date: discovered.id,
    description: discovered.description,
    featuredImage: toDeployedPath(basePath, discovered.id, discovered.featuredImage),
    assets,
  };
}

/**
 * Build the versioned manifest from discovered projects. Projects must
 * already be sorted newest first by the discovery step; sort again here
 * so the guarantee holds regardless of caller.
 */
export function buildManifest(
  discoveredProjects: DiscoveredProject[],
  basePath = "",
): ProjectManifest {
  const projects = discoveredProjects
    .map((discovered) => projectWithPaths(basePath, discovered))
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  return { schemaVersion: MANIFEST_SCHEMA_VERSION, projects };
}

/**
 * Serialize a manifest for safe embedding inside a <script> element in
 * dist/index.html (Section 8.1). Escapes the sequence that could close the
 * containing element and the line separators not allowed in JavaScript
 * string literals, so project text can never inject executable markup.
 */
export function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003C")
    .replaceAll(">", "\\u003E")
    .replaceAll("&", "\\u0026")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}
