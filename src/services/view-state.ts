/**
 * Application state model (TASK-023, Section 6.10).
 *
 * A single, explicit view state — never competing booleans. The image
 * viewer state implies that its project is active, keeping one flat
 * state with no overlapping modes. The model is pure (no DOM, no
 * fetches): UI components subscribe and drive transitions and focus
 * from the (next, previous) diff.
 *
 * Transition rules (deterministic; every call either replaces the state
 * or is a no-op):
 * - `openProject(id)` — valid from any mode for a known project id;
 *                         selecting another marker switches projects
 *                         directly (Section 6.4), replacing whatever
 *                         viewer or detail was open, so no stale UI.
 * - `openImage`         — only while that same project is active; a
 *                         viewer for a non-active project would be
 *                         inconsistent with the detail state.
 * - `closeOverlay()`    — image → its project's detail state; a no-op
 *                         in project/overview modes (the detail close
 *                         button is `closeProject`).
 * - `closeProject()`    — from any mode → overview.
 *
 * (TASK-041 removed the `text` mode: text content renders on the
 * gallery cards, so there is no text viewer to model.)
 */

/** The single application view state (Section 6.10). */
export type ViewState =
  | { mode: "overview" }
  | { mode: "project"; projectId: string }
  | { mode: "image"; projectId: string; assetIndex: number };

export type ViewStateListener = (next: ViewState, previous: ViewState) => void;

export type ViewStateManager = {
  get: () => ViewState;
  /** Subscribe to transitions; returns an unsubscribe function (8.3). */
  subscribe: (listener: ViewStateListener) => () => void;
  /** Opens a known project from any mode; false (no change) if unknown. */
  openProject: (projectId: string) => boolean;
  /** Any mode → overview; false when already in overview. */
  closeProject: () => boolean;
  /** Opens the active project's image viewer; false when not possible. */
  openImage: (projectId: string, assetIndex: number) => boolean;
  /** image → its project's detail state; false otherwise. */
  closeOverlay: () => boolean;
};

/** Structural equality — equal states never re-notify subscribers. */
function statesEqual(a: ViewState, b: ViewState): boolean {
  if (a.mode !== b.mode) return false;
  switch (a.mode) {
    case "overview":
      return true;
    case "project":
      return a.projectId === (b as typeof a).projectId;
    case "image":
      return (
        a.projectId === (b as typeof a).projectId &&
        a.assetIndex === (b as typeof a).assetIndex
      );
  }
}

/**
 * Create the state manager. `knownProjectIds` guards every transition
 * against unknown or malformed project ids (invalid ids are a no-op,
 * never an error or a broken state).
 */
export function createViewStateManager(
  knownProjectIds: readonly string[],
): ViewStateManager {
  const known = new Set(knownProjectIds);
  let current: ViewState = { mode: "overview" };
  const listeners = new Set<ViewStateListener>();

  function transition(next: ViewState): boolean {
    if (statesEqual(current, next)) return false;
    const previous = current;
    current = next;
    for (const listener of [...listeners]) listener(current, previous);
    return true;
  }

  /** The active project id while a project (or its viewer) is open. */
  function activeProjectId(): string | null {
    switch (current.mode) {
      case "project":
      case "image":
        return current.projectId;
      case "overview":
        return null;
    }
  }

  return {
    get: () => current,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    openProject(projectId) {
      if (!known.has(projectId)) return false;
      return transition({ mode: "project", projectId });
    },

    closeProject() {
      if (current.mode === "overview") return false;
      return transition({ mode: "overview" });
    },

    openImage(projectId, assetIndex) {
      // Only the active project's gallery can open a viewer, and only
      // with a real index.
      if (activeProjectId() !== projectId) return false;
      if (!Number.isInteger(assetIndex) || assetIndex < 0) return false;
      return transition({ mode: "image", projectId, assetIndex });
    },

    closeOverlay() {
      if (current.mode === "image") {
        return transition({ mode: "project", projectId: current.projectId });
      }
      return false;
    },
  };
}
