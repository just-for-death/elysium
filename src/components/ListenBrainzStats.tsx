import {
  ActionIcon,
  Anchor,
  Box,
  Group,
  Image,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import { memo, useState } from "react";
import { useQuery } from "react-query";

import { usePlayVideo } from "../hooks/usePlayVideo";
import { useSettings } from "../providers/Settings";
import {
  getCoverArtUrl,
  getRecentListens,
  getTopRecordings,
  type LBListen,
  type LBTopRecording,
} from "../services/listenbrainz";
import { search } from "../services/search";

// Fetch YouTube videoId for a track via Invidious search
async function searchYouTubeId(
  artist: string,
  track: string,
): Promise<string | null> {
  try {
    const results = await search({
      q: `${artist} ${track}`,
      service: "invidious",
      type: "video",
      page: 1,
      sortBy: "relevance",
      time: "all",
      duration: "all",
    });
    const first = results.find((r) => r.type === "video") as any;
    return first?.videoId ?? null;
  } catch {
    return null;
  }
}

// Resolve the best thumbnail: CAA first, then YouTube via search
async function resolveThumbnail(
  caaMbid?: string,
  caaId?: number,
  artist?: string,
  track?: string,
): Promise<string | null> {
  // Try Cover Art Archive first
  const caaUrl = getCoverArtUrl(caaMbid, caaId, 250);
  if (caaUrl) {
    try {
      const res = await fetch(caaUrl, { method: "HEAD" });
      if (res.ok) return caaUrl;
    } catch {
      // fall through to YouTube
    }
  }
  if (!artist || !track) return null;
  const videoId = await searchYouTubeId(artist, track);
  if (videoId) {
    // prefer hqdefault for better quality
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  return null;
}

interface TrackRowProps {
  artist: string;
  track: string;
  subtitle?: string;
  right?: React.ReactNode;
  caaMbid?: string;
  caaId?: number;
}

const TrackThumbnail = memo(
  ({
    artist,
    track,
    caaMbid,
    caaId,
  }: {
    artist: string;
    track: string;
    caaMbid?: string;
    caaId?: number;
  }) => {
    const { data: thumbnailUrl, isLoading } = useQuery(
      ["lb-thumbnail", caaMbid ?? "", artist, track],
      () => resolveThumbnail(caaMbid, caaId, artist, track),
      { staleTime: 1000 * 60 * 60, retry: false },
    );

    if (isLoading) {
      return (
        <Skeleton
          width={44}
          height={44}
          radius="sm"
          style={{ flexShrink: 0 }}
        />
      );
    }

    if (!thumbnailUrl) {
      return (
        <Box
          style={{
            width: 44,
            height: 44,
            borderRadius: 6,
            flexShrink: 0,
            background: "light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text size="xs" c="dimmed">♪</Text>
        </Box>
      );
    }

    return (
      <Image
        src={thumbnailUrl}
        width={44}
        height={44}
        radius="sm"
        alt={`${artist} - ${track}`}
        style={{ flexShrink: 0, objectFit: "cover", width: 44, height: 44 }}
        onError={(e) => {
          // hide broken image and show placeholder
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  },
);

const PlayButton = memo(({ artist, track }: { artist: string; track: string }) => {
  const { handlePlay, loading } = usePlayVideo();
  const [searching, setSearching] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSearching(true);
    try {
      const videoId = await searchYouTubeId(artist, track);
      if (videoId) await handlePlay(videoId);
    } finally {
      setSearching(false);
    }
  };

  return (
    <Tooltip label="Play on YouTube" withArrow>
      <ActionIcon
        variant="subtle"
        size="sm"
        onClick={handleClick}
        loading={searching || loading}
        style={{ flexShrink: 0 }}
      >
        <IconPlayerPlay size={14} />
      </ActionIcon>
    </Tooltip>
  );
});

const TrackRow = memo(
  ({ artist, track, subtitle, right, caaMbid, caaId }: TrackRowProps) => {
    return (
      <Group
        gap={10}
        px={4}
        py={6}
        style={{
          borderRadius: 8,
          transition: "background 0.15s",
          cursor: "default",
        }}
        justify="space-between"
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background =
            "light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        <Group gap={10} style={{ flex: 1, minWidth: 0 }}>
          <TrackThumbnail
            artist={artist}
            track={track}
            caaMbid={caaMbid}
            caaId={caaId}
          />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={500} lineClamp={1}>
              {track}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {subtitle ?? artist}
            </Text>
          </Box>
        </Group>
        <Group gap={6} style={{ flexShrink: 0 }}>
          {right}
          <PlayButton artist={artist} track={track} />
        </Group>
      </Group>
    );
  },
);

export const ListenBrainzStats = memo(() => {
  const settings = useSettings();
  const username = settings.listenBrainzUsername;
  const token = settings.listenBrainzToken;
  const enabled =
    !!username && !!token && (settings.listenBrainzEnabled ?? false);

  const [range, setRange] = useState<string>("month");

  const recentQuery = useQuery(
    ["lb-recent-listens", username],
    () => getRecentListens({ username: username!, userToken: token! }, 10),
    { enabled, staleTime: 1000 * 60 * 5 },
  );

  const topQuery = useQuery(
    ["lb-top-recordings", username, range],
    () =>
      getTopRecordings(
        { username: username!, userToken: token! },
        range as "week" | "month" | "year" | "all_time",
        10,
      ),
    { enabled, staleTime: 1000 * 60 * 15 },
  );

  if (!enabled) return null;

  const hasRecent = (recentQuery.data?.length ?? 0) > 0;
  const hasTop = (topQuery.data?.length ?? 0) > 0;

  if (!hasRecent && !hasTop) return null;

  return (
    <>
      {hasRecent && (
        <Box mb={48}>
          <Group align="baseline" mb="md" gap={12}>
            <Title order={2}>Recently Listened</Title>
            <Anchor
              href={`https://listenbrainz.org/user/${username}/`}
              target="_blank"
              size="sm"
              c="dimmed"
            >
              View all →
            </Anchor>
          </Group>
          <Stack gap={2}>
            {recentQuery.isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <Group key={i} gap={10} px={4} py={6}>
                    <Skeleton width={44} height={44} radius="sm" />
                    <Box style={{ flex: 1 }}>
                      <Skeleton height={12} mb={6} width="60%" />
                      <Skeleton height={10} width="40%" />
                    </Box>
                  </Group>
                ))
              : recentQuery.data!.map((listen: LBListen, i) => (
                  <TrackRow
                    key={i}
                    artist={listen.track_metadata.artist_name}
                    track={listen.track_metadata.track_name}
                    subtitle={
                      listen.track_metadata.artist_name +
                      (listen.track_metadata.release_name
                        ? ` · ${listen.track_metadata.release_name}`
                        : "")
                    }
                    caaMbid={
                      listen.track_metadata.mbid_mapping?.caa_release_mbid
                    }
                    caaId={listen.track_metadata.mbid_mapping?.caa_id}
                    right={
                      <Text
                        size="xs"
                        c="dimmed"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {new Date(
                          listen.listened_at * 1000,
                        ).toLocaleDateString()}
                      </Text>
                    }
                  />
                ))}
          </Stack>
        </Box>
      )}

      {hasTop && (
        <Box mb={48}>
          <Group align="baseline" mb="md" gap={12}>
            <Title order={2}>My Top Tracks</Title>
            <Select
              size="xs"
              value={range}
              onChange={(v) => setRange(v ?? "month")}
              data={[
                { value: "week", label: "This week" },
                { value: "month", label: "This month" },
                { value: "year", label: "This year" },
                { value: "all_time", label: "All time" },
              ]}
              w={120}
            />
          </Group>
          <ScrollArea>
            <Stack gap={2}>
              {topQuery.isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <Group key={i} gap={10} px={4} py={6}>
                      <Skeleton width={44} height={44} radius="sm" />
                      <Box style={{ flex: 1 }}>
                        <Skeleton height={12} mb={6} width="60%" />
                        <Skeleton height={10} width="40%" />
                      </Box>
                    </Group>
                  ))
                : topQuery.data!.map((rec: LBTopRecording, i) => (
                    <TrackRow
                      key={i}
                      artist={rec.artist_name}
                      track={rec.track_name}
                      subtitle={rec.artist_name}
                      caaMbid={rec.caa_release_mbid}
                      caaId={rec.caa_id}
                      right={
                        <Group gap={6}>
                          <Text
                            size="xs"
                            c="dimmed"
                            w={22}
                            ta="right"
                            style={{ flexShrink: 0 }}
                          >
                            {i + 1}
                          </Text>
                          <Text
                            size="xs"
                            c="dimmed"
                            style={{ whiteSpace: "nowrap" }}
                          >
                            {rec.listen_count} plays
                          </Text>
                        </Group>
                      }
                    />
                  ))}
            </Stack>
          </ScrollArea>
        </Box>
      )}
    </>
  );
});
