/**
 * InvidiousPlaylistSection
 *
 * Shown on the Playlists page. Lets you paste any Invidious or YouTube playlist
 * URL (or bare playlist ID) to preview and interact with it:
 *
 *   ▶  Play directly in Elysium
 *   ↓  Import as a local saved playlist
 *   ↗  Open on the current Invidious instance
 *   📋  Copy Invidious / YouTube share link
 */

import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Group,
  Image,
  Loader,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconBrandYoutube,
  IconCopy,
  IconExternalLink,
  IconLink,
  IconPlayerPlay,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { memo, useState } from "react";

import { db } from "../database";
import { getPlaylists } from "../database/utils";
import { useSetPlaylists } from "../providers/Playlist";
import { useSettings } from "../providers/Settings";
import { usePlayVideo } from "../hooks/usePlayVideo";
import { getPlaylist } from "../services/playlist";
import { normalizeInstanceUri } from "../utils/invidiousInstance";

import type { Playlist } from "../types/interfaces/Playlist";
import type { Video } from "../types/interfaces/Video";
import type { CardVideo } from "../types/interfaces/Card";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract a YouTube/Invidious playlist ID from any of these forms:
 *   PLxxxxxx
 *   https://www.youtube.com/playlist?list=PLxxxxxx
 *   https://invidious.example.com/playlist?list=PLxxxxxx
 *   https://youtu.be/... (ignored — not a playlist)
 */
