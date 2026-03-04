import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Flex,
  Skeleton,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconExternalLink, IconMusic, IconRefresh } from "@tabler/icons-react";
import { memo } from "react";
import { useQuery } from "react-query";

import { useSettings } from "../providers/Settings";
import {
  getLBCreatedForYouPlaylists,
  getLBPlaylistWithTracks,
  resolvePlaylistTracks,
  type LBPlaylist,
} from "../services/listenbrainz-charts";
import { HorizontalGridList } from "./HorizontalGridList";

// ── Colour-coded badge per playlist type ─────────────────────────────────────
function playlistMeta(title: string): { badge: string; color: string } {
  const t = title.toLowerCase();
  if (t.includes("weekly jams"))  return { badge: "Weekly Jams",      color: "blue"   };
  if (t.includes("exploration"))  return { badge: "Exploration",      color: "teal"   };
  if (t.includes("top missed"))   return { badge: "Top Missed",       color: "orange" };
  if (t.includes("last week"))    return { badge: "Last Week's Jams", color: "grape"  };
  if (t.includes("discoveries"))  return { badge: "Discoveries",      color: "green"  };
  if (t.includes("similar"))      return { badge: "Similar Artists",  color: "cyan"   };
  return                                 { badge: "Playlist",         color: "gray"   };
}

// ── One playlist row — fetches full tracks then resolves to videos ────────────
const PlaylistRow = memo(({
  stub,
  token,
  username,
}: {
  stub: LBPlaylist;
  token: string;
  username: string;
}) => {
  const { badge, color } = playlistMeta(stub.title);

  // Pull UUID from identifier URI: https://listenbrainz.org/playlist/<uuid>
  const uuid = stub.identifier.split("/").filter(Boolean).pop() ?? "";
  const lbUrl = uuid
    ? `https://listenbrainz.org/playlist/${uuid}/`
    : `https://listenbrainz.org/user/${encodeURIComponent(username)}/recommendations/`;

  // Step 1: fetch the full playlist (with tracks) — the listing endpoint returns 0 tracks
  const fullPlaylistQuery = useQuery(
    ["lb-playlist-full", uuid],
    () => getLBPlaylistWithTracks(uuid, token),
    {
      staleTime: 1000 * 60 * 30,
      retry: 1,
      enabled: !!uuid && !!token,
    },
  );

  const fullPlaylist = fullPlaylistQuery.data;
  const trackCount   = fullPlaylist?.track?.length ?? 0;

  // Step 2: resolve tracks → CardVideos via Invidious (only when we have tracks)
  const videosQuery = useQuery(
    ["lb-playlist-videos", uuid],
    () => resolvePlaylistTracks(fullPlaylist!.track, 20),
    {
      staleTime: 1000 * 60 * 30,
      retry: 1,
      enabled: !!fullPlaylist && trackCount > 0,
    },
  );

  const date = (fullPlaylist?.date ?? stub.date)
    ? new Date(fullPlaylist?.date ?? stub.date).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric",
      })
    : null;

  const annotation = fullPlaylist?.annotation ?? stub.annotation;
  const isLoading  = fullPlaylistQuery.isLoading || videosQuery.isLoading;

  return (
    <Box mb={48}>
      {/* Row header */}
      <Flex align="center" gap={8} mb={6} wrap="wrap">
        <Title order={3} style={{ fontSize: "1.05rem", fontWeight: 600 }}>
          {stub.title}
        </Title>
        <Badge size="xs" color={color} variant="light" style={{ flexShrink: 0 }}>
          {badge}
        </Badge>
        {date && <Text size="xs" c="dimmed">{date}</Text>}
        {!fullPlaylistQuery.isLoading && (
          <Text size="xs" c="dimmed">· {trackCount} track{trackCount !== 1 ? "s" : ""}</Text>
        )}
        <Tooltip label="View on ListenBrainz" position="top" withArrow>
          <Anchor
            href={lbUrl}
            target="_blank"
            rel="noopener noreferrer"
            c="dimmed"
            style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}
          >
            <IconExternalLink size={14} />
          </Anchor>
        </Tooltip>
      </Flex>

      {/* Description */}
      {annotation && (
        <Text size="xs" c="dimmed" mb={8} lineClamp={2}
          dangerouslySetInnerHTML={{ __html: annotation }}
        />
      )}

      {/* Skeleton while loading */}
      {isLoading && (
        <Flex gap={12} style={{ overflow: "hidden" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={160} width={140} radius="md" style={{ flexShrink: 0 }} />
          ))}
        </Flex>
      )}

      {/* Resolved video cards */}
      {!isLoading && !!videosQuery.data?.length && (
        <HorizontalGridList data={videosQuery.data} label={stub.title} />
      )}

      {/* Tracks exist but Invidious couldn't resolve any */}
      {!isLoading && trackCount > 0 && !videosQuery.data?.length && (
        <Flex align="center" gap={8} p="sm"
          style={(theme) => ({
            borderRadius: theme.radius.md,
            border: `1px dashed light-dark(${theme.colors.gray[3]}, ${theme.colors.dark[4]})`,
          })}
        >
          <IconMusic size={15} opacity={0.4} />
          <Text size="sm" c="dimmed">
            Couldn't resolve tracks via Invidious.{" "}
            <Anchor href={lbUrl} target="_blank" rel="noopener noreferrer" size="sm">
              Listen on ListenBrainz ↗
            </Anchor>
          </Text>
        </Flex>
      )}

      {/* Playlist is genuinely empty (no tracks generated yet) */}
      {!isLoading && trackCount === 0 && !fullPlaylistQuery.isError && (
        <Flex align="center" gap={8} p="sm"
          style={(theme) => ({
            borderRadius: theme.radius.md,
            border: `1px dashed light-dark(${theme.colors.gray[3]}, ${theme.colors.dark[4]})`,
          })}
        >
          <IconMusic size={15} opacity={0.4} />
          <Text size="sm" c="dimmed">
            No tracks in this playlist yet.{" "}
            <Anchor href={lbUrl} target="_blank" rel="noopener noreferrer" size="sm">
              View on ListenBrainz ↗
            </Anchor>
          </Text>
        </Flex>
      )}
    </Box>
  );
});

