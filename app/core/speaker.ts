/**
 * One stream at a time. A plugin that plays long-running audio (a radio station, a live microphone) claims the
 * speaker when it starts; the previous owner's stop function runs first, so two streams never play over each other
 * and no plugin needs to know which others make sound.
 */

let owner: { id: string; stop: () => void } | null = null;

export function claimSpeaker(id: string, stop: () => void): void {
  if (owner && owner.id !== id) owner.stop();
  owner = { id, stop };
}

export function releaseSpeaker(id: string): void {
  if (owner?.id === id) owner = null;
}
