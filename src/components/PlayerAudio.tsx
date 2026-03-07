import { Box } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import { memo, useCallback, useEffect, useRef } from "react";
import ReactAudioPlayer from "react-audio-player";
import { useTranslation } from "react-i18next";

import { log } from "../utils/logger";
import { isAndroidChrome, isAppleWebKit } from "../services/video";
import { useListenBrainzScrobble } from "../hooks/useListenBrainzScrobble";
import { useMediaSession } from "../hooks/useMediaSession";
import { useWakeLock } from "../hooks/useWakeLock";
import { useNotificationPlaybackControl } from "../hooks/useNotificationPlaybackControl";
import { usePlayVideo } from "../hooks/usePlayVideo";
import {
  usePlayerAudio,
  usePlayerFallbackUrls,
  usePlayerStatus,
  usePlayerUrl,
  usePlayerVideo,
  useSetPlayerFallbackUrls,
  useSetPlayerProgress,
  useSetPlayerStatus,
  useSetPlayerUrl,
} from "../providers/Player";
import { usePlayerMode, useSetPlayerMode } from "../providers/PlayerMode";
import { usePlayerPlaylist } from "../providers/PlayerPlaylist";
import { usePreviousNextVideos } from "../providers/PreviousNextTrack";
import { displayTimeBySeconds } from "../utils/displayTimeBySeconds";

// iOS audio context unlock
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
  } catch { /* ignore */ }
}
if (typeof document !== "undefined") {
  document.addEventListener("touchstart", unlockIOSAudio, { once: true, passive: true });
  document.addEventListener("touchend",   unlockIOSAudio, { once: true, passive: true });
  document.addEventListener("click",      unlockIOSAudio, { once: true });
}

