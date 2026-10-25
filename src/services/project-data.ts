import type { ProjectManifest } from "../data/types.ts";
import type { Profile } from "../lib/profile.ts";

/**
 * Read the application data embedded by the build into #app-data
 * (a non-executable JSON script element).
 */

export type AppData = {
  manifest: ProjectManifest;
  profile: Profile;
};

/** Parse embedded app data; returns null on anything malformed. */
export function parseAppData(text: string): AppData | null {
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value === "object" &&
      value !== null &&
      "manifest" in value &&
      "profile" in value
    ) {
      return value as AppData;
    }
    return null;
  } catch {
    return null;
  }
}

/** Load app data from the current document, or null when unavailable. */
export function loadAppData(doc: Document = document): AppData | null {
  const element = doc.getElementById("app-data");
  if (element === null) return null;
  return parseAppData(element.textContent ?? "");
}
