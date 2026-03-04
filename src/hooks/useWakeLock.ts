/**
 * useWakeLock
 *
 * Acquires a Screen Wake Lock while music is playing so the device does NOT
 * dim/sleep and interrupt audio playback.
 *
 * - Supported in Chrome 84+, Edge 84+, Samsung Internet, and Android WebView.
 * - Safari and Firefox do not yet support the Wake Lock API; we no-op safely.
 * - The lock is automatically released when the tab hides (spec requirement)
 *   and re-acquired when the tab becomes visible again.
 * - Released when the player is paused so the OS can idle normally.
 *
 * TypeScript note: WakeLockSentinel is part of the `dom` lib but only in
 * newer TypeScript versions. We use an inline type to avoid relying on it.
 */

import { useEffect, useRef } from "react";

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: string, listener: () => void) => void;
};

export function useWakeLock(active: boolean) {
  const lockRef = useRef<WakeLockSentinelLike | null>(null);

  const acquire = async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lockRef.current = await (navigator as any).wakeLock.request("screen");
      lockRef.current?.addEventListener("release", () => {
        lockRef.current = null;
      });
    } catch {
      // Permission denied or not supported — ignore
    }
  };

  const release = async () => {
    try { await lockRef.current?.release(); } catch { /* ignore */ }
    lockRef.current = null;
  };

  // Acquire / release based on active (playing) state
  useEffect(() => {
    if (active) { acquire(); } else { release(); }
    return () => { release(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Re-acquire when the tab becomes visible again (spec requirement)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && active && !lockRef.current) {
        acquire();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