// ── Main section ──────────────────────────────────────────────────────────────
export const ListenBrainzRecommendations = memo(() => {
  const settings = useSettings();
  const username  = settings.listenBrainzUsername;
  const token     = settings.listenBrainzToken;
  const enabled   = !!username && !!token && (settings.listenBrainzEnabled ?? false);

  const playlistsQuery = useQuery(
    ["lb-created-for-you", username],
    () => getLBCreatedForYouPlaylists(username!, token!, 10),
    { enabled, staleTime: 1000 * 60 * 30, retry: 1 },
  );

  if (!enabled) return null;

  const recsUrl = `https://listenbrainz.org/user/${encodeURIComponent(username!)}/recommendations/`;

  return (
    <Box mb={20}>
      {/* Section header */}
      <Flex align="center" gap={10} mb={4}>
        <Title order={2}>Created for you</Title>
        <Tooltip label="Refresh" position="top" withArrow>
          <ActionIcon
            variant="subtle"
            size="sm"
            loading={playlistsQuery.isFetching}
            onClick={() => playlistsQuery.refetch()}
          >
            <IconRefresh size={14} />
          </ActionIcon>
        </Tooltip>
        <Anchor
          href={recsUrl}
          target="_blank"
          rel="noopener noreferrer"
          size="xs"
          c="dimmed"
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}
        >
          Open on ListenBrainz <IconExternalLink size={12} />
        </Anchor>
      </Flex>

      <Text size="sm" c="dimmed" mb="xl">
        Your personalised playlists from{" "}
        <Anchor href={recsUrl} target="_blank" rel="noopener noreferrer" size="sm">
          ListenBrainz recommendations
        </Anchor>
        {" "}— Weekly Jams, Exploration, Top Missed Recordings and more.
      </Text>

      {/* Loading skeletons while the list loads */}
      {playlistsQuery.isLoading && (
        <Stack gap="xl">
          {[0, 1, 2].map((i) => (
            <Box key={i}>
              <Skeleton height={22} width={260} mb={10} />
              <Flex gap={12}>
                {Array.from({ length: 6 }).map((_, j) => (
                  <Skeleton key={j} height={160} width={140} radius="md" style={{ flexShrink: 0 }} />
                ))}
              </Flex>
            </Box>
          ))}
        </Stack>
      )}

      {/* API error fetching the list */}
      {playlistsQuery.isError && (
        <Flex align="center" gap={8} p="md"
          style={(theme) => ({
            borderRadius: theme.radius.md,
            border: `1px solid light-dark(${theme.colors.red[3]}, ${theme.colors.red[9]})`,
            background: `light-dark(${theme.colors.red[0]}, rgba(201,42,42,0.08))`,
          })}
        >
          <Text size="sm" c="red">
            Failed to load playlists.{" "}
            <Anchor href={recsUrl} target="_blank" rel="noopener noreferrer" size="sm" c="red">
              View on ListenBrainz ↗
            </Anchor>
          </Text>
        </Flex>
      )}

      {/* No playlists returned */}
      {!playlistsQuery.isLoading && !playlistsQuery.isError &&
        playlistsQuery.data?.length === 0 && (
        <Flex align="center" gap={8} p="md"
          style={(theme) => ({
            borderRadius: theme.radius.md,
            border: `1px dashed light-dark(${theme.colors.gray[3]}, ${theme.colors.dark[4]})`,
          })}
        >
          <IconMusic size={16} opacity={0.4} />
          <Text size="sm" c="dimmed">
            No playlists yet — they're generated on Monday mornings.{" "}
            <Anchor href={recsUrl} target="_blank" rel="noopener noreferrer" size="sm">
              Check ListenBrainz ↗
            </Anchor>
          </Text>
        </Flex>
      )}

      {/* One row per playlist stub — each row fetches its own full content */}
      {playlistsQuery.data?.map((stub) => (
        <PlaylistRow
          key={stub.identifier}
          stub={stub}
          token={token!}
          username={username!}
        />
      ))}
    </Box>
  );
});
