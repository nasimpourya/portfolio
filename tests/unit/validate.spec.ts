import { describe, expect, it } from "vitest";
import {
  findFeaturedImageCandidates,
  getExtension,
  isExcludedFileName,
  isRealCalendarDate,
  isSupportedImageFile,
  isSupportedTextFile,
  isValidProjectDirName,
} from "../../src/lib/validate";

describe("isValidProjectDirName", () => {
  it("accepts valid YYYY-MM-DD dates", () => {
    expect(isValidProjectDirName("2026-12-03")).toBe(true);
    expect(isValidProjectDirName("2024-01-01")).toBe(true);
    expect(isValidProjectDirName("2024-02-29")).toBe(true); // leap year
  });

  it("rejects malformed formats", () => {
    expect(isValidProjectDirName("2026-12-3")).toBe(false);
    expect(isValidProjectDirName("20261203")).toBe(false);
    expect(isValidProjectDirName("2026/12/03")).toBe(false);
    expect(isValidProjectDirName("portfolio")).toBe(false);
    expect(isValidProjectDirName("")).toBe(false);
  });

  it("rejects impossible calendar dates", () => {
    expect(isValidProjectDirName("2026-13-01")).toBe(false); // month 13
    expect(isValidProjectDirName("2026-00-10")).toBe(false); // month 0
    expect(isValidProjectDirName("2026-02-30")).toBe(false); // Feb 30
    expect(isValidProjectDirName("2025-02-29")).toBe(false); // non-leap year
    expect(isValidProjectDirName("2026-04-31")).toBe(false); // April 31
  });
});

describe("isRealCalendarDate", () => {
  it("rejects non-integer or out-of-range parts", () => {
    expect(isRealCalendarDate(2026, 2, 29.5)).toBe(false);
    expect(isRealCalendarDate(NaN, 2, 1)).toBe(false);
    expect(isRealCalendarDate(2026, 12, 0)).toBe(false);
    expect(isRealCalendarDate(2026, 12, 32)).toBe(false);
  });
});

describe("file classification", () => {
  it("detects supported image extensions case-insensitively", () => {
    expect(isSupportedImageFile("0.webp")).toBe(true);
    expect(isSupportedImageFile("photo.JPG")).toBe(true);
    expect(isSupportedImageFile("diagram.png")).toBe(true);
    expect(isSupportedImageFile("photo.JPEG")).toBe(true);
    expect(isSupportedImageFile("animation.gif")).toBe(true);
    expect(isSupportedImageFile("modern.avif")).toBe(true);
  });

  it("rejects unsupported or extensionless image names", () => {
    expect(isSupportedImageFile("vector.svg")).toBe(false);
    expect(isSupportedImageFile("archive.zip")).toBe(false);
    expect(isSupportedImageFile("0")).toBe(false);
    expect(isSupportedImageFile("0.webp.bak")).toBe(false);
  });

  it("detects supported text extensions", () => {
    expect(isSupportedTextFile("0.txt")).toBe(true);
    expect(isSupportedTextFile("notes.md")).toBe(true);
    expect(isSupportedTextFile("essay.markdown")).toBe(true);
    expect(isSupportedTextFile("README.txtx")).toBe(false);
  });

  it("returns the lowercased extension or null", () => {
    expect(getExtension("a.Jpg")).toBe("jpg");
    expect(getExtension(".gitignore")).toBeNull();
    expect(getExtension("noext")).toBeNull();
    expect(getExtension("trailing.")).toBeNull();
  });
});

describe("isExcludedFileName", () => {
  it("excludes hidden and generated system files", () => {
    expect(isExcludedFileName(".DS_Store")).toBe(true);
    expect(isExcludedFileName("Thumbs.db")).toBe(true);
    expect(isExcludedFileName("desktop.ini")).toBe(true);
    expect(isExcludedFileName(".hidden.png")).toBe(true);
  });

  it("keeps ordinary files", () => {
    expect(isExcludedFileName("0.txt")).toBe(false);
    expect(isExcludedFileName("notes.md")).toBe(false);
  });
});

describe("findFeaturedImageCandidates", () => {
  it("finds images whose basename is exactly 0", () => {
    expect(findFeaturedImageCandidates(["0.webp", "0.txt", "01.jpg"])).toEqual([
      "0.webp",
    ]);
    expect(findFeaturedImageCandidates(["0.png"])).toEqual(["0.png"]);
  });

  it("returns empty when no featured image exists", () => {
    expect(findFeaturedImageCandidates(["0.txt", "01.jpg"])).toEqual([]);
  });

  it("returns multiple candidates so callers can flag ambiguity", () => {
    expect(findFeaturedImageCandidates(["0.jpg", "0.png", "0.txt"]).sort()).toEqual([
      "0.jpg",
      "0.png",
    ]);
  });

  it("ignores hidden and unsupported files", () => {
    expect(findFeaturedImageCandidates([".0.webp", "0.svg", "0.gif"])).toEqual([
      "0.gif",
    ]);
  });
});
