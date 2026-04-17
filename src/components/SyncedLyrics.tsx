import {
  Badge,
  Box,
  Center,
  Loader,
  ScrollArea,
  Text,
} from "@mantine/core";
import { memo, useEffect, useRef } from "react";
import { useQuery } from "react-query";

import { usePlayerProgress, usePlayerVideo } from "../providers/Player";
import {
  getCurrentLineIndex,
  getLyrics,
  extractArtistTrack,
  type LyricLine,
} from "../services/lyrics";

export const SyncedLyrics = memo(() => {
  const { video } = usePlayerVideo();
  const playerState = usePlayerProgress();
  const activeLineRef = useRef<HTMLDivElement>(null);

  // Parse artist/track from video title + author using multi-format extractor
  const { artist, track } = video
    ? extractArtistTrack(video.title, video.author)
    : { artist: "", track: "" };

  const { data: lyrics, isLoading } = useQuery(
    ["lyrics", video?.videoId ?? ""],
    () =>
      getLyrics(
        track,
        artist,
        undefined,
        video?.lengthSeconds ?? undefined,
      ),
    {
      enabled: !!video,
      staleTime: 1000 * 60 * 60,
      retry: false,
    },
  );

  const currentTime = playerState.currentTime ?? 0;
  const lines: LyricLine[] = lyrics?.lines ?? [];
  const hasSynced = lines.length > 0;
  const hasPlain = Boolean(lyrics?.plainLyrics);
  const currentIdx = hasSynced ? getCurrentLineIndex(lines, currentTime) : -1;

  // Auto-scroll active line into view.
  // PERF FIX (iPad): Use "instant" not "smooth" — smooth scroll runs a JS
  // animation that fires every 500ms alongside the listen interval, causing
  // main-thread jank on WebKit that competes with audio buffering/decoding.
  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: "instant" as ScrollBehavior,
        block: "center",
      });
    }
  }, [currentIdx]);

  if (!video) {
    return (
      <Center style={{ height: 300 }}>
        <Text c="dimmed" size="sm">No track playing</Text>
      </Center>
    );
  }

  if (isLoading) {
    return (
      <Center style={{ height: 300 }}>
        <Loader size="sm" />
      </Center>
    );
  }

  // Check instrumental BEFORE checking for empty content — LRCLIB returns
  // instrumental: true with null syncedLyrics + null plainLyrics, so the
  // "no lyrics" guard below would fire first and hide this state.
  if (lyrics?.instrumental) {
    return (
      <Center style={{ height: 300 }}>
        <Text c="dimmed" size="sm">🎵 Instrumental</Text>
      </Center>
    );
  }

  if (!lyrics || (!hasSynced && !hasPlain)) {
    return (
      <Center style={{ height: 300, flexDirection: "column", gap: 8 }}>
        <Text c="dimmed" size="sm">No lyrics found</Text>
        <Text c="dimmed" size="xs">
          {artist} — {track}
        </Text>
      </Center>
    );
  }

  // Synced lyrics view
  if (hasSynced) {
    return (
      <Box>
        <Box px="md" pt="xs" pb={4} style={{ textAlign: "center" }}>
          <Badge color="green" variant="light" size="xs">Synced Lyrics</Badge>
        </Box>
        <ScrollArea
          style={{ height: "clamp(200px, calc(100vh - 580px), 480px)" }}
        >
          <Box px="md" py="lg" style={{ textAlign: "center" }}>
            {lines.map((line, i) => {
              const isActive = i === currentIdx;
              const isPast = i < currentIdx;
              return (
                <Box
                  key={i}
                  ref={isActive ? activeLineRef : undefined}
                  py={4}
                  style={{ transition: "all 0.3s ease" }}
                >
                  <Text
                    size={isActive ? "xl" : "md"}
                    fw={isActive ? 700 : 400}
                    c={
                      isActive
                        ? "white"
                        : isPast
                          ? "dimmed"
                          : "var(--mantine-color-gray-5)"
                    }
                    style={{
                      transition: "all 0.3s ease",
                      opacity: isPast ? 0.45 : isActive ? 1 : 0.65,
                      lineHeight: 1.5,
                    }}
                  >
                    {line.text || "·"}
                  </Text>
                </Box>
              );
            })}
            <Box style={{ height: 80 }} />
          </Box>
        </ScrollArea>
      </Box>
    );
  }

  // Plain lyrics fallback (no synced lyrics available)
  return (
    <Box>
      <Box px="md" pt="xs" pb={4} style={{ textAlign: "center" }}>
        <Badge color="gray" variant="light" size="xs">Plain Lyrics</Badge>
      </Box>
      <ScrollArea style={{ height: "clamp(200px, calc(100vh - 580px), 480px)" }}>
        <Box px="md" py="lg" style={{ textAlign: "center" }}>
          {(lyrics.plainLyrics ?? "").split("\n").map((line, i) => (
            <Text key={i} size="sm" c="dimmed" py={2} style={{ lineHeight: 1.6 }}>
              {line || <br />}
            </Text>
          ))}
        </Box>
      </ScrollArea>
    </Box>
  );
});
