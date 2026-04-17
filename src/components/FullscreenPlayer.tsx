import {
  ActionIcon,
  Box,
  Center,
  Drawer,
  Flex,
  Loader,
  ScrollArea,
  Slider,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconChevronDown,
  IconMaximize,
  IconMinimize,
  IconMicrophone2,
  IconMusic,
  IconPhoto,
  IconPlaylist,
  IconVideo,
  IconVideoOff,
} from "@tabler/icons-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "react-query";
import { useTranslation } from "react-i18next";

import { usePlayVideo } from "../hooks/usePlayVideo";
import { useAudioElement, usePlayerProgress, usePlayerStatus, usePlayerVideo } from "../providers/Player";
import { usePlayerPlaylist } from "../providers/PlayerPlaylist";
import { usePlayerMode, useSetPlayerMode } from "../providers/PlayerMode";
import { useSetVideoIframeVisibility } from "../providers/VideoIframeVisibility";
import { usePreviousNextVideos } from "../providers/PreviousNextTrack";
import { useFullscreenPlayer, useSetFullscreenPlayer } from "../providers/FullscreenPlayer";
import { useSettings } from "../providers/Settings";
import { DEFAULT_INVIDIOUS_URI, normalizeInstanceUri } from "../utils/invidiousInstance";
import { useNativeFullscreen } from "../hooks/useNativeFullscreen";
import { ButtonRepeat } from "./ButtonRepeat";
import { ButtonFavorite } from "./ButtonFavorite";
import { ButtonAddToPlaylist } from "./ButtonAddToPlaylist";
import { ButtonStop } from "./ButtonStop";
import { PlayerActions } from "./PlayerActions";
import { VideoList } from "./VideoList";
import {
  getCurrentLineIndex,
  getLyrics,
  extractArtistTrack,
  type LyricLine,
} from "../services/lyrics";
import classes from "./FullscreenPlayer.module.css";

type View = "artwork" | "lyrics";

