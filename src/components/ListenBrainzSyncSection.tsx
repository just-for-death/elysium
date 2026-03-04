/**
 * ListenBrainzSyncSection — v3
 *
 * Shown on the Playlists page. Fetches your ListenBrainz playlists via your
 * saved token, enriches tracks without YouTube IDs via Invidious search, and
 * lets you:
 *
 *  • ▶  Play a LB playlist directly in Elysium (resolves all tracks to YouTube)
 *  • ↓  Import a LB playlist as a local Elysium playlist (fully resolved)
 *  • ＋  Add music FROM Elysium to any LB playlist (converts to JSPF / LB format)
 *  • ↗  Open on ListenBrainz.org
 *
 * Track resolution flow:
 *   LB track has youtube_id in extension → use it directly
 *   LB track only has artist + title      → search Invidious for "artist - title"
 *   Adding Elysium track to LB            → parseArtistTrack() + buildJspfTrack()
 */

import {
  Accordion,
  ActionIcon,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Flex,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconBrandLastfm,
  IconCheck,
  IconExternalLink,
  IconMusic,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { db } from "../database";
import { getPlaylists } from "../database/utils";
import { useSetPlaylists, usePlaylists } from "../providers/Playlist";
import { useSettings } from "../providers/Settings";
import { usePlayVideo } from "../hooks/usePlayVideo";

import type { Playlist } from "../types/interfaces/Playlist";
import type { CardVideo } from "../types/interfaces/Card";
import type { Video } from "../types/interfaces/Video";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import { getCurrentInstance } from "../utils/getCurrentInstance";
import {
  getListenBrainzPlaylists,
  getListenBrainzPlaylistById,
  addTracksToListenBrainzPlaylist,
  enrichLBPlaylistTracks,
  videoToLBTrack,
  type LBPlaylist,
  type LBEnrichedTrack,
} from "../services/listenbrainz";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_OPTIONS = [
  { value: "0",  label: "Manual only" },
  { value: "5",  label: "Every 5 min" },
  { value: "10", label: "Every 10 min" },
  { value: "30", label: "Every 30 min" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelative(d: Date | null): string {
  if (!d) return "never";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 10)  return "just now";
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function enrichedToCardVideo(t: LBEnrichedTrack): CardVideo | null {
  if (!t.videoId) return null;
  return {
    type: "video",
    videoId: t.videoId,
    title: t.title,
    thumbnail: t.thumbnail ?? `https://i.ytimg.com/vi/${t.videoId}/mqdefault.jpg`,
    liveNow: false,
    lengthSeconds: 0,
  };
}

// ─── Add-to-LB modal ──────────────────────────────────────────────────────────

interface AddToLBModalProps {
  playlist: LBPlaylist;
  credentials: { userToken: string; username: string };
  onClose: () => void;
}

const AddToLBModal = memo(({ playlist, credentials, onClose }: AddToLBModalProps) => {
  const localPlaylists = usePlaylists();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());

  // Flatten all local playlist videos into a searchable list
  const allTracks = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ videoId: string; title: string; author: string; playlistTitle: string }> = [];
    for (const pl of localPlaylists) {
      if ((pl as any).type === "cache" || pl.title === "Cache") continue;
      for (const v of pl.videos as any[]) {
        if (!v.videoId || seen.has(v.videoId)) continue;
        seen.add(v.videoId);
        out.push({
          videoId: v.videoId,
          title: v.title ?? "Unknown",
          author: v.author ?? v.videoAuthor ?? "",
          playlistTitle: pl.title,
        });
      }
    }
    return out;
  }, [localPlaylists]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return allTracks.slice(0, 60);
    return allTracks
      .filter(t => t.title.toLowerCase().includes(q) || t.author.toLowerCase().includes(q))
      .slice(0, 60);
  }, [allTracks, search]);

  const handleAdd = async (track: typeof allTracks[number]) => {
    if (added.has(track.videoId)) return;
    setAdding(prev => new Set(prev).add(track.videoId));
    try {
      const lbTrack = videoToLBTrack(track);
      const result = await addTracksToListenBrainzPlaylist(
        credentials,
        playlist.mbid,
        [lbTrack],
      );
      if (result.success) {
        setAdded(prev => new Set(prev).add(track.videoId));
        notifications.show({
          title: "Added to ListenBrainz",
          message: `"${lbTrack.title}" added to "${playlist.title}"`,
          color: "teal",
          autoClose: 3500,
        });
      } else {
        notifications.show({
          title: "Failed to add",
          message: result.error ?? "Unknown error",
          color: "red",
        });
      }
    } finally {
      setAdding(prev => { const s = new Set(prev); s.delete(track.videoId); return s; });
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconBrandLastfm size={16} color="#2ab5a5" />
          <Text fw={700} size="sm" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Add music to "{playlist.title}"
          </Text>
        </Group>
      }
      size="lg"
      radius="md"
    >
      <Stack gap="sm">
        {/* Info banner */}
        <Box
          p="xs"
          style={{
            background: "rgba(42,181,165,0.06)",
            borderRadius: 8,
            border: "1px solid rgba(42,181,165,0.15)",
          }}
        >
          <Text size="xs" c="dimmed">
            Tracks are converted to ListenBrainz-compatible JSPF format before
            adding. Artist and title are parsed from the YouTube video title and
            the YouTube URL is embedded as the track identifier.
          </Text>
        </Box>

        {/* Search */}
        <TextInput
          placeholder="Search your library…"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={e => setSearch(e.currentTarget.value)}
          size="sm"
        />

        {allTracks.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="md">
            No tracks in your local playlists yet.
          </Text>
        ) : (
          <ScrollArea h={380} type="scroll">
            <Stack gap={3}>
              {filtered.map(track => {
                const isAdded   = added.has(track.videoId);
                const isAdding  = adding.has(track.videoId);
                return (
                  <Flex
                    key={track.videoId}
                    align="center"
                    justify="space-between"
                    px="sm"
                    py={8}
                    style={{
                      background: isAdded
                        ? "rgba(42,181,165,0.07)"
                        : "rgba(42,181,165,0.025)",
                      borderRadius: 7,
                      border: isAdded
                        ? "1px solid rgba(42,181,165,0.2)"
                        : "1px solid rgba(42,181,165,0.06)",
                      transition: "all 0.15s",
                    }}
                  >
                    {/* Thumbnail */}
                    <Avatar
                      src={`https://i.ytimg.com/vi/${track.videoId}/default.jpg`}
                      size={32}
                      radius="sm"
                      style={{ flexShrink: 0 }}
                    />

                    {/* Info */}
                    <Box style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                      <Text
                        size="sm"
                        fw={600}
                        lineClamp={1}
                        style={{
                          color: "var(--sp-text-primary)",
                          fontFamily: "'Plus Jakarta Sans', sans-serif",
                          lineHeight: 1.3,
                        }}
                      >
                        {track.title}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {track.author || "Unknown artist"}{" "}
                        <span style={{ opacity: 0.5 }}>· {track.playlistTitle}</span>
                      </Text>
                    </Box>

                    {/* Action */}
                    <Tooltip label={isAdded ? "Added!" : "Add to this LB playlist"}>
                      <ActionIcon
                        size="sm"
                        variant={isAdded ? "filled" : "subtle"}
                        color="teal"
                        loading={isAdding}
                        onClick={() => handleAdd(track)}
                        disabled={isAdded}
                        ml={8}
                        style={{ flexShrink: 0 }}
                      >
                        {isAdded ? <IconCheck size={13} /> : <IconPlus size={13} />}
                      </ActionIcon>
                    </Tooltip>
                  </Flex>
                );
              })}
              {filtered.length === 0 && (
                <Text size="xs" c="dimmed" ta="center" py="md">
                  No tracks match "{search}"
                </Text>
              )}
            </Stack>
          </ScrollArea>
        )}

        <Flex justify="flex-end">
          <Button size="xs" variant="subtle" color="gray" onClick={onClose}>
            Done
          </Button>
        </Flex>
      </Stack>
    </Modal>
  );
});

