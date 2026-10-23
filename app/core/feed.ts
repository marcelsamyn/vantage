import { create } from "zustand";
import type { PluginId } from "../../plugins";
import type { Intent } from "./nav";
import type { Entity } from "./plugin";
import { sfx } from "./sound";

export type FeedLevel = "info" | "live" | "alert" | "good";

/** One line in the city feed — the ticker at the bottom of the screen. */
export interface FeedEvent {
  id: string;
  at: number;
  level: FeedLevel;
  /** Plugin that raised the event, or "core" for the kernel. */
  source: PluginId | "core";
  title: string;
  detail?: string;
  /** Screen to open when the event is clicked. */
  go?: Intent;
  /** Entity to profile when the event is clicked. */
  entity?: Entity;
}

export interface PushOptions {
  /** Events with the same key inside `dedupeMs` are dropped, so a plane in range doesn't spam the feed. */
  key?: string;
  dedupeMs?: number;
  /** Also show a toast. Use for things that need attention now. */
  toast?: boolean;
}

interface FeedStore {
  events: FeedEvent[];
  toasts: FeedEvent[];
  unread: number;
  push: (event: Omit<FeedEvent, "id" | "at">, options?: PushOptions) => void;
  dismissToast: (id: string) => void;
  markRead: () => void;
}

const seen = new Map<string, number>();
let counter = 0;

export const useFeed = create<FeedStore>((set, get) => ({
  events: [],
  toasts: [],
  unread: 0,
  push: (event, { key, dedupeMs = 10 * 60_000, toast = false } = {}) => {
    const now = Date.now();
    if (key) {
      const last = seen.get(key);
      if (last && now - last < dedupeMs) return;
      seen.set(key, now);
    }
    const full: FeedEvent = { ...event, id: `ev${++counter}`, at: now };
    set({ events: [full, ...get().events].slice(0, 300), unread: get().unread + 1 });
    if (toast) {
      notifyDesktop(full);
      set({ toasts: [full, ...get().toasts].slice(0, 4) });
      if (event.level === "alert") sfx.alert();
      else sfx.notify();
      setTimeout(() => get().dismissToast(full.id), 8000);
    }
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  markRead: () => set({ unread: 0 }),
}));

/** While VANTAGE is in the background, toasts also become desktop notifications (if the user allowed them). */
function notifyDesktop(event: FeedEvent): void {
  if (!document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const n = new Notification(event.title, { body: event.detail, tag: event.id, silent: event.level !== "alert" });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

/** Ask for permission to show desktop notifications. Resolves to the browser's answer. */
export async function enableDesktopNotifications(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  return Notification.requestPermission();
}

/** Push to the feed from anywhere, including non-React code. */
export const feed = (event: Omit<FeedEvent, "id" | "at">, options?: PushOptions): void => useFeed.getState().push(event, options);
