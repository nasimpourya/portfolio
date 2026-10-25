import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract tests for src/index.template.html (TASK-011): the template must
 * be structurally sound, contain every application region, carry no
 * hardcoded project data, and make no assumption about deployment at "/".
 */
const template = readFileSync(
  join(import.meta.dirname, "..", "..", "src", "index.template.html"),
  "utf8",
);

describe("index.template.html", () => {
  it("is a complete HTML document", () => {
    expect(template).toMatch(/^<!doctype html>/i);
    expect(template).toContain('<html lang="en">');
    expect(template).toContain('<meta charset="utf-8"');
    expect(template).toContain('name="viewport"');
    expect(template).toContain("<title>");
    // Rough tag balance for the structural elements the shell uses.
    for (const tag of ["html", "head", "body", "header", "main", "nav", "section", "dialog", "script"]) {
      const open = template.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? [];
      const close = template.match(new RegExp(`</${tag}>`, "g")) ?? [];
      expect(open.length, tag).toBe(close.length);
    }
  });

  it("contains all required application regions", () => {
    for (const id of [
      "intro",
      "intro-photo",
      "intro-name",
      "intro-headline",
      "intro-intro",
      "main-content",
      "project-detail",
      "project-date",
      "close-project",
      "mosaic",
      "empty-state",
      "timeline-region",
      "timeline",
      "image-viewer",
      "image-viewer-img",
      "app-data",
    ]) {
      expect(template.includes(`id="${id}"`), `missing #${id}`).toBe(true);
    }
  });

  it("carries no text viewer (removed in TASK-041; text renders on cards)", () => {
    expect(template).not.toContain('id="text-viewer"');
  });

  it("keeps the app data in a non-executable JSON script element", () => {
    expect(template).toContain('<script id="app-data" type="application/json">');
    expect(template).toContain("{{APP_DATA_JSON}}");
    expect(template).not.toContain("{{MANIFEST_JSON}}");
  });

  it("does not assume deployment at / (base-path token present)", () => {
    expect(template).toContain('<base href="{{BASE_PATH}}/"');
  });

  it("contains no hardcoded project data", () => {
    expect(template).not.toMatch(/projects\/\d{4}-\d{2}-\d{2}/);
    expect(template).not.toMatch(/\.(webp|jpe?g|png|gif|avif)"?\s*alt/i);
  });

  it("leaves image alt text to the application (decorative until filled)", () => {
    expect(template).toContain('<img id="intro-photo" alt="" />');
  });
});
