import { Box } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import { memo, useCallback, useEffect, useRef } from "react";
import ReactAudioPlayer from "react-audio-player";
import { useTranslation } from "react-i18next";

import { log } from "../utils/logger";
import { useListenBrainzScrobble } from "../hooks/useListenBrainzScrobble";
import { useMediaSession } from "../hooks/useMediaSession";
import { useWakeLock } from "../hooks/useWakeLock";
import { useNotificationPlaybackControl } from "../hooks/useNotificationPlaybackControl";
import { usePlayVideo } from "../hooks/usePlayVideo";
import {
  usePlayerAudio,
  usePlayerFallbackUrls,
  usePlayerState,
  usePlayerUrl,
  usePlayerVideo,
  useSetPlayerFallbackUrls,
  useSetPlayerState,
  useSetPlayerUrl,
} from "../providers/Player";
import { usePlayerMode, useSetPlayerMode } from "../providers/PlayerMode";
import { usePreviousNextVideos } from "../providers/PreviousNextTrack";
import { displayTimeBySeconds } from "../utils/displayTimeBySeconds";

// ── iOS audio context unlock ─────────────────────────────────────────────────
// iOS Safari requires audio to be initiated from a direct user gesture.
// We play a silent AudioContext buffer on the first touch/click to "unlock"
// the audio stack, allowing programmatic play() calls to succeed while
// the device is locked or the app is backgrounded.
let iosAudioUnlocked = false;

function unlockIOSAudio() {
  if (iosAudioUnlocked) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    ctx.resume().then(() => { iosAudioUnlocked = true; }).catch(() => {});
  } catch {
    // Ignore — browser may not support AudioContext
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("touchstart", unlockIOSAudio, { once: true, passive: true });
  document.addEventListener("touchend",   unlockIOSAudio, { once: true, passive: true });
  document.addEventListener("click",      unlockIOSAudio, { once: true });
}

