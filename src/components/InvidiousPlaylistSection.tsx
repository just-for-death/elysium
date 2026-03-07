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
 *   ➕  Add a video by URL or ID to the remote playlist (requires Invidious login)
 *   ✕   Remove a video from the remote playlist (requires Invidious login)
 */

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Divider,
  Flex,
  Group,
  Image,
  Loader,
  ScrollArea,
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
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconExternalLink,
  IconLink,
  IconListSearch,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { memo, useState } from "react";

import { db } from "../database";
import { getPlaylists } from "../database/utils";
import { useSetPlaylists } from "../providers/Playlist";
import { useSettings } from "../providers/Settings";
import { usePlayVideo } from "../hooks/usePlayVideo";
import { getPlaylist } from "../services/playlist";
import {
  addVideoToInvidiousPlaylist,
  removeVideoFromInvidiousPlaylist,
  fetchInvidiousPlaylist,
  type InvidiousCredentials,
} from "../services/invidiousAuth";
import { normalizeInstanceUri } from "../utils/invidiousInstance";

import type { Playlist } from "../types/interfaces/Playlist";
import type { Video } from "../types/interfaces/Video";
import type { CardVideo } from "../types/interfaces/Card";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed) && !/\s/.test(trimmed)) {
    return trimmed;
  }

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

