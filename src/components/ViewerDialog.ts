import type { ViewStateManager } from "../services/view-state.ts";

/**
 * Shared viewer-dialog coordination (TASK-031, Sections 6.6–6.7).
 *
 * The modal viewer wires dismissal so the dialog's own `close` event is
 * the single source of truth — Escape and programmatic closes land
 * there — and the close button and backdrop click route through the
 * state model, whose subscription closes the dialog. State and DOM can
 * therefore never disagree, and there is exactly one code path for
 * every dismissal (the image and text viewers were wired separately in
 * TASK-029/030; this unified them; TASK-041 removed the text viewer).
 */

/**
 * Wire `dialog`'s dismissals to the state model. `mode` is the viewer
 * state the dialog represents ("image"; the "text" mode was removed in
 * TASK-041); a `close` event that arrives after the state already
 * moved on (e.g. closeProject from a viewer) is a no-op, never a
 * conflicting transition.
 */
export function bindViewerDismissal(
  dialog: HTMLDialogElement,
  state: ViewStateManager,
  mode: "image",
): void {
  // DOM → state: any dismissal (Escape via cancel, the close button,
  // backdrop click) lands in the close event.
  dialog.addEventListener("close", () => {
    if (state.get().mode === mode) state.closeOverlay();
  });

  // Clicking the backdrop (the dialog element itself, via ::backdrop)
  // closes; clicks inside the dialog never do (Sections 6.6–6.7).
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) state.closeOverlay();
  });

  dialog
    .querySelector(".viewer__close")
    ?.addEventListener("click", () => state.closeOverlay());

  trapDialogFocus(dialog);
}

/**
 * Close `dialog` if it is open; its close event then syncs the state
 * model (see above). Safe to call repeatedly and from any transition.
 */
export function dismissViewer(dialog: HTMLDialogElement): void {
  if (dialog.open) dialog.close();
}

/**
 * Wrap Tab at the dialog's focus boundaries (Section 7: no keyboard
 * traps, dialog focus managed correctly). Chromium's native modal wrap
 * can drop one Tab stop on <body> before re-entering the dialog; an
 * explicit wrap keeps the cycle inside the dialog at both edges.
 * Disabled controls (e.g. single-image prev/next) are skipped.
 */
export function trapDialogFocus(dialog: HTMLDialogElement): void {
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusables = [
      ...dialog.querySelectorAll<HTMLElement>("button:not(:disabled)"),
    ];
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = dialog.ownerDocument.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });
}