export const FullscreenPlayer = memo(() => {
  const open = useFullscreenPlayer();
  const setOpen = useSetFullscreenPlayer();
  const { video, thumbnailUrl } = usePlayerVideo();
  const [view, setView] = useState<View>("artwork");
  const [showQueue, setShowQueue] = useState(false);
  const { t } = useTranslation();
  const playlist = usePlayerPlaylist();
  const playerMode = usePlayerMode();
  const setPlayerMode = useSetPlayerMode();
  const setVideoIframeVisibility = useSetVideoIframeVisibility();
  const getAudioEl = useAudioElement();
  const { overlayRef, nativeFsActive, enterFullscreen, exitFullscreen } = useNativeFullscreen();

  useEffect(() => {
    if (!open) {
      setView("artwork");
      setShowQueue(false);
      exitFullscreen();
    }
  }, [open, exitFullscreen]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  const handleToggleVideo = () => {
    if (playerMode === "video") {
      setPlayerMode("audio");
      setVideoIframeVisibility(false);
      const audio = getAudioEl();
      audio?.play();
    } else {
      setPlayerMode("video");
      setVideoIframeVisibility(true);
      const audio = getAudioEl();
      audio?.pause();
    }
  };

  return (
    <Box ref={overlayRef} className={classes.overlay} data-open={open}>
      {/* Blurred bg */}
      {thumbnailUrl && (
        <img src={thumbnailUrl} alt="" className={classes.bgImg} aria-hidden="true" />
      )}
      <Box className={classes.bgDim} />

      {/* Top bar */}
      <Flex className={classes.topBar} align="center" justify="space-between">
        <Tooltip label="Minimise (Esc)" withArrow>
          <ActionIcon variant="subtle" c="white" size="lg" onClick={() => setOpen(false)}>
            <IconChevronDown size={22} />
          </ActionIcon>
        </Tooltip>
        <Text c="white" size="xs" fw={700} className={classes.nowPlayingLabel}>
          Now Playing
        </Text>
        <Flex gap={4} align="center">
          <Tooltip label={nativeFsActive ? "Exit fullscreen" : "Fullscreen"} withArrow>
            <ActionIcon
              size="lg"
              variant="subtle"
              c="white"
              className={classes.nativeFsBtn}
              onClick={nativeFsActive ? exitFullscreen : enterFullscreen}
              aria-label="Toggle fullscreen"
            >
              {nativeFsActive ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={view === "lyrics" ? "Show artwork" : "Show lyrics"} withArrow>
            <ActionIcon
              size="lg"
              variant="subtle"
              c="white"
              onClick={() => setView((v) => v === "lyrics" ? "artwork" : "lyrics")}
              style={{
                opacity: video ? 1 : 0.35,
                background: view === "lyrics" ? "rgba(42,181,165,0.22)" : "rgba(255,255,255,0.08)",
                borderRadius: 10,
                transition: "background 0.2s ease",
              }}
            >
              {view === "lyrics" ? <IconPhoto size={18} /> : <IconMicrophone2 size={18} />}
            </ActionIcon>
          </Tooltip>
        </Flex>
      </Flex>

      {/* Main body */}
      <Box className={classes.body}>
        <Box className={classes.artworkArea}>
          {playerMode === "video" && video ? (
            <Box className={classes.videoArea}>
              <InlineVideo />
            </Box>
          ) : view === "lyrics" && video ? (
            <LyricsView />
          ) : (
            <ArtworkCarousel />
          )}
        </Box>

        <Box className={classes.infoArea}>
          <TrackInfo />
          <ProgressSection />

          {/* Primary playback controls */}
          <Flex className={classes.controls} align="center" justify="center" gap={28}>
            <ButtonRepeat iconSize={18} />
            <PlayerActions />
            <ButtonFavorite iconSize={18} variant="transparent" />
          </Flex>

          {/* Secondary pill action row */}
          <Flex className={classes.actionRow} align="center" justify="center" gap={0} mt={16}>
            <Tooltip label={view === "lyrics" ? "Hide lyrics" : "Lyrics"} withArrow>
              <ActionIcon
                className={classes.actionBtn}
                data-active={view === "lyrics"}
                size="lg"
                variant="subtle"
                c="white"
                onClick={() => setView((v) => v === "lyrics" ? "artwork" : "lyrics")}
                disabled={!video}
              >
                <IconMicrophone2 size={16} />
              </ActionIcon>
            </Tooltip>

            <Box className={classes.actionDivider} />

            <Tooltip label="Queue" withArrow>
              <ActionIcon
                className={classes.actionBtn}
                size="lg"
                variant="subtle"
                c="white"
                onClick={() => setShowQueue(true)}
              >
                <IconPlaylist size={16} />
              </ActionIcon>
            </Tooltip>

            <Box className={classes.actionDivider} />

            <Tooltip label="Add to playlist" withArrow>
              <Box className={classes.actionBtnWrap}>
                <ButtonAddToPlaylist />
              </Box>
            </Tooltip>

            <Box className={classes.actionDivider} />

            <Tooltip label={playerMode === "video" ? "Switch to audio" : "Watch video"} withArrow>
              <ActionIcon
                className={classes.actionBtn}
                data-active={playerMode === "video"}
                size="lg"
                variant="subtle"
                c="white"
                onClick={handleToggleVideo}
              >
                {playerMode === "video" ? <IconVideoOff size={16} /> : <IconVideo size={16} />}
              </ActionIcon>
            </Tooltip>

            <Box className={classes.actionDivider} />

            <Box className={classes.actionBtnWrap}>
              <ButtonStop iconSize={16} />
            </Box>
          </Flex>
        </Box>
      </Box>

      {/* Queue Drawer */}
      <Drawer
        opened={showQueue}
        onClose={() => setShowQueue(false)}
        title={t("player.next.song")}
        position="right"
        size="md"
        styles={{
          body: { padding: "var(--mantine-spacing-lg)" },
          root: { zIndex: 300 },
        }}
      >
        <ScrollArea style={{ height: "calc(100vh - 80px)" }}>
          <VideoList videos={playlist} />
        </ScrollArea>
      </Drawer>
    </Box>
  );
});

/* ── Cascading artwork carousel ──────────────────────────────────────────── */
const ArtworkCarousel = memo(() => {
  const { thumbnailUrl } = usePlayerVideo();
  const { videosIds } = usePreviousNextVideos();
  const playlist = usePlayerPlaylist();
  const { handlePlay } = usePlayVideo();

  const prevVideo = playlist.find((v) => v.videoId === videosIds.previousVideoId);
  const nextVideo = playlist.find((v) => v.videoId === videosIds.nextVideoId);

  const getBestThumb = (thumbs: { url: string; quality?: string }[] | undefined) => {
    if (!thumbs?.length) return null;
    const preferred = thumbs.find(
      (t) => t.quality === "medium" || t.quality === "default" || t.quality === "high",
    );
    return (preferred ?? thumbs[0]).url;
  };

  const prevThumb = getBestThumb(prevVideo?.videoThumbnails);
  const nextThumb = getBestThumb(nextVideo?.videoThumbnails);

  return (
    <Flex className={classes.carousel} align="center" justify="center">
      {/* Previous */}
      {prevThumb ? (
        <Tooltip label={prevVideo?.title ?? "Previous"} withArrow position="top">
          <UnstyledButton
            className={classes.artSide}
            onClick={() =>
              handlePlay(videosIds.previousVideoId as string, playlist.length ? playlist : null)
            }
          >
            <img src={prevThumb} alt={prevVideo?.title ?? ""} className={classes.artImg} />
          </UnstyledButton>
        </Tooltip>
      ) : (
        <Box className={`${classes.artSide} ${classes.artSideEmpty}`} />
      )}

      {/* Current */}
      <Box className={classes.artCurrent}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className={classes.artImg} />
        ) : (
          <Box className={classes.artPlaceholder} />
        )}
      </Box>

      {/* Next */}
      {nextThumb ? (
        <Tooltip label={nextVideo?.title ?? "Next"} withArrow position="top">
          <UnstyledButton
            className={classes.artSide}
            onClick={() =>
              handlePlay(videosIds.nextVideoId as string, playlist.length ? playlist : null)
            }
          >
            <img src={nextThumb} alt={nextVideo?.title ?? ""} className={classes.artImg} />
          </UnstyledButton>
        </Tooltip>
      ) : (
        <Box className={`${classes.artSide} ${classes.artSideEmpty}`} />
      )}
    </Flex>
  );
});

