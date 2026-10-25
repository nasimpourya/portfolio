/**
 * Text asset loading (TASK-041, Sections 6.5 and 8.4): gallery cards
 * fetch their text content from the deployed static assets on demand —
 * never eagerly in bulk. Fetches are memoized per session, including
 * failures (a settled rejection is cached like a settled result), so
 * re-rendering a project never refetches what the session already
 * holds (the closure cache of the former TextViewer, TASK-030/6.7,
 * moved here when the viewer was replaced by on-card content).
 */

/** Session cache: path → fetched text (settled promise, so failures are cached too). */
const cache = new Map<string, Promise<string>>();

export function loadTextAsset(path: string): Promise<string> {
  let entry = cache.get(path);
  if (entry === undefined) {
    // Promise.resolve().then(...) defers the fetch call to a microtask,
    // so a synchronously-throwing (or missing) fetch becomes a cached
    // rejection instead of an uncaught error (Section 8.3).
    entry = Promise.resolve()
      .then(() => fetch(path))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.text();
      });
    cache.set(path, entry);
  }
  return entry;
}

/** Test seam: the module-level cache would otherwise leak across tests. */
export function resetTextAssetCache(): void {
  cache.clear();
}
