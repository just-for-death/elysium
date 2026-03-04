/**
 * useMediaSession
 *
 * Wires the Web Media Session API so that:
 *  - Lock-screen / notification controls (play, pause, prev, next, seek)
 *    work on iOS Safari PWA, Android Chrome PWA, and Firefox for Android.
 *  - The OS "Now Playing" widget shows artwork, title, and artist.
 *  - Seeking from the lock screen or CarPlay / Android Auto updates the player.
 *
 * iOS notes:
 *  - Safari on iOS 15+ supports mediaSession. The audio element MUST be
 *    unmuted and playing before iOS grants media focus (handled in PlayerAudio
 *    via the AudioContext unlock trick).
 *  - setPositionState enables the lock-screen progress scrubber.
 *
 * Android notes:
 *  - Chrome for Android and Firefox for Android both honour the full API
 *    including action handlers and artwork.
 *
 * Fixes vs previous version:
 *  - Removed unused `useCallback` import.
 *  - seekforward / seekbackward now read currentTime through a ref to avoid
 *    a stale-closure bug (the handlers are registered once but currentTime
 *    changes every 250 ms).
 */

import { useEffect, useRef } from "react";

interface UseMediaSessionOptions {
  title: string | null;
  artist: string | null;
  album?: string | null;
  artworkUrl: string | null;
  duration: number | null;     // seconds
  currentTime: number | null;  // seconds
  paused: boolean;
  onPlay: () => void;
  onPause: () => void;
  onPreviousTrack: () => void;
  onNextTrack: () => void;
  onSeek: (time: number) => void;
}

export function useMediaSession({
  title,
  artist,
  album,
  artworkUrl,
  duration,
  currentTime,
  paused,
  onPlay,
  onPause,
  onPreviousTrack,
  onNextTrack,
  onSeek,
}: UseMediaSessionOptions) {
  const supported =
    typeof navigator !== "undefined" && "mediaSession" in navigator;

  // ── Stable refs so handlers never capture stale closures ─────────────
  const onPlayRef     = useRef(onPlay);
  const onPauseRef    = useRef(onPause);
  const onPrevRef     = useRef(onPreviousTrack);
  const onNextRef     = useRef(onNextTrack);
  const onSeekRef     = useRef(onSeek);
  const currentTimeRef = useRef(currentTime);

  useEffect(() => { onPlayRef.current      = onPlay;          }, [onPlay]);
  useEffect(() => { onPauseRef.current     = onPause;         }, [onPause]);
  useEffect(() => { onPrevRef.current      = onPreviousTrack; }, [onPreviousTrack]);
  useEffect(() => { onNextRef.current      = onNextTrack;     }, [onNextTrack]);
  useEffect(() => { onSeekRef.current      = onSeek;          }, [onSeek]);
  useEffect(() => { currentTimeRef.current = currentTime;     }, [currentTime]);

  // ── Register action handlers once at mount ───────────────────────────
  useEffect(() => {
    if (!supported) return;
    const ms = navigator.mediaSession;

    const safeSet = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try { ms.setActionHandler(action, handler); } catch { /* unsupported action */ }
    };

    safeSet("play",          () => onPlayRef.current());
    safeSet("pause",         () => onPauseRef.current());
    safeSet("stop",          () => onPauseRef.current());
    safeSet("previoustrack", () => onPrevRef.current());
    safeSet("nexttrack",     () => onNextRef.current());

    // seekto: fired by lock-screen scrubber and CarPlay / Android Auto
    safeSet("seekto", (details) => {
      if (details.seekTime != null) onSeekRef.current(details.seekTime);
    });

    // seekforward / seekbackward read through ref to avoid stale closure
    safeSet("seekforward", (details) => {
      const offset = details.seekOffset ?? 15;
      onSeekRef.current((currentTimeRef.current ?? 0) + offset);
    });
    safeSet("seekbackward", (details) => {
      const offset = details.seekOffset ?? 15;
      onSeekRef.current(Math.max(0, (currentTimeRef.current ?? 0) - offset));
    });

    return () => {
      const actions: MediaSessionAction[] = [
        "play", "pause", "previoustrack", "nexttrack",
        "stop", "seekto", "seekforward", "seekbackward",
      ];
      actions.forEach((a) => safeSet(a, null));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  // ── Sync playback state ──────────────────────────────────────────────
  useEffect(() => {
    if (!supported) return;
    navigator.mediaSession.playbackState = paused ? "paused" : "playing";
  }, [supported, paused]);

  // ── Sync Now Playing metadata ────────────────────────────────────────
  useEffect(() => {
    if (!supported || !title) return;

    const artwork: MediaImage[] = artworkUrl
      ? [
          { src: artworkUrl, sizes: "96x96",   type: "image/jpeg" },
          { src: artworkUrl, sizes: "192x192", type: "image/jpeg" },
          { src: artworkUrl, sizes: "256x256", type: "image/jpeg" },
          { src: artworkUrl, sizes: "512x512", type: "image/jpeg" },
        ]
      : [];

    navigator.mediaSession.metadata = new MediaMetadata({
      title:   title  ?? "",
      artist:  artist ?? "",
      album:   album  ?? "",
      artwork,
    });
  }, [supported, title, artist, album, artworkUrl]);

  // ── Sync position state (lock-screen scrubber) ───────────────────────
  useEffect(() => {
    if (!supported) return;
    if (duration == null || currentTime == null) return;
    if (!isFinite(duration) || duration <= 0) return;
    if (!isFinite(currentTime) || currentTime < 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(currentTime, duration),
      });
    } catch {
      // setPositionState can throw on older iOS builds — ignore
    }
  }, [supported, duration, currentTime]);
}