export const PlayerAudio = memo(() => {
  const playerAudio           = usePlayerAudio();
  const playerUrl             = usePlayerUrl();
  const fallbackUrls          = usePlayerFallbackUrls();
  const setPlayerUrl          = useSetPlayerUrl();
  const setPlayerFallbackUrls = useSetPlayerFallbackUrls();
  const setPlayerStatus        = useSetPlayerStatus();
  const setPlayerProgress      = useSetPlayerProgress();
  const { handlePlay: play }  = usePlayVideo();
  const { videosIds }         = usePreviousNextVideos();
  const playerMode            = usePlayerMode();
  const playerState           = usePlayerStatus();
  const playerVideo           = usePlayerVideo();
  const setPlayerMode         = useSetPlayerMode();
  const playlist              = usePlayerPlaylist();
  const { t }                 = useTranslation();

  useListenBrainzScrobble();

  // ── get the underlying HTMLAudioElement ──────────────────────────────
  const getAudioElRef = useRef<() => HTMLAudioElement | null>(() => null);
  const getAudioEl = useCallback((): HTMLAudioElement | null => {
    const ref = playerAudio?.current as unknown as {
      audioEl?: { current?: HTMLAudioElement };
    } | null;
    return ref?.audioEl?.current ?? null;
  }, [playerAudio]);
  useEffect(() => { getAudioElRef.current = getAudioEl; }, [getAudioEl]);

  // ── FIX: Refs to avoid stale closures ────────────────────────────────
  // BUG: load+play useEffect only had [playerUrl] in deps but read playerMode,
  // creating a stale closure. Refs break this without adding playerMode to deps
  // (which would re-run the effect and re-call load() on every mode switch).
  const playerModeRef = useRef(playerMode);
  useEffect(() => { playerModeRef.current = playerMode; }, [playerMode]);

  // FIX: wantAutoplayRef signals handleCanPlay to call play() on iOS.
  // This is the fix for the root cause of slow/broken start on iPad.
  const wantAutoplayRef = useRef(false);

  // playerVideoRef: always holds the latest playerVideo so useCallback hooks
  // (handleCanPlay) can read current video data without stale closure issues.
  const playerVideoRef = useRef(playerVideo);
  useEffect(() => { playerVideoRef.current = playerVideo; }, [playerVideo]);

  // FIX: Stable refs for fallbackUrls and expectedDuration.
  // This keeps handleLoadedMetadata's identity stable so the event listener
  // is never torn down and re-added between renders (race condition fix).
  const fallbackUrlsRef = useRef(fallbackUrls);
  const expectedDurationRef = useRef(playerVideo.video?.lengthSeconds ?? 0);
  useEffect(() => { fallbackUrlsRef.current = fallbackUrls; }, [fallbackUrls]);
  useEffect(() => {
    expectedDurationRef.current = playerVideo.video?.lengthSeconds ?? 0;
  }, [playerVideo.video?.lengthSeconds]);

  // ── Seek helper ──────────────────────────────────────────────────────
  const seekTo = useCallback((time: number) => {
    const audio = getAudioEl();
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(time, audio.duration || Infinity));
  }, [getAudioEl]);

  // Read currentTime directly from the audio element for useMediaSession —
  // avoids subscribing PlayerAudio to PlayerProgress context (which would
  // cause PlayerAudio and all its hooks to re-render every 500ms listen tick).
  const getCurrentTimeForSession = useCallback(
    () => getAudioElRef.current()?.currentTime ?? null,
    [],
  );

  useWakeLock(!playerState.paused && !!playerUrl);

  useMediaSession({
    title:       playerVideo.video?.title    ?? null,
    artist:      playerVideo.video?.author   ?? null,
    album:       null,
    artworkUrl:  playerVideo.thumbnailUrl    ?? null,
    duration:    playerState.audioDuration   ?? null,
    currentTime: getCurrentTimeForSession(),
    paused:      playerState.paused,
    onPlay:           () => getAudioElRef.current()?.play(),
    onPause:          () => getAudioElRef.current()?.pause(),
    onPreviousTrack:  () => { if (videosIds.previousVideoId) play(videosIds.previousVideoId, playlist.length ? playlist : null); },
    onNextTrack:      () => { if (videosIds.nextVideoId)     play(videosIds.nextVideoId,     playlist.length ? playlist : null); },
    onSeek:           seekTo,
  });

  useNotificationPlaybackControl({
    onPrev:   () => { if (videosIds.previousVideoId) play(videosIds.previousVideoId, playlist.length ? playlist : null); },
    onToggle: () => {
      const audio = getAudioElRef.current();
      if (!audio) return;
      if (audio.paused) { audio.play().catch(() => {}); } else { audio.pause(); }
    },
    onNext:   () => { if (videosIds.nextVideoId) play(videosIds.nextVideoId, playlist.length ? playlist : null); },
  });

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const audio = getAudioElRef.current();
      if (!audio || playerState.paused) return;
      if (audio.paused) {
        audio.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [playerState.paused]);

  const retryCountRef = useRef(0);
  const MAX_RETRIES = 2;
  useEffect(() => {
    retryCountRef.current = 0;
    lastAudioDurationRef.current = null; // reset so new track re-syncs audioDuration
  }, [playerUrl]);

  useEffect(() => {
    const audio = getAudioEl();
    if (audio) {
      (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      audio.setAttribute("playsinline", "");
      audio.setAttribute("webkit-playsinline", "");
      audio.setAttribute("x-webkit-airplay", "allow");
      audio.setAttribute("mozaudiochannel", "content");
    }
  }, [getAudioEl, playerUrl]);

  const handlePressSpace = () => {
    const audio = getAudioEl();
    if (!audio) return;
    if (playerState.paused) { audio.play().catch(() => {}); } else { audio.pause(); }
  };
  useHotkeys([["space", handlePressSpace]]);

  // ── Audio event handlers ─────────────────────────────────────────────
  const handlePause = () => {
    wantAutoplayRef.current = false;
    setPlayerStatus((prev) => ({ ...prev, paused: true }));
  };

  const handlePlay = () => {
    wantAutoplayRef.current = false;
    setPlayerStatus((prev) => ({ ...prev, paused: false }));
  };

  const handleEnd = () => {
    const audio = getAudioEl();
    if (!audio?.loop && videosIds.nextVideoId) play(videosIds.nextVideoId, playlist.length ? playlist : null);
  };

  // ── FIX: Use API duration as authoritative source, not audio.duration ────
  // ROOT CAUSE OF "6-7 MIN FOR ALL SONGS" ON IPAD:
  //   audio.duration from an Invidious-proxied stream on iOS WebKit is unreliable.
  //   Invidious local-proxied MP4 streams often have incorrect duration metadata
  //   (moov atom at end of file, re-chunked without header fix, wrong Content-Type).
  //   iOS WebKit then reports a wrong duration — often ~360-420s for any song.
  //
  // THE FIX:
  //   handleListen is a plain function (not useCallback), so it is re-created on
  //   every render and always captures the LATEST playerVideo from its closure.
  //   We read playerVideo.video?.lengthSeconds directly — no ref needed, always live.
  //   Fall back to audio.duration only for live streams (where lengthSeconds === 0).
  // Ref tracking the last audioDuration we pushed to PlayerStatus.
  // handleListen only updates PlayerStatus when audioDuration changes (rare —
  // only for live streams). For all other ticks it only calls setPlayerProgress,
  // which does NOT trigger PlayerActions / ButtonRepeat / etc to re-render.
  const lastAudioDurationRef = useRef<number | null>(null);

  const handleListen = (currentTime: number) => {
    const audio = getAudioEl();
    if (!audio) return;

    const apiDuration = playerVideo.video?.lengthSeconds ?? 0;
    const streamDuration = audio.duration;
    const duration = apiDuration > 0
      ? apiDuration
      : (isFinite(streamDuration) && streamDuration > 0 ? streamDuration : null);

    if (duration == null || duration <= 0) return;

    // PERF FIX (iPad): Only update PlayerStatus (audioDuration/duration) when
    // the value actually changes — i.e. once at track start for live streams.
    // For 99% of ticks this branch is skipped, so PlayerStatus context stays
    // stable and status-only components (PlayerActions, ButtonRepeat, etc.)
    // do NOT re-render at all during normal playback.
    const rounded = Math.round(duration);
    if (rounded !== lastAudioDurationRef.current) {
      lastAudioDurationRef.current = rounded;
      setPlayerStatus((prev) => ({
        ...prev,
        audioDuration: rounded,
        duration:      displayTimeBySeconds(duration),
      }));
    }

    // Only PlayerProgress context is updated every 500ms — ~6 progress
    // components re-render, not the full ~27-component tree.
    setPlayerProgress({
      currentTime,
      formatedCurrentTime: displayTimeBySeconds(currentTime, duration),
      percentage:          (100 * currentTime) / duration,
    });
  };

  const handleVolumeChanged = (event: Event) => {
    setPlayerStatus((prev) => ({
      ...prev,
      volume: (event.target as HTMLAudioElement).volume,
    }));
  };

  // handleCanPlay: fires when the browser has buffered enough to play.
  // We use this as the trigger for play() on iOS AND Android Chrome PWA.
  //
  // WHY Android also needs this:
  //   Android Chrome in standalone PWA mode enforces the same autoplay policy
  //   as iOS — play() called immediately after load() is often rejected with
  //   NotAllowedError unless it's within a trusted user-gesture context.
  //   Deferring to canplay (which fires as a continuation of the gesture) is
  //   the correct cross-platform approach for all mobile browsers.
  //
  // NOTE: handleCanPlay is a useCallback so it cannot read playerVideo directly
  // from closure (it would be stale). We read it via a ref instead.
  const handleCanPlay = useCallback(() => {
    // Call audio.play() FIRST — before any React state update.
    // setPlayerState schedules a re-render which, even when batched, adds
    // latency between the canplay event and the actual play() call.
    // On mobile CPUs this delay is measurable.
    const needsCanplayPlay = isAppleWebKit || isAndroidChrome;
    if (wantAutoplayRef.current && playerModeRef.current === "audio" && needsCanplayPlay) {
      wantAutoplayRef.current = false;
      const audio = getAudioElRef.current();
      if (audio && audio.paused) {
        audio.play().catch((err) => {
          if (err?.name !== "AbortError") {
            log.debug("canplay play() rejected", { name: err?.name });
          }
        });
      }
    } else {
      wantAutoplayRef.current = false;
    }
    // Set duration from API data immediately — don't wait for first onListen tick.
    const apiDuration = playerVideoRef.current?.video?.lengthSeconds ?? 0;
    setPlayerStatus((prev) => ({
      ...prev,
      loading: false,
      ...(apiDuration > 0 ? {
        audioDuration: apiDuration,
        duration:      displayTimeBySeconds(apiDuration),
      } : {}),
    }));
  }, [setPlayerStatus]);

  // ── ROOT CAUSE FIX #2 + #3: handleLoadedMetadata ─────────────────────
  //
  // FIX #2 (Wrong/missing duration on iPad):
  //   Duration was only set inside handleListen() which fires every 250ms
  //   AFTER playback starts. On iPad the progress bar showed "0:00" or a
  //   wrong value until the first listen tick.
  //   FIX: Set duration immediately when loadedmetadata fires.
  //
  // FIX #3 (Listener registration race condition):
  //   handleLoadedMetadata was a useCallback that listed fallbackUrls and
  //   expectedDuration as dependencies. Every time those changed (i.e., every
  //   new track), a new function identity was created. The useEffect that
  //   registers the listener would then REMOVE the old listener and ADD the
  //   new one. On fast/cached connections, loadedmetadata can fire BETWEEN
  //   the remove and the add, causing the event to be completely missed.
  //   FIX: Read fallbackUrls and expectedDuration via refs so the callback
  //   identity is STABLE and the listener is registered exactly once per
  //   audio element, never torn down between renders.
  const handleLoadedMetadata = useCallback(() => {
    const audio = getAudioEl();
    if (!audio) return;
    const streamDuration = audio.duration;

    // Infinity = DASH stream hasn't loaded enough segments to know duration yet.
    // Wait for a subsequent loadedmetadata or handleListen to set it.
    if (!isFinite(streamDuration) || streamDuration <= 0) return;

    // FIX: Do NOT override duration from stream metadata.
    // audio.duration from Invidious-proxied streams is unreliable on iOS
    // (wrong moov atom, re-chunked MP4, etc.) and causes the "6-7 min for
    // all songs" bug. The API's lengthSeconds is authoritative for display.
    // handleListen already uses expectedDurationRef for all duration display.
    //
    // BUG FIX (iOS/iPad "slow/no audio"):
    // On iOS WebKit, audio.duration from Invidious-proxied streams is ALWAYS
    // wrong (typically 360-420s regardless of actual song length). The ratio
    // check below was triggering on EVERY song, exhausting all fallback URLs
    // and causing massive startup delays or complete silence on iPad.
    // Skip the ratio check entirely on iOS WebKit — the API duration
    // (lengthSeconds) is already used authoritatively everywhere else.
    //
    // On desktop: still run the sanity check to detect wrong-format streams
    // (e.g. a video stream served where audio-only was expected).
    // We do NOT update playerState.duration here.
    const expectedDuration = expectedDurationRef.current;
    if (!isAppleWebKit && expectedDuration > 0 && isFinite(streamDuration) && streamDuration > 0) {
      const ratio = streamDuration / expectedDuration;
      if (ratio < 0.7 || ratio > 1.3) {
        log.debug("Duration mismatch — wrong format, trying fallback", {
          streamDuration, expectedDuration, ratio,
        });
        const currentFallbacks = fallbackUrlsRef.current;
        if (currentFallbacks.length > 0) {
          const [nextUrl, ...rest] = currentFallbacks;
          setPlayerUrl(nextUrl);
          setPlayerFallbackUrls(rest);
          setPlayerStatus((prev) => ({ ...prev, loading: true }));
        }
      }
    }
  // Intentionally stable: fallbackUrls and expectedDuration read via refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAudioEl, setPlayerStatus, setPlayerUrl, setPlayerFallbackUrls]);

  // Register loadedmetadata once per audio element (stable handler = no race)
  useEffect(() => {
    const audio = getAudioEl();
    if (!audio) return;
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
  }, [getAudioEl, handleLoadedMetadata]);

  // ── Error handler ─────────────────────────────────────────────────────
  const handleError = useCallback(() => {
    const audio = getAudioEl();
    const errorCode = (audio as HTMLAudioElement & { error?: { code: number } })
      ?.error?.code ?? 0;

    log.debug("Audio error", { errorCode, fallbacks: fallbackUrls.length });

    if (errorCode === 1) return; // aborted by browser (src change) — ignore

    if (fallbackUrls.length > 0) {
      const [nextUrl, ...rest] = fallbackUrls;
      log.debug("Audio playback failed, trying fallback format", { remaining: rest.length });
      setPlayerUrl(nextUrl);
      setPlayerFallbackUrls(rest);
      setPlayerStatus((prev) => ({ ...prev, loading: true }));
      return;
    }

    const videoId = playerVideo.video?.videoId;
    if (errorCode === 2 && videoId && retryCountRef.current < MAX_RETRIES) {
      retryCountRef.current += 1;
      log.debug("Network error — re-fetching fresh stream URL", { videoId, attempt: retryCountRef.current });
      setPlayerStatus((prev) => ({ ...prev, loading: true }));
      play(videoId, playlist.length ? playlist : null);
      return;
    }

    retryCountRef.current = 0;
    wantAutoplayRef.current = false;
    setPlayerStatus((prev) => ({ ...prev, loading: false }));
    setPlayerMode("video");
    showNotification({
      title:     t("error"),
      message:   t("player.mode.audio.error.message"),
      autoClose: 8000,
    });
  }, [fallbackUrls, playerVideo.video?.videoId, play, setPlayerUrl, setPlayerFallbackUrls, setPlayerStatus, setPlayerMode, t, getAudioEl]);

  // ── Correct load sequence for iOS and Android Chrome PWA ────────────
  //
  // iOS WebKit: audio.load() is MANDATORY (src change alone doesn't restart).
  // Android Chrome PWA: play() after load() in the same tick is often rejected
  // with NotAllowedError in standalone mode (same policy as iOS).
  //
  // THE FIX (same for both):
  //   Set wantAutoplayRef = true, call load().
  //   Do NOT call play() here.
  //   handleCanPlay() calls play() once the browser signals readiness.
  //   On desktop Chrome/Firefox: wantAutoplayRef is set but handleCanPlay
  //   calls play() fine (browsers are permissive about play timing there).
  useEffect(() => {
    if (!playerUrl) return;
    const audio = getAudioEl();
    if (!audio) return;

    if (playerModeRef.current === "audio") {
      wantAutoplayRef.current = true; // canplay will call play() when ready
    }
    audio.load(); // mandatory on iOS; safe and correct on all platforms
    // ← do NOT call play() here — rejected by iOS/Android PWA (AbortError/NotAllowedError)

  // playerMode is read via ref — NOT listed in deps to avoid re-running
  // (and re-calling load()) on every audio/video mode toggle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerUrl]);

  return (
    <Box
      aria-hidden="true"
      style={{
        position: "absolute",
        width: 0,
        height: 0,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
      }}
    >
      <ReactAudioPlayer
        ref={playerAudio}
        src={playerUrl ?? undefined}
        // autoPlay=false: we manage play() manually via handleCanPlay (iOS fix).
        // On desktop, this is equivalent because we call play() in canplay too.
        autoPlay={false}
        preload="auto"
        controls
        // PERFORMANCE FIX: 500ms instead of 250ms.
        // handleListen calls setPlayerState which re-renders the entire
        // PlayerState context tree. On iPad's CPU, 4 renders/sec causes
        // main-thread jank that delays native audio events (canplay, etc).
        // 500ms (2/sec) is still smooth for the progress bar and unnoticeable
        // to the user, but cuts render pressure in half during playback.
        listenInterval={500}
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
