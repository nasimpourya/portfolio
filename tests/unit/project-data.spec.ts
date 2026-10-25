import { describe, expect, it } from "vitest";
import { parseAppData } from "../../src/services/project-data";

const validAppData = {
  manifest: {
    schemaVersion: 1,
    projects: [
      {
        id: "2026-12-03",
        date: "2026-12-03",
        description: "A project.",
        featuredImage: "projects/2026-12-03/0.webp",
        assets: [],
      },
    ],
  },
  profile: {
    name: "Your Name",
    headline: "Headline.",
    intro: "Intro.",
    image: "assets/profile.webp",
    imageAlt: "Portrait.",
  },
};

describe("parseAppData", () => {
  it("parses well-formed embedded data", () => {
    const parsed = parseAppData(JSON.stringify(validAppData));
    expect(parsed?.manifest.schemaVersion).toBe(1);
    expect(parsed?.profile.name).toBe("Your Name");
  });

  it("returns null on malformed JSON without throwing", () => {
    expect(parseAppData("not json")).toBeNull();
    expect(parseAppData("")).toBeNull();
  });

  it("returns null when required keys are missing", () => {
    expect(parseAppData(JSON.stringify({ manifest: validAppData.manifest }))).toBeNull();
    expect(parseAppData(JSON.stringify({ profile: validAppData.profile }))).toBeNull();
    expect(parseAppData(JSON.stringify(null))).toBeNull();
  });
});
