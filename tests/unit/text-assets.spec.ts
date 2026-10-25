import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadTextAsset,
  resetTextAssetCache,
} from "../../src/services/text-assets";

/**
 * Text asset cache specs (TASK-041): on-demand fetches memoized per
 * session — including failures (Section 6.7 semantics carried over
 * from the former TextViewer) — with sync-throwing fetches converted
 * to cached rejections (Section 8.3). The module-level cache persists
 * across tests, so every test resets it and uses unique paths.
 */

beforeEach(() => {
  resetTextAssetCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ok(text: string): Response {
  return { ok: true, status: 200, text: async () => text } as unknown as Response;
}

describe("loadTextAsset", () => {
  it("fetches the path and resolves with its text", async () => {
    const fetchMock = vi.fn(async () => ok("document body"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadTextAsset("projects/2100-01-01/a.txt")).resolves.toBe("document body");
    expect(fetchMock).toHaveBeenCalledWith("projects/2100-01-01/a.txt");
  });

  it("memoizes: a second load reuses the first fetch", async () => {
    const fetchMock = vi.fn(async () => ok("cached"));
    vi.stubGlobal("fetch", fetchMock);
    const first = loadTextAsset("projects/2100-01-02/a.txt");
    const second = loadTextAsset("projects/2100-01-02/a.txt");
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(loadTextAsset("projects/2100-01-02/a.txt")).resolves.toBe("cached");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects on non-2xx responses with the HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response),
    );
    await expect(loadTextAsset("projects/2100-01-03/missing.txt")).rejects.toThrow(
      "HTTP 404",
    );
  });

  it("caches failures: a failed path rejects again without refetching", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadTextAsset("projects/2100-01-04/broken.txt")).rejects.toThrow(
      "network down",
    );
    await expect(loadTextAsset("projects/2100-01-04/broken.txt")).rejects.toThrow(
      "network down",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("converts a synchronously-throwing fetch into a rejection, not an uncaught error", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch is not defined here");
    });
    // Two awaited loads prove the rejection itself is cached.
    await expect(loadTextAsset("projects/2100-01-05/sync.txt")).rejects.toThrow(
      "fetch is not defined here",
    );
    await expect(loadTextAsset("projects/2100-01-05/sync.txt")).rejects.toThrow(
      "fetch is not defined here",
    );
  });

  it("resetTextAssetCache forces the next load to refetch", async () => {
    const fetchMock = vi.fn(async () => ok("fresh"));
    vi.stubGlobal("fetch", fetchMock);
    await loadTextAsset("projects/2100-01-06/re.txt");
    resetTextAssetCache();
    await loadTextAsset("projects/2100-01-06/re.txt");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