// ── Component ────────────────────────────────────────────────────────────────
export const PlayerAudio = memo(() => {
  const playerAudio       = usePlayerAudio();
  const playerUrl         = usePlayerUrl();
  const fallbackUrls      = usePlayerFallbackUrls();
  const setPlayerUrl      = useSetPlayerUrl();
  const setPlayerFallbackUrls = useSetPlayerFallbackUrls();
  const setPlayerState    = useSetPlayerState();
  const { handlePlay: play } = usePlayVideo();
  const { videosIds }     = usePreviousNextVideos();
  const playerMode        = usePlayerMode();
  const playerState       = usePlayerState();
  const playerVideo       = usePlayerVideo();
  const setPlayerMode     = useSetPlayerMode();
  const { t }             = useTranslation();

  // ListenBrainz scrobbling
  useListenBrainzScrobble();

  // ── Helper: get the underlying HTMLAudioElement ──────────────────────
  // Defined early so hooks below can safely reference it via a ref.
  const getAudioElRef = useRef<() => HTMLAudioElement | null>(() => null);

  const getAudioEl = useCallback((): HTMLAudioElement | null => {
    const ref = playerAudio?.current as unknown as {
      audioEl?: { current?: HTMLAudioElement };
    } | null;
    return ref?.audioEl?.current ?? null;
  }, [playerAudio]);

  // Keep the ref up-to-date so hooks registered once can call the latest version
  useEffect(() => { getAudioElRef.current = getAudioEl; }, [getAudioEl]);

  // ── Seek helper ──────────────────────────────────────────────────────
  const seekTo = useCallback((time: number) => {
    const audio = getAudioEl();
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(time, audio.duration || Infinity));
  }, [getAudioEl]);

  // ── Wake lock: prevent screen sleep while playing ───────────────────
  useWakeLock(!playerState.paused && !!playerUrl);

  // ── Media Session: lock-screen / Now Playing controls ───────────────
  useMediaSession({
    title:       playerVideo.video?.title    ?? null,
    artist:      playerVideo.video?.author   ?? null,
    album:       null,
    artworkUrl:  playerVideo.thumbnailUrl    ?? null,
    duration:    playerState.audioDuration   ?? null,
    currentTime: playerState.currentTime     ?? null,
    paused:      playerState.paused,
    onPlay:           () => getAudioElRef.current()?.play(),
    onPause:          () => getAudioElRef.current()?.pause(),
    onPreviousTrack:  () => { if (videosIds.previousVideoId) play(videosIds.previousVideoId); },
    onNextTrack:      () => { if (videosIds.nextVideoId)     play(videosIds.nextVideoId);     },
    onSeek:           seekTo,
  });

  // ── Notification action controls (push notification media buttons) ───
  // Uses refs internally so stale closures aren't an issue.
  useNotificationPlaybackControl({
    onPrev:   () => { if (videosIds.previousVideoId) play(videosIds.previousVideoId); },
    onToggle: () => {
      const audio = getAudioElRef.current();
      if (!audio) return;
      if (audio.paused) { audio.play().catch(() => {}); } else { audio.pause(); }
    },
    onNext:   () => { if (videosIds.nextVideoId) play(videosIds.nextVideoId); },
  });

  // ── Re-acquire audio focus when the app returns to foreground ────────
  // iOS and some Android browsers can pause audio while the app is in the
  // background. We attempt to resume on visibilitychange.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const audio = getAudioElRef.current();
      if (!audio || playerState.paused) return;
      if (audio.paused) {
        audio.play().catch(() => { /* user may have intentionally paused */ });
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [playerState.paused]);

  // ── playsInline: required for background audio on iOS PWA ───────────
  // ReactAudioPlayer doesn't expose a playsInline prop so we set it
  // directly on the DOM element after mount.
  useEffect(() => {
    const audio = getAudioEl();
    if (audio) {
      (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      audio.setAttribute("playsinline", "");
      audio.setAttribute("webkit-playsinline", "");
    }
  }, [getAudioEl, playerUrl]); // re-run when the src changes (new audio el may be created)

  // ── Keyboard shortcut ────────────────────────────────────────────────
  const handlePressSpace = () => {
    const audio = getAudioEl();
    if (!audio) return;
    if (playerState.paused) { audio.play().catch(() => {}); } else { audio.pause(); }
  };
  useHotkeys([["space", handlePressSpace]]);

  // ── Audio event handlers ─────────────────────────────────────────────
  const handlePause = () => setPlayerState((prev) => ({ ...prev, paused: true  }));
  const handlePlay  = () => setPlayerState((prev) => ({ ...prev, paused: false }));

  const handleEnd = () => {
    const audio = getAudioEl();
    if (!audio?.loop && videosIds.nextVideoId) play(videosIds.nextVideoId);
  };

  const handleListen = (currentTime: number) => {
    const audio    = getAudioEl();
    const duration = audio?.duration;
    if (duration == null || !isFinite(duration) || duration <= 0) return;
    setPlayerState((prev) => ({
      ...prev,
      audioDuration:       Math.round(duration),
      duration:            displayTimeBySeconds(duration),
      currentTime,
      formatedCurrentTime: displayTimeBySeconds(currentTime, duration),
      percentage:          (100 * currentTime) / duration,
    }));
  };

  const handleVolumeChanged = (event: Event) => {
    setPlayerState((prev) => ({
      ...prev,
      volume: (event.target as HTMLAudioElement).volume,
    }));
  };

  const handleCanPlay = () => setPlayerState((prev) => ({ ...prev, loading: false }));

  const handleError = () => {
    if (fallbackUrls.length > 0) {
      const [nextUrl, ...rest] = fallbackUrls;
      log.debug("Audio playback failed, trying fallback format", { remaining: rest.length });
      setPlayerUrl(nextUrl);
      setPlayerFallbackUrls(rest);
      setPlayerState((prev) => ({ ...prev, loading: true }));
      return;
    }
    setPlayerState((prev) => ({ ...prev, loading: false }));
    setPlayerMode("video");
    showNotification({
      title:     t("error"),
      message:   t("player.mode.audio.error.message"),
      autoClose: 8000,
    });
  };

  return (
    <Box style={{ display: "none" }} aria-hidden="true">
      <ReactAudioPlayer
        ref={playerAudio}
        src={playerUrl ?? undefined}
        autoPlay={playerMode === "audio"}
        // preload="auto" buffers immediately so playback can resume after
        // the screen locks on iOS/Android without re-fetching the stream
        preload="auto"
        controls
        // 250 ms is frequent enough for a smooth scrubber without flooding
        // React with re-renders every 100 ms
        listenInterval={250}
        onError={handleError}
        onPause={handlePause}
        onPlay={handlePlay}
        onCanPlay={handleCanPlay}
        onEnded={handleEnd}
        onListen={handleListen}
        onVolumeChanged={handleVolumeChanged}
        volume={playerState.volume}
      />
    </Box>
  );
});
