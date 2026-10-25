import {
  FEATURED_IMAGE_BASENAME,
  PROJECT_DATE_PATTERN,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_TEXT_EXTENSIONS,
} from "../data/types.ts";

/**
 * Build-time validation helpers for project folder names and file names.
 * Pure functions only — no filesystem access — so unit tests can cover
 * every edge case without fixtures.
 */

/**
 * True when `name` is a strict `YYYY-MM-DD` string that is also a real
 * calendar date (rejects `2026-02-30`, `2025-13-01`, and non-leap `02-29`).
 */
export function isValidProjectDirName(name: string): boolean {
  if (!PROJECT_DATE_PATTERN.test(name)) return false;

  const year = Number(name.slice(0, 4));
  const month = Number(name.slice(5, 7));
  const day = Number(name.slice(8, 10));

  return isRealCalendarDate(year, month, day);
}

/**
 * True when `year`, `month`, `day` form a real Gregorian calendar date.
 * Months are 1-based; all parts must be integers within range.
 */
export function isRealCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Lowercased extension of `fileName` without the dot, or `null`. */
export function getExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

/** True when `fileName` has a supported gallery image extension. */
export function isSupportedImageFile(fileName: string): boolean {
  const ext = getExtension(fileName);
  return ext !== null && (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

/** True when `fileName` has a supported gallery text extension. */
export function isSupportedTextFile(fileName: string): boolean {
  const ext = getExtension(fileName);
  return ext !== null && (SUPPORTED_TEXT_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * True when a directory entry must never reach the gallery: hidden files
 * (dot-prefixed) and generated system files such as `.DS_Store`.
 */
const EXCLUDED_FILE_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

export function isExcludedFileName(fileName: string): boolean {
  return fileName.startsWith(".") || EXCLUDED_FILE_NAMES.has(fileName);
}

/**
 * Supported images whose basename is exactly the featured-image basename.
 * Callers treat an empty list or more than one candidate as a validation
 * error (Section 4.2) — never an arbitrary pick.
 */
export function findFeaturedImageCandidates(fileNames: string[]): string[] {
  return fileNames.filter((fileName) => {
    if (isExcludedFileName(fileName) || !isSupportedImageFile(fileName)) {
      return false;
    }
    const dot = fileName.lastIndexOf(".");
    return fileName.slice(0, dot) === FEATURED_IMAGE_BASENAME;
  });
}
