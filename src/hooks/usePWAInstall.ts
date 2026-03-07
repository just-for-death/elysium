/**
 * usePWAInstall
 *
 * Captures the browser's `beforeinstallprompt` event so we can show a
 * polished in-app install banner instead of the bare browser chrome.
 *
 * Works on:
 *  - Android Chrome / Edge (full support)
 *  - Desktop Chrome / Edge (full support)
 *  - Firefox for Android (partial — shows if criteria met)
 *  - iOS Safari — no beforeinstallprompt, but we detect standalone and show
 *    manual instructions ("Add to Home Screen" guidance).
 *
 * Returns:
 *  - canInstall:    true when the browser deferred the install prompt
 *  - isInstalled:  true when running in standalone mode (already installed)
 *  - isIOS:        true on iOS — requires manual instructions
 *  - install():    call this to trigger the browser's install dialog
 *  - dismiss():    user dismissed the banner — suppress for 30 days
 */

import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = "elysium-pwa-install-dismissed";
const DISMISS_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    return Date.now() - ts < DISMISS_TTL;
  } catch {
    return false;
  }
}

function setDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {}
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissed, setDismissedState] = useState(false);

  const isIOS =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(navigator as any).standalone;

  useEffect(() => {
    // Already installed in standalone mode?
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;
    if (standalone) {
      setIsInstalled(true);
      return;
    }

    if (isDismissed()) {
      setDismissedState(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setCanInstall(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Also listen for successful install
    window.addEventListener("appinstalled", () => {
      setIsInstalled(true);
      setCanInstall(false);
      setDeferredPrompt(null);
    });

    // iOS: show manual instructions banner if not installed and not dismissed
    if (isIOS && !isDismissed()) {
      setCanInstall(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setCanInstall(false);
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    setDismissedState(true);
    setCanInstall(false);
    setDeferredPrompt(null);
    setDismissed();
  }, []);

  return {
    canInstall: canInstall && !dismissed && !isInstalled,
    isInstalled,
    isIOS,
    install,
    dismiss,
  };
}