// ─── Playlist row ─────────────────────────────────────────────────────────────

interface PlaylistRowProps {
  pl: LBPlaylist;
  credentials: { userToken: string; username: string };
  invidiousBaseUri: string;
  onImported: () => void;
}

const PlaylistRow = memo(({ pl, credentials, invidiousBaseUri, onImported }: PlaylistRowProps) => {
  const setPlaylists = useSetPlaylists() as (p: Playlist[]) => void;
  const { handlePlay: playVideo } = usePlayVideo();

  const [expanded, setExpanded]     = useState(false);
  const [enriched, setEnriched]     = useState<LBEnrichedTrack[] | null>(null);
  const [resolving, setResolving]   = useState(false);
  const [resolveProgress, setResolveProgress] = useState(0);
  const [importingPl, setImportingPl] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  // Load + resolve tracks on expand
  const handleExpand = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (enriched !== null) return; // already loaded

    setResolving(true);
    setResolveProgress(0);
    try {
      // 1. Fetch full track list (the list response often has 0 tracks)
      let tracks = pl.tracks;
      if (!tracks.length && pl.trackCount > 0) {
        const full = await getListenBrainzPlaylistById(credentials, pl.mbid);
        tracks = full?.tracks ?? [];
      }

      if (!tracks.length) {
        setEnriched([]);
        return;
      }

      // 2. Enrich: resolve missing YouTube IDs via Invidious search
      const chunkSize = 4;
      const result: LBEnrichedTrack[] = [];
      for (let i = 0; i < tracks.length; i += chunkSize) {
        const chunk = tracks.slice(i, i + chunkSize);
        const enrichedChunk = await enrichLBPlaylistTracks(chunk, invidiousBaseUri, chunkSize);
        result.push(...enrichedChunk);
        setResolveProgress(Math.round(((i + chunkSize) / tracks.length) * 100));
      }
      setEnriched(result);
    } finally {
      setResolving(false);
      setResolveProgress(100);
    }
  };

  // Play the playlist
  const handlePlayPlaylist = async () => {
    let tracks = enriched;
    if (!tracks) {
      // Quick resolve without expanding
      let rawTracks = pl.tracks;
      if (!rawTracks.length && pl.trackCount > 0) {
        const full = await getListenBrainzPlaylistById(credentials, pl.mbid);
        rawTracks = full?.tracks ?? [];
      }
      tracks = await enrichLBPlaylistTracks(rawTracks, invidiousBaseUri, 4);
      setEnriched(tracks);
    }
    const videos = tracks.map(enrichedToCardVideo).filter(Boolean) as CardVideo[];
    if (!videos.length) {
      notifications.show({ title: "Nothing to play", message: "No YouTube-linked tracks could be resolved.", color: "orange" });
      return;
    }
    playVideo(videos[0].videoId, videos as Video[]);
    notifications.show({
      title: "Now playing",
      message: `"${pl.title}" — ${videos.length} tracks`,
      color: "teal",
      autoClose: 4000,
    });
  };

  // Import as local playlist
  const handleImport = async () => {
    let tracks = enriched;
    if (!tracks) {
      setImportingPl(true);
      let rawTracks = pl.tracks;
      if (!rawTracks.length && pl.trackCount > 0) {
        const full = await getListenBrainzPlaylistById(credentials, pl.mbid);
        rawTracks = full?.tracks ?? [];
      }
      tracks = await enrichLBPlaylistTracks(rawTracks, invidiousBaseUri, 4);
      setEnriched(tracks);
    } else {
      setImportingPl(true);
    }
    try {
      const videos = tracks.map(enrichedToCardVideo).filter(Boolean) as CardVideo[];
      if (!videos.length) {
        notifications.show({ title: "Import failed", message: "No resolvable tracks.", color: "orange" });
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
      onImported();
      notifications.show({
        title: "Imported!",
        message: `"${title}" (${videos.length} tracks) added to your playlists.`,
        color: "teal",
        autoClose: 5000,
      });
    } finally {
      setImportingPl(false);
    }
  };

  const resolvedCount = enriched ? enriched.filter(t => t.videoId).length : null;
  const unresolved    = enriched ? enriched.filter(t => !t.videoId).length : 0;

  return (
    <>
      {addModalOpen && (
        <AddToLBModal
          playlist={pl}
          credentials={credentials}
          onClose={() => setAddModalOpen(false)}
        />
      )}

      {/* Row header */}
      <Box
        style={{
          background: expanded ? "rgba(42,181,165,0.06)" : "rgba(42,181,165,0.03)",
          borderRadius: 8,
          border: expanded ? "1px solid rgba(42,181,165,0.18)" : "1px solid rgba(42,181,165,0.07)",
          overflow: "hidden",
          transition: "all 0.15s",
        }}
      >
        <Flex
          align="center"
          justify="space-between"
          px="sm"
          py={10}
          style={{ cursor: "pointer" }}
          onClick={handleExpand}
        >
          <Flex align="center" gap="sm" style={{ minWidth: 0 }}>
            <IconMusic size={14} color="#2ab5a5" style={{ opacity: 0.7, flexShrink: 0 }} />
            <Box style={{ minWidth: 0 }}>
              <Text
                size="sm"
                fw={600}
                lineClamp={1}
                style={{
                  color: "var(--sp-text-primary)",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  lineHeight: 1.3,
                }}
              >
                {pl.title}
              </Text>
              <Group gap={6}>
                <Text size="xs" c="dimmed">{pl.trackCount} tracks</Text>
                {resolvedCount !== null && resolvedCount < pl.trackCount && (
                  <Badge size="xs" color="orange" variant="light">
                    {unresolved} unresolved
                  </Badge>
                )}
                {resolvedCount !== null && resolvedCount === pl.trackCount && (
                  <Badge size="xs" color="teal" variant="light">
                    All resolved
                  </Badge>
                )}
              </Group>
            </Box>
          </Flex>

          {/* Action buttons */}
          <Group gap={4} onClick={e => e.stopPropagation()}>
            <Tooltip label="Play in Elysium">
              <ActionIcon size="sm" variant="subtle" color="teal" onClick={handlePlayPlaylist}>
                <IconPlayerPlay size={13} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Import to my playlists">
              <ActionIcon size="sm" variant="subtle" color="teal" loading={importingPl} onClick={handleImport}>
                <IconArrowDown size={13} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Add music from Elysium">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="teal"
                onClick={() => setAddModalOpen(true)}
              >
                <IconPlus size={13} />
              </ActionIcon>
            </Tooltip>
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

        {/* Expanded track list */}
        {expanded && (
          <Box px="sm" pb="sm">
            <Divider color="rgba(42,181,165,0.12)" mb="sm" />

            {resolving && (
              <Stack gap={6}>
                <Flex align="center" gap="xs">
                  <Loader size="xs" color="teal" />
                  <Text size="xs" c="dimmed">
                    Resolving tracks to YouTube… {resolveProgress < 100 ? `${resolveProgress}%` : ""}
                  </Text>
                </Flex>
                <Progress value={resolveProgress} color="teal" size="xs" animated />
              </Stack>
            )}

            {!resolving && enriched && enriched.length === 0 && (
              <Text size="xs" c="dimmed" ta="center" py="sm">
                No tracks in this playlist.
              </Text>
            )}

            {!resolving && enriched && enriched.length > 0 && (
              <Stack gap={3}>
                {enriched.map((t, i) => (
                  <Flex
                    key={`${t.videoId ?? t.lbTrack.title}-${i}`}
                    align="center"
                    gap="sm"
                    px={6}
                    py={6}
                    style={{
                      borderRadius: 5,
                      background: t.videoId ? "transparent" : "rgba(255,150,50,0.04)",
                      border: t.videoId ? "none" : "1px solid rgba(255,150,50,0.12)",
                    }}
                  >
                    {/* Thumbnail */}
                    {t.thumbnail ? (
                      <Avatar
                        src={t.thumbnail}
                        size={28}
                        radius="sm"
                        style={{ flexShrink: 0 }}
                      />
                    ) : (
                      <Box
                        style={{
                          width: 28, height: 28, borderRadius: 4, flexShrink: 0,
                          background: "rgba(42,181,165,0.08)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <IconMusic size={12} color="#2ab5a5" style={{ opacity: 0.5 }} />
                      </Box>
                    )}

                    {/* Info */}
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        size="xs"
                        fw={500}
                        lineClamp={1}
                        style={{ color: "var(--sp-text-primary)", lineHeight: 1.3 }}
                      >
                        {t.title}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {t.artist || "Unknown artist"}
                        {t.resolvedViaSearch && (
                          <span style={{ color: "#2ab5a5", marginLeft: 4, opacity: 0.7 }}>
                            · resolved via search
                          </span>
                        )}
                        {!t.videoId && (
                          <span style={{ color: "#ff9060", marginLeft: 4 }}>
                            · could not resolve
                          </span>
                        )}
                      </Text>
                    </Box>

                    {/* Status icon */}
                    {t.videoId ? (
                      <IconCheck size={12} color="#2ab5a5" style={{ flexShrink: 0, opacity: 0.7 }} />
                    ) : (
                      <IconX size={12} color="#ff9060" style={{ flexShrink: 0, opacity: 0.7 }} />
                    )}
                  </Flex>
                ))}
              </Stack>
            )}
          </Box>
        )}
      </Box>
    </>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────

export const ListenBrainzSyncSection = memo(() => {
  const settings     = useSettings();
  const setPlaylists = useSetPlaylists() as (p: Playlist[]) => void;

  const [lbPlaylists, setLbPlaylists] = useState<LBPlaylist[]>([]);
  const [loading, setLoading]         = useState(false);
  const [lastSynced, setLastSynced]   = useState<Date | null>(null);
  const [relTime, setRelTime]         = useState("never");
  const [pollMins, setPollMins]       = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connected =
    !!settings.listenBrainzToken &&
    !!settings.listenBrainzUsername;

  const credentials = connected
    ? { userToken: settings.listenBrainzToken!, username: settings.listenBrainzUsername! }
    : null;

  const invidiousBaseUri = useMemo(
    () => normalizeInstanceUri(getCurrentInstance()?.uri ?? ""),
    [],
  );

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchPlaylists = useCallback(async (silent = false) => {
    if (!credentials) return;
    if (!silent) setLoading(true);
    try {
      const { playlists } = await getListenBrainzPlaylists(credentials, 0, 50);
      setLbPlaylists(playlists);
      setLastSynced(new Date());
    } catch {
      if (!silent)
        notifications.show({ title: "ListenBrainz", message: "Could not fetch playlists", color: "red" });
    } finally {
      if (!silent) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials?.userToken]);

  useEffect(() => { if (connected) fetchPlaylists(); }, [connected]); // eslint-disable-line

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!connected || pollMins === 0) return;
    pollRef.current = setInterval(() => fetchPlaylists(true), pollMins * 60_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [connected, pollMins, fetchPlaylists]);

  useEffect(() => {
    setRelTime(fmtRelative(lastSynced));
    const t = setInterval(() => setRelTime(fmtRelative(lastSynced)), 15_000);
    return () => clearInterval(t);
  }, [lastSynced]);

  // ── Not connected ──────────────────────────────────────────────────────────

  if (!connected) {
    return (
      <Box
        mb="xl"
        p="md"
        style={{
          background: "rgba(42,181,165,0.04)",
          borderRadius: 10,
          border: "1px solid rgba(42,181,165,0.12)",
        }}
      >
        <Flex align="center" gap="sm">
          <IconBrandLastfm size={18} color="#2ab5a5" />
          <Box>
            <Text size="sm" fw={600} style={{ color: "var(--sp-text-primary)" }}>
              ListenBrainz Playlists
            </Text>
            <Text size="xs" c="dimmed">
              Connect your ListenBrainz account in{" "}
              <Anchor href="/settings" size="xs" style={{ color: "#2ab5a5" }}>
                Settings → Scrobbling
              </Anchor>{" "}
              to sync playlists here.
            </Text>
          </Box>
        </Flex>
      </Box>
    );
  }

  // ── Connected ──────────────────────────────────────────────────────────────

  return (
    <Box mb="xl">
      <Accordion
        variant="contained"
        defaultValue={null}
        styles={{
          root:    { borderRadius: 10, overflow: "hidden" },
          control: { padding: "10px 14px" },
          panel:   { padding: "0 14px 14px" },
          item:    {
            border: "1px solid rgba(42,181,165,0.18)",
            background: "rgba(42,181,165,0.03)",
          },
        }}
      >
        <Accordion.Item value="lb-playlists">
          <Accordion.Control
            onClick={() => {
              if (!lbPlaylists.length && !loading) fetchPlaylists();
            }}
          >
            <Flex align="center" justify="space-between" pr="xs">
              <Flex align="center" gap="sm">
                <IconBrandLastfm size={16} color="#2ab5a5" />
                <Box>
                  <Group gap={6}>
                    <Text
                      size="sm"
                      fw={700}
                      style={{
                        color: "var(--sp-text-primary)",
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                      }}
                    >
                      ListenBrainz Playlists
                    </Text>
                    {pollMins > 0 && (
                      <Badge size="xs" color="teal" variant="dot">Live</Badge>
                    )}
                    {lbPlaylists.length > 0 && (
                      <Badge size="xs" color="teal" variant="light">
                        {lbPlaylists.length}
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">
                    {settings.listenBrainzUsername} · synced {relTime}
                  </Text>
                </Box>
              </Flex>
            </Flex>
          </Accordion.Control>

          <Accordion.Panel>
            {/* Toolbar */}
            <Flex align="center" justify="space-between" mb="sm" mt={4} gap="xs" wrap="wrap">
              <Text size="xs" c="dimmed">
                {lbPlaylists.length} playlist{lbPlaylists.length !== 1 ? "s" : ""}
                {" · "}Click a playlist to expand and resolve tracks
              </Text>
              <Group gap="xs">
                <Select
                  size="xs"
                  value={String(pollMins)}
                  onChange={v => setPollMins(Number(v ?? "0"))}
                  data={POLL_OPTIONS}
                  style={{ width: 130 }}
                  styles={{ input: { fontSize: 11 } }}
                />
                <Tooltip label="Refresh now">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="teal"
                    loading={loading}
                    onClick={() => fetchPlaylists()}
                  >
                    <IconRefresh size={14} />
                  </ActionIcon>
                </Tooltip>
                <Anchor
                  href={`https://listenbrainz.org/user/${settings.listenBrainzUsername}/playlists`}
                  target="_blank"
                  size="xs"
                  style={{ color: "#2ab5a5" }}
                >
                  View all →
                </Anchor>
              </Group>
            </Flex>

            {/* Loading */}
            {loading && !lbPlaylists.length && (
              <Center py="md">
                <Loader size="xs" color="teal" />
                <Text size="xs" c="dimmed" ml="xs">Fetching from ListenBrainz…</Text>
              </Center>
            )}

            {/* Empty */}
            {!loading && lbPlaylists.length === 0 && (
              <Box
                p="sm"
                style={{
                  background: "rgba(42,181,165,0.03)",
                  borderRadius: 8,
                  border: "1px solid rgba(42,181,165,0.08)",
                }}
              >
                <Text size="xs" c="dimmed" ta="center">
                  No playlists found for <strong>{settings.listenBrainzUsername}</strong>.
                </Text>
              </Box>
            )}

            {/* Legend */}
            {lbPlaylists.length > 0 && (
              <>
                <Flex gap="md" mb="xs" wrap="wrap">
                  <Group gap={4}>
                    <IconPlayerPlay size={11} color="#2ab5a5" />
                    <Text size="xs" c="dimmed">Play</Text>
                  </Group>
                  <Group gap={4}>
                    <IconArrowDown size={11} color="#2ab5a5" />
                    <Text size="xs" c="dimmed">Import to Elysium</Text>
                  </Group>
                  <Group gap={4}>
                    <IconPlus size={11} color="#2ab5a5" />
                    <Text size="xs" c="dimmed">Add music from Elysium</Text>
                  </Group>
                  <Group gap={4}>
                    <IconExternalLink size={11} color="#2ab5a5" />
                    <Text size="xs" c="dimmed">Open on LB</Text>
                  </Group>
                </Flex>

                {/* Playlist rows */}
                <Stack gap={6}>
                  {lbPlaylists.map(pl => (
                    <PlaylistRow
                      key={pl.mbid}
                      pl={pl}
                      credentials={credentials!}
                      invidiousBaseUri={invidiousBaseUri}
                      onImported={() => setPlaylists(getPlaylists())}
                    />
                  ))}
                </Stack>
              </>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Box>
  );
});
