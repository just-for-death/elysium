/**
 * useNotificationPlaybackControl
 *
 * Listens for postMessage events from the service worker triggered when the
 * user taps media-control buttons (⏮ / ⏸ / ⏭) on a "now playing" push
 * notification. Lets Android Chrome and Firefox for Android notification
 * actions control playback even while the app is backgrounded.
 *
 * Uses stable refs so the callbacks never go stale even though the event
 * listener is registered once at mount.
 */

import { useEffect, useRef } from "react";

interface Options {
  onPrev:   () => void;
  onToggle: () => void;
  onNext:   () => void;
}

export function useNotificationPlaybackControl({ onPrev, onToggle, onNext }: Options) {
  // Keep latest callbacks in refs so the handler never holds stale closures
  const onPrevRef   = useRef(onPrev);
  const onToggleRef = useRef(onToggle);
  const onNextRef   = useRef(onNext);

  useEffect(() => { onPrevRef.current   = onPrev;   }, [onPrev]);
  useEffect(() => { onToggleRef.current = onToggle; }, [onToggle]);
  useEffect(() => { onNextRef.current   = onNext;   }, [onNext]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "NOTIFICATION_ACTION") return;
      switch (event.data.action) {
        case "prev":   onPrevRef.current();   break;
        case "toggle": onToggleRef.current(); break;
        case "next":   onNextRef.current();   break;
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []); // register once — callbacks are read through refs
}
