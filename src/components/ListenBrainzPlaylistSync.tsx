/**
 * ListenBrainzPlaylistSync — v2 (Live / Auto-Sync)
 *
 * Features:
 *  • Auto-fetches your LB playlists on mount (when connected)
 *  • Live polling every N minutes (configurable, default 5 min)
 *  • "Import to Elysium" — creates a local Elysium playlist from any LB playlist
 *  • "Add to Queue" — loads LB playlist tracks straight into the player queue
 *  • Push local playlists → LB (single or bulk)
 *  • Last-synced timestamp + manual refresh
 */

import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Flex,
  Group,
  Loader,
  Progress,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconCheck,
  IconCloudUpload,
  IconExternalLink,
  IconMusic,
  IconPlayerPlay,
  IconPlaylist,
  IconRefresh,
  IconShare,
  IconX,
} from "@tabler/icons-react";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { db } from "../database";
import { getPlaylists } from "../database/utils";
import { usePlaylists, useSetPlaylists } from "../providers/Playlist";
import { useSettings } from "../providers/Settings";
import { useSetPlayerPlaylist } from "../providers/PlayerPlaylist";

import type { Playlist } from "../types/interfaces/Playlist";
import type { CardVideo } from "../types/interfaces/Card";
import {
  createListenBrainzPlaylist,
  getListenBrainzPlaylists,
  getListenBrainzPlaylistById,
  syncAllPlaylistsToListenBrainz,
  type LBPlaylist,
  type LBPlaylistTrack,
} from "../services/listenbrainz";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_OPTIONS = [
  { value: "2", label: "Every 2 minutes" },
  { value: "5", label: "Every 5 minutes" },
  { value: "10", label: "Every 10 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "0", label: "Manual only" },
];

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SyncState {
  status: "idle" | "syncing" | "done" | "error";
  progress: number;
  total: number;
  currentName: string;
  created: string[];
  skipped: string[];
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date | null): string {
  if (!date) return "Never";
  const diff = Date.now() - date.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return "Just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/** Turn an LBPlaylistTrack into a minimal CardVideo for queue/playlist */
function lbTrackToCardVideo(track: LBPlaylistTrack): CardVideo {
  return {
    type: "video",
    videoId: track.videoId,
    title: track.title,
    thumbnail: track.videoId
      ? `https://i.ytimg.com/vi/${track.videoId}/mqdefault.jpg`
      : "",
    liveNow: false,
    lengthSeconds: 0,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const ListenBrainzPlaylistSync = memo(() => {
  const settings = useSettings();
  const localPlaylists = usePlaylists();
  const setPlaylists = useSetPlaylists() as (p: Playlist[]) => void;
  const setPlayerPlaylist = useSetPlayerPlaylist();

  const [lbPlaylists, setLbPlaylists] = useState<LBPlaylist[]>([]);
  const [loadingLB, setLoadingLB] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [pollInterval, setPollInterval] = useState(5); // minutes
  const [importingId, setImportingId] = useState<string | null>(null);
  const [queuingId, setQueuingId] = useState<string | null>(null);
  const [relativeTime, setRelativeTime] = useState("Never");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [syncState, setSyncState] = useState<SyncState>({
    status: "idle",
    progress: 0,
    total: 0,
    currentName: "",
    created: [],
    skipped: [],
    errors: [],
  });

  const hasCredentials =
    !!settings.listenBrainzToken &&
    !!settings.listenBrainzUsername &&
    settings.listenBrainzEnabled;

  const credentials = hasCredentials
    ? {
        userToken: settings.listenBrainzToken!,
        username: settings.listenBrainzUsername!,
      }
    : null;

  // ── Fetch LB playlists ────────────────────────────────────────────────────

  const fetchLBPlaylists = useCallback(
    async (silent = false) => {
      if (!credentials) return;
      if (!silent) setLoadingLB(true);
      try {
        const { playlists } = await getListenBrainzPlaylists(credentials, 0, 50);
        setLbPlaylists(playlists);
        setLastSynced(new Date());
      } catch {
        if (!silent) {
          notifications.show({
            title: "ListenBrainz",
            message: "Failed to fetch playlists",
            color: "red",
          });
        }
      } finally {
        if (!silent) setLoadingLB(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [credentials?.userToken],
  );

  // ── Auto-fetch on mount ───────────────────────────────────────────────────

  useEffect(() => {
    if (hasCredentials) {
      fetchLBPlaylists();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCredentials]);

  // ── Live polling ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current as any);
    if (!hasCredentials || pollInterval === 0) return;

    const ms = pollInterval * 60 * 1000;
    (pollRef.current as any) = setInterval(() => fetchLBPlaylists(true), ms);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current as any);
    };
  }, [hasCredentials, pollInterval, fetchLBPlaylists]);

  // ── Relative time ticker ──────────────────────────────────────────────────

  useEffect(() => {
    const tick = setInterval(() => {
      setRelativeTime(formatRelativeTime(lastSynced));
    }, 15000);
    setRelativeTime(formatRelativeTime(lastSynced));
    return () => clearInterval(tick);
  }, [lastSynced]);

  // ── Import LB playlist as local Elysium playlist ──────────────────────────

  const handleImport = async (pl: LBPlaylist) => {
    if (!credentials) return;
    setImportingId(pl.mbid);
    try {
      let tracks = pl.tracks;
      if (!tracks.length && pl.trackCount > 0) {
        const full = await getListenBrainzPlaylistById(credentials, pl.mbid);
        tracks = full?.tracks ?? [];
      }

      const videos: CardVideo[] = tracks
        .filter((t) => !!t.videoId)
        .map(lbTrackToCardVideo);

      if (!videos.length) {
        notifications.show({
          title: "Import failed",
          message: "No YouTube-linked tracks found in this playlist.",
          color: "orange",
        });
        return;
      }

      const title = `[LB] ${pl.title}`;
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
        title: "Imported!",
        message: `"${title}" (${videos.length} tracks) added to your playlists.`,
        color: "teal",
        autoClose: 5000,
      });
    } finally {
      setImportingId(null);
    }
  };

  // ── Add LB playlist to player queue ───────────────────────────────────────

  const handleAddToQueue = async (pl: LBPlaylist) => {
    if (!credentials) return;
    setQueuingId(pl.mbid);
    try {
      let tracks = pl.tracks;
      if (!tracks.length && pl.trackCount > 0) {
        const full = await getListenBrainzPlaylistById(credentials, pl.mbid);
        tracks = full?.tracks ?? [];
      }

      const videos = tracks.filter((t) => !!t.videoId).map(lbTrackToCardVideo);

      if (!videos.length) {
        notifications.show({
          title: "Queue failed",
          message: "No YouTube-linked tracks found in this playlist.",
          color: "orange",
        });
        return;
      }

      setPlayerPlaylist(videos as any);

      notifications.show({
        title: "Added to queue!",
        message: `${videos.length} tracks from "${pl.title}" queued.`,
        color: "teal",
        autoClose: 4000,
      });
    } finally {
      setQueuingId(null);
    }
  };

  // ── Share single local playlist to LB ────────────────────────────────────

  const handleShareSingle = async (playlist: Playlist) => {
    if (!credentials) return;

    notifications.show({
      id: `lb-share-${playlist.ID}`,
      title: "Sharing to ListenBrainz…",
      message: `Creating playlist "${playlist.title}"`,
      loading: true,
      autoClose: false,
    });

    const tracks: LBPlaylistTrack[] = playlist.videos.map((v: any) => ({
      videoId: v.videoId,
      title: v.title,
      author: (v as any).author ?? (v as any).videoAuthor,
    }));

    const result = await createListenBrainzPlaylist(
      credentials,
      playlist.title,
      tracks,
      `${playlist.videoCount} tracks — exported from Elysium`,
    );

    notifications.hide(`lb-share-${playlist.ID}`);

    if (result.success && result.playlistUrl) {
      navigator.clipboard?.writeText(result.playlistUrl).catch(() => {});
      notifications.show({
        title: "Shared to ListenBrainz!",
        message: (
          <Anchor
            href={result.playlistUrl}
            target="_blank"
            size="sm"
            style={{ color: "#2ab5a5" }}
          >
            View playlist on ListenBrainz
          </Anchor>
        ) as any,
        color: "teal",
        autoClose: 8000,
      });
      fetchLBPlaylists(true);
    } else {
      notifications.show({
        title: "Share failed",
        message: result.error ?? "Unknown error",
        color: "red",
      });
    }
  };

  // ── Sync ALL local → LB ───────────────────────────────────────────────────

  const handleSyncAll = async () => {
    if (!credentials || !localSyncable.length) return;

    setSyncState({
      status: "syncing",
      progress: 0,
      total: localSyncable.length,
      currentName: "",
      created: [],
      skipped: [],
      errors: [],
    });

    const result = await syncAllPlaylistsToListenBrainz(
      credentials,
      localSyncable.map((p) => ({
        title: p.title,
        tracks: p.videos.map((v: any) => ({
          videoId: v.videoId,
          title: v.title,
          author: (v as any).author ?? (v as any).videoAuthor,
        })),
        description: `${p.videoCount} tracks — synced from Elysium`,
      })),
      (done, total, current) => {
        setSyncState((prev) => ({
          ...prev,
          progress: done,
          total,
          currentName: current,
        }));
      },
    );

    setSyncState((prev) => ({
      ...prev,
      status: result.errors.length > 0 ? "error" : "done",
      progress: result.total,
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
    }));

    fetchLBPlaylists(true);

    notifications.show({
      title: "Sync complete",
      message: `${result.created.length} playlists sent to ListenBrainz${
        result.errors.length ? `, ${result.errors.length} failed` : ""
      }`,
      color: result.errors.length ? "orange" : "teal",
    });
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const localSyncable = localPlaylists.filter(
    (p) => p.ID && (p as any).type !== "cache" && p.title !== "Cache",
  );

  // ── Not connected ─────────────────────────────────────────────────────────

  if (!hasCredentials) {
    return (
      <Box
        p="md"
        style={{
          background: "rgba(42,181,165,0.05)",
          borderRadius: 8,
          border: "1px solid rgba(42,181,165,0.12)",
        }}
      >
        <Text size="sm" c="dimmed">
          Connect your ListenBrainz account above to sync and share playlists.
        </Text>
      </Box>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────

  return (
    <Stack gap="md">

      {/* Header */}
      <Flex align="center" justify="space-between" wrap="wrap" gap="xs">
        <Box>
          <Group gap={6}>
            <Title
              order={5}
              style={{
                color: "var(--sp-text-primary)",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
            >
              Playlist Sync
            </Title>
            {pollInterval > 0 && (
              <Tooltip label={`Auto-syncing every ${pollInterval} min`}>
                <Badge
                  size="xs"
                  color="teal"
                  variant="dot"
                  style={{ cursor: "default" }}
                >
                  Live
                </Badge>
              </Tooltip>
            )}
          </Group>
          <Text size="xs" c="dimmed" mt={2}>
            {localSyncable.length} local · {lbPlaylists.length} on ListenBrainz
            {" · "}last synced {relativeTime}
          </Text>
        </Box>

        <Group gap="xs">
          {/* Poll interval selector */}
          <Select
            size="xs"
            value={String(pollInterval)}
            onChange={(v) => setPollInterval(Number(v ?? "5"))}
            data={POLL_OPTIONS}
            style={{ width: 150 }}
            styles={{
              input: {
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontSize: 11,
              },
            }}
          />

          {/* Manual refresh */}
          <Tooltip label="Refresh now">
            <ActionIcon
              onClick={() => fetchLBPlaylists()}
              loading={loadingLB}
              variant="subtle"
              color="teal"
              size="sm"
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>

          {/* Push all local → LB */}
          <Button
            size="xs"
            leftSection={<IconCloudUpload size={14} />}
            onClick={handleSyncAll}
            loading={syncState.status === "syncing"}
            disabled={!localSyncable.length}
            color="teal"
            variant="filled"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Push All
          </Button>
        </Group>
      </Flex>

      {/* Sync progress */}
      {syncState.status === "syncing" && (
        <Box
          p="sm"
          style={{
            background: "rgba(42,181,165,0.08)",
            borderRadius: 8,
            border: "1px solid rgba(42,181,165,0.2)",
          }}
        >
          <Text
            size="xs"
            c="teal.4"
            mb={6}
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Pushing "{syncState.currentName}"… {syncState.progress}/
            {syncState.total}
          </Text>
          <Progress
            value={
              (syncState.progress / Math.max(syncState.total, 1)) * 100
            }
            color="teal"
            size="xs"
            animated
          />
        </Box>
      )}

      {/* Sync result */}
      {(syncState.status === "done" || syncState.status === "error") && (
        <Box
          p="sm"
          style={{
            background: syncState.errors.length
              ? "rgba(255,100,100,0.06)"
              : "rgba(42,181,165,0.08)",
            borderRadius: 8,
            border: `1px solid ${
              syncState.errors.length
                ? "rgba(255,100,100,0.2)"
                : "rgba(42,181,165,0.2)"
            }`,
          }}
        >
          <Group gap="xs" mb={syncState.errors.length ? 6 : 0}>
            {syncState.errors.length === 0 ? (
              <IconCheck size={14} color="#2ab5a5" />
            ) : (
              <IconX size={14} color="#ff6464" />
            )}
            <Text
              size="xs"
              style={{
                color: syncState.errors.length ? "#ff9090" : "#2ab5a5",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
            >
              {syncState.created.length} created
              {syncState.skipped.length
                ? `, ${syncState.skipped.length} skipped (empty)`
                : ""}
              {syncState.errors.length
                ? `, ${syncState.errors.length} failed`
                : ""}
            </Text>
          </Group>
          {syncState.errors.length > 0 && (
            <Text size="xs" c="dimmed" mt={4}>
              {syncState.errors.slice(0, 2).join(", ")}
            </Text>
          )}
        </Box>
      )}

      {/* Local playlists — push to LB */}
      {localSyncable.length > 0 && (
        <Box>
          <Text
            size="xs"
            c="dimmed"
            mb={6}
            style={{
              textTransform: "uppercase",
              letterSpacing: "1px",
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            Local Playlists
          </Text>
          <Stack gap={4}>
            {localSyncable.map((playlist) => (
              <Flex
                key={playlist.ID}
                align="center"
                justify="space-between"
                px="sm"
                py={8}
                style={{
                  background: "rgba(42,181,165,0.04)",
                  borderRadius: 6,
                  border: "1px solid rgba(42,181,165,0.08)",
                }}
              >
                <Flex align="center" gap="sm">
                  <IconPlaylist size={14} color="var(--sp-accent)" />
                  <Box>
                    <Text
                      size="sm"
                      fw={600}
                      style={{
                        color: "var(--sp-text-primary)",
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        lineHeight: 1.2,
                      }}
                    >
                      {playlist.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {playlist.videoCount} tracks
                    </Text>
                  </Box>
                </Flex>
                <Tooltip label="Push to ListenBrainz">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="teal"
                    onClick={() => handleShareSingle(playlist)}
                  >
                    <IconShare size={14} />
                  </ActionIcon>
                </Tooltip>
              </Flex>
            ))}
          </Stack>
        </Box>
      )}

      {/* LB playlists — pull into Elysium */}
      {(lbPlaylists.length > 0 || loadingLB) && (
        <>
          <Divider color="var(--sp-border)" />
          <Box>
            <Flex align="center" justify="space-between" mb={6}>
              <Text
                size="xs"
                c="dimmed"
                style={{
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
              >
                From ListenBrainz
              </Text>
              <Anchor
                href={`https://listenbrainz.org/user/${settings.listenBrainzUsername}/playlists`}
                target="_blank"
                size="xs"
                style={{ color: "var(--sp-accent)" }}
              >
                View all
              </Anchor>
            </Flex>

            {loadingLB && !lbPlaylists.length ? (
              <Center py="sm">
                <Loader size="xs" color="teal" />
                <Text size="xs" c="dimmed" ml="xs">
                  Loading your ListenBrainz playlists…
                </Text>
              </Center>
            ) : (
              <Stack gap={4}>
                {lbPlaylists.map((pl) => (
                  <Flex
                    key={pl.mbid}
                    align="center"
                    justify="space-between"
                    px="sm"
                    py={8}
                    style={{
                      background: "rgba(42,181,165,0.03)",
                      borderRadius: 6,
                      border: "1px solid rgba(42,181,165,0.06)",
                    }}
                  >
                    <Flex align="center" gap="sm">
                      <IconMusic
                        size={14}
                        color="var(--sp-accent)"
                        style={{ opacity: 0.7 }}
                      />
                      <Box>
                        <Text
                          size="sm"
                          fw={500}
                          style={{
                            color: "var(--sp-text-primary)",
                            fontFamily: "'Plus Jakarta Sans', sans-serif",
                            lineHeight: 1.2,
                          }}
                        >
                          {pl.title}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {pl.trackCount} tracks
                        </Text>
                      </Box>
                    </Flex>

                    <Group gap={4}>
                      {/* Add to queue */}
                      <Tooltip label="Add to player queue">
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="teal"
                          loading={queuingId === pl.mbid}
                          onClick={() => handleAddToQueue(pl)}
                        >
                          <IconPlayerPlay size={13} />
                        </ActionIcon>
                      </Tooltip>

                      {/* Import as local playlist */}
                      <Tooltip label="Import to Elysium playlists">
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="teal"
                          loading={importingId === pl.mbid}
                          onClick={() => handleImport(pl)}
                        >
                          <IconArrowDown size={13} />
                        </ActionIcon>
                      </Tooltip>

                      {/* Open on LB */}
                      <Tooltip label="Open on ListenBrainz">
                        <ActionIcon
                          component="a"
                          href={`https://listenbrainz.org/playlist/${pl.mbid}`}
                          target="_blank"
                          size="sm"
                          variant="subtle"
                          color="teal"
                        >
                          <IconExternalLink size={13} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Flex>
                ))}
              </Stack>
            )}
          </Box>
        </>
      )}

      {/* Empty state */}
      {!loadingLB && lbPlaylists.length === 0 && (
        <Box
          p="sm"
          style={{
            background: "rgba(42,181,165,0.03)",
            borderRadius: 8,
            border: "1px solid rgba(42,181,165,0.06)",
          }}
        >
          <Text size="xs" c="dimmed" ta="center">
            No ListenBrainz playlists found for{" "}
            <strong>{settings.listenBrainzUsername}</strong>.
          </Text>
        </Box>
      )}
    </Stack>
  );
});
