import { isSupportedImageFile, isExcludedFileName } from "./validate.ts";

/**
 * Profile configuration loading and validation (Section 3.1).
 * All profile text is untrusted content: the browser side must render it
 * with textContent, never innerHTML. This module only validates shape.
 */

export type Profile = {
  name: string;
  headline: string;
  intro: string;
  image: string;
  imageAlt: string;
};

const REQUIRED_FIELDS = ["name", "headline", "intro", "image", "imageAlt"] as const;

/** Validate the parsed profile object. Returns a list of problems found. */
export function validateProfile(value: unknown): { profile?: Profile; errors: string[] } {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { errors: ["Profile must be a JSON object."] };
  }

  const record = value as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    const fieldValue = record[field];
    if (typeof fieldValue !== "string") {
      errors.push(`Profile field "${field}" must be a string.`);
      continue;
    }
    if (fieldValue.trim() === "") {
      errors.push(`Profile field "${field}" must not be empty.`);
    }
  }

  const image = record["image"];
  if (typeof image === "string" && image.trim() !== "") {
    const baseName = image.split("/").pop() ?? image;
    if (!isSupportedImageFile(baseName)) {
      errors.push(
        `Profile image "${image}" has an unsupported extension — use one of: jpg, jpeg, png, webp, avif, gif.`,
      );
    } else if (isExcludedFileName(baseName)) {
      errors.push(`Profile image "${image}" is a hidden or system file.`);
    } else if (image.includes("..") || image.startsWith("/")) {
      errors.push(`Profile image path "${image}" must be repository-relative without traversal.`);
    }
  }

  if (errors.length > 0) return { errors };
  return {
    profile: {
      name: record["name"] as string,
      headline: record["headline"] as string,
      intro: record["intro"] as string,
      image: image as string,
      imageAlt: record["imageAlt"] as string,
    },
    errors: [],
  };
}

/**
 * Check that the profile image resolves to a real file inside the
 * repository. `exists` reports whether a path exists on disk.
 */
export function validateProfileImageResolves(
  profile: Profile,
  exists: (path: string) => boolean,
  repoRoot: string,
): string[] {
  const resolved = `${repoRoot}/${profile.image}`;
  return exists(resolved)
    ? []
    : [`Profile image "${profile.image}" does not exist in the repository (expected at ${resolved}).`];
}