/* ── Track info ───────────────────────────────────────────────────────────── */
const TrackInfo = memo(() => {
  const { video } = usePlayerVideo();

  return (
    <Box className={classes.trackInfo}>
      <Text c="white" fw={700} lineClamp={2} className={classes.trackTitle}>
        {video?.title ?? "—"}
      </Text>
      <Text c="rgba(255,255,255,0.6)" size="sm" lineClamp={1} className={classes.trackArtist}>
        {video?.author ?? ""}
      </Text>
    </Box>
  );
});

/* ── Progress bar ─────────────────────────────────────────────────────────── */
const ProgressSection = memo(() => {
  const getAudioEl = useAudioElement();
  const playerProgress = usePlayerProgress();
  const playerStatus = usePlayerStatus();

  const handleChangeEnd = (v: number) => {
    const audio = getAudioEl();
    if (!audio) return;
    const duration = playerStatus.audioDuration
      ?? (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    if (!duration) return;
    audio.currentTime = (v * duration) / 100;
  };

  return (
    <Box className={classes.progressSection}>
      <Flex justify="space-between" mb={8}>
        <Text size="xs" c="rgba(255,255,255,0.5)" style={{ fontVariantNumeric: "tabular-nums" }}>
          {playerProgress.formatedCurrentTime ?? "0:00"}
        </Text>
        <Text size="xs" c="rgba(255,255,255,0.5)" style={{ fontVariantNumeric: "tabular-nums" }}>
          {playerStatus.duration ?? "0:00"}
        </Text>
      </Flex>
      <Slider
        label={null}
        value={playerProgress.percentage ?? 0}
        onChangeEnd={handleChangeEnd}
        size={4}
        styles={{
          track: { backgroundColor: "rgba(255,255,255,0.2)", cursor: "pointer" },
          bar: { backgroundColor: "#2ab5a5" },
          thumb: {
            backgroundColor: "white",
            border: "none",
            width: 14,
            height: 14,
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
          },
        }}
      />
    </Box>
  );
});

/* ── Inline video — clean iframe with no overlay UI ──────────────────────── */
const InlineVideo = memo(() => {
  const { video } = usePlayerVideo();
  const playerProgress = usePlayerProgress();
  const settings = useSettings();
  const [invidiousFailed, setInvidiousFailed] = useState(false);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = Math.floor(playerProgress.currentTime ?? 0);
  const base = normalizeInstanceUri(
    settings?.currentInstance?.uri ?? DEFAULT_INVIDIOUS_URI,
  );

  const invidiousSrc = useMemo(() => {
    if (!video) return "";
    const url = new URL(`${base}/embed/${video.videoId}`);
    url.searchParams.set("autoplay", "1");
    if (start > 0) url.searchParams.set("start", String(start));
    url.searchParams.set("local", "true");
    return url.toString();
  // Only rebuild when video changes, not on every currentTime tick
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, video?.videoId]);

  const youtubeSrc = useMemo(() => {
    if (!video) return "";
    const url = new URL(`https://www.youtube-nocookie.com/embed/${video.videoId}`);
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("rel", "0");
    if (start > 0) url.searchParams.set("start", String(start));
    return url.toString();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.videoId]);

  useEffect(() => {
    if (!video || invidiousFailed) return;
    loadTimerRef.current = setTimeout(() => setInvidiousFailed(true), 8000);
    return () => { if (loadTimerRef.current) clearTimeout(loadTimerRef.current); };
  }, [invidiousSrc]);

  useEffect(() => { setInvidiousFailed(false); }, [video?.videoId]);

  if (!video) return null;

  return (
    <iframe
      className={classes.inlineIframe}
      src={invidiousFailed ? youtubeSrc : invidiousSrc}
      title={video.title}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      loading="lazy"
      onLoad={() => { if (loadTimerRef.current) clearTimeout(loadTimerRef.current); }}
    />
  );
});

/* ── Lyrics view ──────────────────────────────────────────────────────────── */
const LyricsView = memo(() => {
  const { video } = usePlayerVideo();
  const playerProgress = usePlayerProgress();
  const activeLineRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const { artist, track } = video
    ? extractArtistTrack(video.title, video.author)
    : { artist: "", track: "" };

  const { data: lyrics, isLoading } = useQuery(
    ["lyrics", video?.videoId ?? ""],
    () => getLyrics(track, artist, undefined, video?.lengthSeconds ?? undefined),
    { enabled: !!video, staleTime: 1000 * 60 * 60, retry: false },
  );

  const currentTime = playerProgress.currentTime ?? 0;
  const lines: LyricLine[] = lyrics?.lines ?? [];
  const hasSynced = lines.length > 0;
  const currentIdx = hasSynced ? getCurrentLineIndex(lines, currentTime) : -1;

  useEffect(() => {
    if (activeLineRef.current) {
      // Use "instant" not "smooth" — smooth runs a JS animation on every 500ms
      // listen tick, causing main-thread jank on WebKit (iPad/iPhone) that
      // competes with audio buffering. Matches SyncedLyrics.tsx behavior.
      activeLineRef.current.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center" });
    }
  }, [currentIdx]);

  if (isLoading) {
    return (
      <Center className={classes.lyricsContainer}>
        <Loader size="sm" color="teal" type="dots" />
      </Center>
    );
  }

  // Check instrumental BEFORE the no-lyrics guard — LRCLIB returns
  // instrumental: true with null syncedLyrics + null plainLyrics, so
  // the guard below fires first and hides the instrumental state.
  if (lyrics?.instrumental) {
    return (
      <Center className={classes.lyricsContainer} style={{ flexDirection: "column", gap: 12 }}>
        <IconMusic size={36} color="rgba(42,181,165,0.4)" />
        <Text c="rgba(255,255,255,0.5)" size="sm">Instrumental</Text>
      </Center>
    );
  }

  if (!lyrics || (!hasSynced && !lyrics.plainLyrics)) {
    return (
      <Center className={classes.lyricsContainer} style={{ flexDirection: "column", gap: 12 }}>
        <IconMusic size={36} color="rgba(255,255,255,0.2)" />
        <Text c="rgba(255,255,255,0.4)" size="sm">No lyrics found</Text>
        {(artist || track) && (
          <Text c="rgba(255,255,255,0.25)" size="xs">{artist} — {track}</Text>
        )}
      </Center>
    );
  }

  if (hasSynced) {
    return (
      <ScrollArea
        className={classes.lyricsContainer}
        viewportRef={scrollAreaRef}
        type="never"
        style={{ width: "100%" }}
      >
        <Box className={classes.lyricsInner}>
          {lines.map((line, i) => {
            const isActive = i === currentIdx;
            const isPast = i < currentIdx;
            return (
              <Box
                key={i}
                ref={isActive ? activeLineRef : undefined}
                className={classes.lyricLine}
                data-active={isActive}
                data-past={isPast}
              >
                <Text className={classes.lyricText} data-active={isActive} data-past={isPast}>
                  {line.text || "·"}
                </Text>
              </Box>
            );
          })}
          <Box style={{ height: 80 }} />
        </Box>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className={classes.lyricsContainer} type="never" style={{ width: "100%" }}>
      <Box className={classes.lyricsInner}>
        {(lyrics.plainLyrics ?? "").split("\n").map((line, i) => (
          <Text key={i} size="md" c="rgba(255,255,255,0.7)" className={classes.lyricLinePlain}>
            {line || <span style={{ display: "block", height: "0.8em" }} />}
          </Text>
        ))}
      </Box>
    </ScrollArea>
  );
});
