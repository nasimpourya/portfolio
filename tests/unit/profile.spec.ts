import { describe, expect, it } from "vitest";
import { validateProfile, validateProfileImageResolves } from "../../src/lib/profile";

const validProfile = {
  name: "Your Name",
  headline: "Engineer, builder, and curious human.",
  intro: "A short introduction.",
  image: "assets/profile.webp",
  imageAlt: "Portrait of Your Name",
};

describe("validateProfile", () => {
  it("accepts a valid profile", () => {
    const { profile, errors } = validateProfile(validProfile);
    expect(errors).toEqual([]);
    expect(profile?.name).toBe("Your Name");
    expect(profile?.image).toBe("assets/profile.webp");
  });

  it("rejects non-objects", () => {
    expect(validateProfile(null).errors).toEqual(["Profile must be a JSON object."]);
    expect(validateProfile([1]).errors).toEqual(["Profile must be a JSON object."]);
    expect(validateProfile("nope").errors).toEqual(["Profile must be a JSON object."]);
  });

  it("requires every field to be a nonempty string", () => {
    for (const field of Object.keys(validProfile)) {
      const missing = { ...validProfile, [field]: undefined };
      expect(validateProfile(missing).errors.join(" ")).toContain(`"${field}"`);

      const empty = { ...validProfile, [field]: "   " };
      expect(validateProfile(empty).errors.join(" ")).toContain(`"${field}"`);
    }
  });

  it("rejects unsupported image extensions", () => {
    const result = validateProfile({ ...validProfile, image: "assets/profile.svg" });
    expect(result.errors.join(" ")).toContain("unsupported extension");
  });

  it("rejects traversal and absolute image paths", () => {
    expect(
      validateProfile({ ...validProfile, image: "../secrets/profile.webp" }).errors.join(" "),
    ).toContain("traversal");
    expect(
      validateProfile({ ...validProfile, image: "/etc/passwd.webp" }).errors.join(" "),
    ).toContain("traversal");
  });

  it("rejects hidden profile images", () => {
    expect(
      validateProfile({ ...validProfile, image: "assets/.profile.webp" }).errors.join(" "),
    ).toContain("hidden");
  });
});

describe("validateProfileImageResolves", () => {
  const profile = validateProfile(validProfile).profile!;

  it("passes when the image exists", () => {
    expect(validateProfileImageResolves(profile, () => true, "/repo")).toEqual([]);
  });

  it("fails when the image is missing", () => {
    const errors = validateProfileImageResolves(profile, () => false, "/repo");
    expect(errors[0]).toContain("does not exist");
  });
});
