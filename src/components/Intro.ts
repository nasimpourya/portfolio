import type { Profile } from "../lib/profile.ts";

/**
 * Introduction component (TASK-017): renders the profile into the
 * #intro region. All profile text is untrusted — textContent only,
 * never innerHTML.
 */

export function renderIntro(doc: Document, profile: Profile): void {
  const photo = doc.querySelector<HTMLImageElement>("#intro-photo");
  if (photo !== null) {
    photo.src = profile.image;
    photo.alt = profile.imageAlt;
  }

  const name = doc.querySelector("#intro-name");
  if (name !== null) name.textContent = profile.name;

  const headline = doc.querySelector("#intro-headline");
  if (headline !== null) headline.textContent = profile.headline;

  const intro = doc.querySelector("#intro-intro");
  if (intro !== null) intro.textContent = profile.intro;
}

/**
 * Transition-ready visibility control: the state model (TASK-025) will
 * animate this region out when a project opens. CSS in intro.css owns
 * the actual transition.
 */
export function setIntroHidden(doc: Document, hidden: boolean): void {
  const intro = doc.querySelector("#intro");
  if (intro !== null) {
    intro.setAttribute("data-hidden", hidden ? "true" : "false");
  }
}
