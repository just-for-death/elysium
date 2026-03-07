/**
 * useNativeFullscreen
 *
 * Manages native OS fullscreen via the Fullscreen API with cross-browser
 * prefixes. Falls back gracefully when the API is unavailable (Firefox iOS,
 * older Safari).
 *
 * On mobile browsers the Fullscreen API is often blocked or unavailable:
 *  - Firefox Android: supported on element, NOT on document.documentElement
 *  - Firefox iOS: NOT supported at all — CSS overlay is the only option
 *  - iOS Safari PWA: NOT supported — use CSS overlay
 *  - Android Chrome PWA: supported on document.documentElement
 *
 * Strategy:
 *  1. Try element.requestFullscreen() on the overlay element
 *  2. Fall back to webkit/moz prefixed versions
 *  3. If all fail, just use the CSS overlay (already full-viewport)
 */

import { useCallback, useEffect, useRef, useState } from "react";

type AnyElement = Element & {
  webkitRequestFullscreen?: () => Promise<void>;
  mozRequestFullScreen?: () => Promise<void>;
};

type AnyDocument = Document & {
  webkitExitFullscreen?: () => Promise<void>;
  mozCancelFullScreen?: () => Promise<void>;
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
};

const requestFull = (el: AnyElement): Promise<void> => {
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
  return Promise.reject(new Error("Fullscreen API not supported"));
};

const exitFull = (): Promise<void> => {
  const doc = document as AnyDocument;
  if (doc.exitFullscreen) return doc.exitFullscreen();
  if (doc.webkitExitFullscreen) return doc.webkitExitFullscreen();
  if (doc.mozCancelFullScreen) return doc.mozCancelFullScreen();
  return Promise.reject(new Error("Fullscreen API not supported"));
};

const isFullscreen = (): boolean => {
  const doc = document as AnyDocument;
  return !!(
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement
  );
};

export function useNativeFullscreen() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [nativeFsActive, setNativeFsActive] = useState(false);

  // Listen for external fullscreen changes (user pressing Escape, etc.)
  useEffect(() => {
    const onChange = () => setNativeFsActive(isFullscreen());
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    document.addEventListener("mozfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      document.removeEventListener("mozfullscreenchange", onChange);
    };
  }, []);

  const enterFullscreen = useCallback(async () => {
    const el = overlayRef.current;
    if (!el) return;
    try {
      await requestFull(el);
      setNativeFsActive(true);
    } catch {
      // API unavailable (Firefox iOS, Safari PWA) — CSS overlay handles it
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    if (!isFullscreen()) return;
    try {
      await exitFull();
      setNativeFsActive(false);
    } catch {
      // ignore
    }
  }, []);

  return { overlayRef, nativeFsActive, enterFullscreen, exitFullscreen };
}