/** Extract a video ID from a bare ID or a YouTube/Invidious URL */
function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare video ID (11 chars, YouTube-style)
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    // youtube.com/watch?v=...
    const v = url.searchParams.get("v");
    if (v) return v;
    // youtu.be/<id>
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("?")[0];
  } catch {
    // fallback regex
  }

  const match = trimmed.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (match) return match[1];

  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const InvidiousPlaylistSection = memo(() => {
  const settings     = useSettings();
  const setPlaylists = useSetPlaylists() as (p: Playlist[]) => void;
  const { handlePlay: playVideo } = usePlayVideo();
  const clipboard = useClipboard();

  // Auth
  const isLoggedIn = !!settings.invidiousSid && !!settings.invidiousUsername;
  const creds: InvidiousCredentials | null = isLoggedIn
    ? {
        instanceUrl: settings.invidiousLoginInstance ?? settings.currentInstance?.uri ?? "",
        sid:         settings.invidiousSid!,
        username:    settings.invidiousUsername!,
      }
    : null;

  const [input, setInput]         = useState("");
  const [fetching, setFetching]   = useState(false);
  const [importing, setImporting] = useState(false);
  const [playing, setPlaying]     = useState(false);
  const [playlist, setPlaylist]   = useState<Playlist | null>(null);
  const [error, setError]         = useState<string | null>(null);

  // Track list expand/collapse
  const [showTracks, setShowTracks] = useState(false);

  // Add video state
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding]     = useState(false);

  // Remove video state: set of videoIds currently being removed
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

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
    setShowTracks(false);

    try {
      // When logged in, use the authenticated endpoint — it returns indexId per video,
      // which is required for the remove-video API call.
      // Fall back to public API if not logged in or if auth fetch fails.
      let data: any = null;
      if (creds) {
        try {
          data = await fetchInvidiousPlaylist(creds, id);
        } catch {
          // auth fetch failed, fall through to public API
        }
      }
      if (!data) {
        data = await getPlaylist(id);
      }
      if (!data || !data.title) {
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

  // ── Background refresh after mutations ────────────────────────────────────

  const refreshPlaylist = async () => {
    if (!playlist) return;
    const id = (playlist as any).playlistId ?? extractPlaylistId(input);
    if (!id) return;
    try {
      let data: any = null;
      if (creds) {
        try { data = await fetchInvidiousPlaylist(creds, id); } catch { /* fallback */ }
      }
      if (!data) data = await getPlaylist(id);
      if (data?.title) setPlaylist(data);
    } catch {
      // silent
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
      const pid = (playlist as any).playlistId as string | undefined;
      const videos = (playlist.videos as CardVideo[]).map((v) => ({
        type: "video" as const,
        videoId: v.videoId,
        title: v.title,
        thumbnail: v.thumbnail ?? "",
        liveNow: false,
        lengthSeconds: (v as any).lengthSeconds ?? 0,
      }));

      const allLocal = db.queryAll("playlists") as any[];

      // 1. Check by playlistId (Invidious/YouTube playlist ID)
      if (pid) {
        const byPid = allLocal.find((p) => p.playlistId === pid);
        if (byPid) {
          notifications.show({
            title: "Already imported",
            message: `"${byPid.title}" is already in your playlists.`,
            color: "blue",
            autoClose: 4000,
          });
          return;
        }
      }

      // 2. Check by title
      const byTitle = allLocal.find(
        (p) => p.title === title && p.title !== "Favorites" && p.title !== "Cache"
      );
      if (byTitle) {
        notifications.show({
          title: "Already imported",
          message: `A playlist called "${title}" already exists.`,
          color: "blue",
          autoClose: 4000,
        });
        return;
      }

      // 3. Brand new — insert with syncId + playlistId
      db.insert("playlists", {
        createdAt: new Date().toISOString(),
        title,
        videos,
        videoCount: videos.length,
        type: "playlist",
        playlistId: pid ?? "",
        syncId: crypto.randomUUID(),
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

  // ── Add video to remote playlist ───────────────────────────────────────────

  const handleAddVideo = async () => {
    if (!creds || !playlist) return;
    const videoId = extractVideoId(addInput);
    if (!videoId) {
      setAddError("Enter a valid YouTube video ID or URL.");
      return;
    }

    const playlistId = (playlist as any).playlistId ?? extractPlaylistId(input);
    if (!playlistId) {
      setAddError("Could not determine playlist ID.");
      return;
    }

    setAdding(true);
    setAddError(null);
    try {
      await addVideoToInvidiousPlaylist(creds, playlistId, videoId);
      setAddInput("");
      notifications.show({
        title: "Video added",
        message: `Added to remote playlist.`,
        color: "teal",
        autoClose: 3000,
      });
      await refreshPlaylist();
    } catch (e: any) {
      setAddError(e?.message ?? "Failed to add video. Make sure you own this playlist.");
    } finally {
      setAdding(false);
    }
  };

  // ── Remove video from remote playlist ─────────────────────────────────────

  const handleRemoveVideo = async (videoId: string) => {
    if (!creds || !playlist) return;
    const playlistId = (playlist as any).playlistId ?? extractPlaylistId(input);
    if (!playlistId) return;

    // Invidious DELETE /api/v1/auth/playlists/:id/videos/:index requires
    // the video's "indexId" field (not the videoId). Find it from raw playlist data.
    const rawVideo = (playlist.videos as any[]).find((v: any) => v.videoId === videoId);
    const indexId: string | undefined = rawVideo?.indexId;
    if (!indexId) {
      notifications.show({
        title: "Remove failed",
        message: "Could not find video index. Try fetching this playlist while logged in — the remove feature requires the authenticated playlist view.",
        color: "red",
        autoClose: 5000,
      });
      return;
    }

    setRemovingIds(prev => new Set(prev).add(videoId));
    try {
      await removeVideoFromInvidiousPlaylist(creds, playlistId, indexId);
      notifications.show({
        title: "Video removed",
        message: "Removed from remote playlist.",
        color: "teal",
        autoClose: 2500,
      });
      await refreshPlaylist();
    } catch (e: any) {
      notifications.show({
        title: "Remove failed",
        message: e?.message ?? "Could not remove video. Make sure you own this playlist.",
        color: "red",
        autoClose: 4000,
      });
    } finally {
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
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
    setShowTracks(false);
    setAddInput("");
    setAddError(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const pl = playlist as any;
  const thumbUrl: string | null = pl?.playlistThumbnail ?? pl?.videoThumbnails?.[0]?.url ?? null;
  const videos = (playlist?.videos ?? []) as CardVideo[];

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
              <Tooltip label="Save to your local playlists">
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

              {/* Show / hide tracks toggle */}
              {videos.length > 0 && (
                <Tooltip label={showTracks ? "Hide tracks" : "Browse & edit tracks"}>
                  <Button
                    size="xs"
                    variant={showTracks ? "light" : "subtle"}
                    color={showTracks ? "teal" : "gray"}
                    leftSection={<IconListSearch size={13} />}
                    rightSection={showTracks ? <IconChevronUp size={11} /> : <IconChevronDown size={11} />}
                    onClick={() => setShowTracks(v => !v)}
                  >
                    Tracks
                  </Button>
                </Tooltip>
              )}

              <Box style={{ flex: 1 }} />

              {/* Copy Invidious link */}
              <Tooltip label="Copy Invidious link">
                <ActionIcon size="sm" variant="subtle" color="gray" onClick={handleCopyInvidious}>
                  <IconCopy size={13} />
                </ActionIcon>
              </Tooltip>

              {/* Copy YouTube link */}
              <Tooltip label="Copy YouTube link">
                <ActionIcon size="sm" variant="subtle" color="red" onClick={handleCopyYouTube}>
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

            {/* ── Tracks panel (collapsible) ─────────────────────────────── */}
            <Collapse in={showTracks}>
              <Divider my="sm" />

              {/* Add video row */}
              {isLoggedIn ? (
                <Box mb="sm">
                  <Text size="xs" fw={600} mb={6} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    Add video to remote playlist
                  </Text>
                  <Flex gap="xs" align="flex-start">
                    <TextInput
                      style={{ flex: 1 }}
                      size="xs"
                      placeholder="Paste a YouTube video URL or ID"
                      value={addInput}
                      onChange={e => { setAddInput(e.currentTarget.value); setAddError(null); }}
                      onKeyDown={e => { if (e.key === "Enter") handleAddVideo(); }}
                      error={addError ?? undefined}
                      leftSection={<IconPlus size={12} />}
                    />
                    <Button
                      size="xs"
                      variant="filled"
                      color="teal"
                      loading={adding}
                      disabled={!addInput.trim() || adding}
                      onClick={handleAddVideo}
                      leftSection={adding ? undefined : <IconPlus size={12} />}
                    >
                      Add
                    </Button>
                  </Flex>
                </Box>
              ) : (
                <Text size="xs" c="dimmed" mb="sm">
                  Log in to your Invidious account in{" "}
                  <strong>Settings → Invidious Account</strong> to add or remove videos.
                </Text>
              )}

              {/* Track list */}
              <ScrollArea.Autosize mah={320} offsetScrollbars>
                <Stack gap={3}>
                  {videos.map((v, i) => {
                    const isRemoving = removingIds.has(v.videoId);
                    return (
                      <Flex
                        key={v.videoId}
                        align="center"
                        gap="xs"
                        px="xs"
                        py={6}
                        style={{
                          borderRadius: 6,
                          background: isRemoving
                            ? "rgba(255,59,48,0.07)"
                            : "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,255,255,0.04)",
                          opacity: isRemoving ? 0.55 : 1,
                          transition: "opacity 0.2s, background 0.2s",
                        }}
                      >
                        {/* Track number */}
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{ minWidth: 22, textAlign: "right", userSelect: "none" }}
                        >
                          {i + 1}
                        </Text>

                        {/* Thumbnail */}
                        <Image
                          src={v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/default.jpg`}
                          width={40}
                          height={28}
                          radius="xs"
                          style={{ flexShrink: 0, objectFit: "cover" }}
                          fallbackSrc="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='28'%3E%3Crect fill='%23222' width='40' height='28'/%3E%3C/svg%3E"
                        />

                        {/* Title + ID */}
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" lineClamp={1} fw={500}>
                            {v.title}
                          </Text>
                          <Text
                            size="xs"
                            c="dimmed"
                            style={{ fontSize: 10, fontFamily: "monospace" }}
                          >
                            {v.videoId}
                          </Text>
                        </Box>

                        {/* Remove button (requires login) */}
                        {isLoggedIn && (
                          <Tooltip label="Remove from remote playlist">
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              color="red"
                              loading={isRemoving}
                              disabled={isRemoving}
                              onClick={() => handleRemoveVideo(v.videoId)}
                            >
                              <IconTrash size={11} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Flex>
                    );
                  })}
                </Stack>
              </ScrollArea.Autosize>
            </Collapse>
          </Box>
        )}

        {/* Loading indicator */}
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