function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare ID — YouTube playlist IDs start with PL, RD, UU, FL, etc.
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed) && !/\s/.test(trimmed)) {
    return trimmed;
  }

  // URL with list= param
  try {
    const url = new URL(trimmed);
    const list = url.searchParams.get("list");
    if (list) return list;
  } catch {
    // not a valid URL — try regex fallback
  }

  const match = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (match) return match[1];

  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const InvidiousPlaylistSection = memo(() => {
  const settings     = useSettings();
  const setPlaylists = useSetPlaylists() as (p: Playlist[]) => void;
  const { handlePlay: playVideo } = usePlayVideo();
  const clipboard = useClipboard();

  const [input, setInput]         = useState("");
  const [fetching, setFetching]   = useState(false);
  const [importing, setImporting] = useState(false);
  const [playing, setPlaying]     = useState(false);
  const [playlist, setPlaylist]   = useState<Playlist | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const invidiousBase = normalizeInstanceUri(settings.currentInstance?.uri ?? "");

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const handleFetch = async () => {
    const id = extractPlaylistId(input);
    if (!id) {
      setError("Enter a valid playlist ID or URL (YouTube or Invidious).");
      return;
    }

    setFetching(true);
    setError(null);
    setPlaylist(null);

    try {
      const data = await getPlaylist(id);
      if (!data || !(data as any).title) {
        setError("Playlist not found or instance returned no data. Try a different Invidious instance in Settings.");
        return;
      }
      setPlaylist(data);
    } catch {
      setError("Could not fetch playlist. The instance may be down or the playlist may be private.");
    } finally {
      setFetching(false);
    }
  };

  // ── Play ───────────────────────────────────────────────────────────────────

  const handlePlay = async () => {
    if (!playlist?.videos?.length) return;
    setPlaying(true);
    try {
      const [first, ...rest] = playlist.videos as Video[];
      playVideo(first.videoId, [first, ...rest] as Video[]);
      notifications.show({
        title: "Now playing",
        message: `${(playlist as any).title} — ${playlist.videoCount} videos`,
        color: "teal",
        autoClose: 4000,
      });
    } finally {
      setPlaying(false);
    }
  };

  // ── Import ─────────────────────────────────────────────────────────────────

  const handleImport = () => {
    if (!playlist) return;
    setImporting(true);
    try {
      const title = (playlist as any).title ?? "Imported Playlist";
      const videos = (playlist.videos as CardVideo[]).map((v) => ({
        type: "video" as const,
        videoId: v.videoId,
        title: v.title,
        thumbnail: v.thumbnail ?? "",
        liveNow: false,
        lengthSeconds: (v as any).lengthSeconds ?? 0,
      }));

      db.insert("playlists", {
        createdAt: new Date().toISOString(),
        title,
        videos,
        videoCount: videos.length,
        type: "playlist",
      });
      db.commit();
      setPlaylists(getPlaylists());

      notifications.show({
        title: "Playlist imported",
        message: `"${title}" (${videos.length} videos) saved to your playlists.`,
        color: "teal",
        autoClose: 5000,
      });
    } finally {
      setImporting(false);
    }
  };

  // ── Share ──────────────────────────────────────────────────────────────────

  const playlistId = playlist ? (playlist as any).playlistId ?? extractPlaylistId(input) : null;

  const handleCopyInvidious = () => {
    if (!playlistId) return;
    clipboard.copy(`${invidiousBase}/playlist?list=${playlistId}`);
    notifications.show({ title: "Copied", message: "Invidious playlist link copied.", autoClose: 2500 });
  };

  const handleCopyYouTube = () => {
    if (!playlistId) return;
    clipboard.copy(`https://www.youtube.com/playlist?list=${playlistId}`);
    notifications.show({ title: "Copied", message: "YouTube playlist link copied.", autoClose: 2500 });
  };

  const handleClear = () => {
    setPlaylist(null);
    setError(null);
    setInput("");
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const pl = playlist as any;
  const thumbUrl: string | null = pl?.playlistThumbnail ?? pl?.videoThumbnails?.[0]?.url ?? null;

  return (
    <Box mb="xl">
      <Card
        withBorder
        radius="md"
        p="md"
        style={{
          background: "var(--sp-surface, #181818)",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {/* Header */}
        <Flex align="center" gap="sm" mb="md">
          <IconLink size={16} style={{ color: "var(--sp-accent, #1db954)", flexShrink: 0 }} />
          <Text fw={700} size="sm" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Open Invidious Playlist
          </Text>
        </Flex>

        {/* Input row */}
        <Flex gap="xs" align="flex-start">
          <TextInput
            style={{ flex: 1 }}
            placeholder="Paste a playlist URL or ID (YouTube or Invidious)"
            value={input}
            onChange={e => { setInput(e.currentTarget.value); setError(null); }}
            onKeyDown={e => { if (e.key === "Enter") handleFetch(); }}
            error={error ?? undefined}
            leftSection={<IconSearch size={14} />}
            rightSection={
              input ? (
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={handleClear}>
                  <IconX size={12} />
                </ActionIcon>
              ) : null
            }
            size="sm"
          />
          <Button
            size="sm"
            onClick={handleFetch}
            loading={fetching}
            disabled={!input.trim()}
            leftSection={fetching ? undefined : <IconSearch size={14} />}
            variant="filled"
          >
            Fetch
          </Button>
        </Flex>

        {/* Result card */}
        {playlist && (
          <Box
            mt="md"
            p="sm"
            style={{
              background: "rgba(255,255,255,0.03)",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <Flex gap="sm" align="flex-start">
              {/* Thumbnail */}
              {thumbUrl && (
                <Image
                  src={thumbUrl}
                  width={72}
                  height={54}
                  radius="sm"
                  style={{ flexShrink: 0, objectFit: "cover" }}
                  fallbackSrc="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='54'%3E%3Crect fill='%23222' width='72' height='54'/%3E%3C/svg%3E"
                />
              )}

              {/* Info */}
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text
                  fw={700}
                  size="sm"
                  lineClamp={1}
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {pl.title ?? "Untitled Playlist"}
                </Text>

                <Group gap={6} mt={4}>
                  <Badge size="xs" variant="light" color="teal">
                    {playlist.videoCount} videos
                  </Badge>
                  {pl.author && (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      by {pl.author}
                    </Text>
                  )}
                </Group>

                {pl.description && (
                  <Text size="xs" c="dimmed" lineClamp={2} mt={4}>
                    {pl.description}
                  </Text>
                )}
              </Box>
            </Flex>

            {/* Action row */}
            <Flex gap="xs" mt="sm" wrap="wrap" align="center">
              {/* Play */}
              <Tooltip label="Play in Elysium">
                <Button
                  size="xs"
                  variant="filled"
                  color="teal"
                  leftSection={playing ? <Loader size={10} color="white" /> : <IconPlayerPlay size={13} />}
                  onClick={handlePlay}
                  disabled={!playlist.videos?.length || playing}
                >
                  Play
                </Button>
              </Tooltip>

              {/* Import */}
              <Tooltip label="Save to your playlists">
                <Button
                  size="xs"
                  variant="light"
                  color="teal"
                  leftSection={importing ? <Loader size={10} /> : <IconArrowDown size={13} />}
                  onClick={handleImport}
                  disabled={importing}
                >
                  Import
                </Button>
              </Tooltip>

              <Box style={{ flex: 1 }} />

              {/* Copy Invidious link */}
              <Tooltip label="Copy Invidious link">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  onClick={handleCopyInvidious}
                >
                  <IconCopy size={13} />
                </ActionIcon>
              </Tooltip>

              {/* Copy YouTube link */}
              <Tooltip label="Copy YouTube link">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  onClick={handleCopyYouTube}
                >
                  <IconBrandYoutube size={13} />
                </ActionIcon>
              </Tooltip>

              {/* Open on Invidious */}
              {playlistId && (
                <Tooltip label="Open on Invidious">
                  <ActionIcon
                    component="a"
                    href={`${invidiousBase}/playlist?list=${playlistId}`}
                    target="_blank"
                    size="sm"
                    variant="subtle"
                    color="teal"
                  >
                    <IconExternalLink size={13} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Flex>
          </Box>
        )}

        {/* Loading skeleton */}
        {fetching && (
          <Flex align="center" gap="xs" mt="md">
            <Loader size="xs" />
            <Text size="xs" c="dimmed">Fetching playlist from Invidious…</Text>
          </Flex>
        )}
      </Card>
    </Box>
  );
});
