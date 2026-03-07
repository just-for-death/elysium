import { type FC, memo } from "react";
import { Badge, Box, Flex, Text } from "@mantine/core";

import { useQueueVideo } from "../hooks/useQueueVideo";
import { usePlayerVideo } from "../providers/Player";
import { usePinnedVideoIds } from "../providers/PlayerPlaylist";
import type { Video as VideoType } from "../types/interfaces/Video";
import { Video } from "./Video";

interface VideoListProps {
  videos: VideoType[];
}

export const VideoList: FC<VideoListProps> = memo(({ videos }) => {
  const { removeFromQueue } = useQueueVideo();
  const { video: currentVideo } = usePlayerVideo();
  const pinnedIds = usePinnedVideoIds();

  if (!videos) return null;

  // Split into: playing now, pinned ahead, auto-suggested ahead, already played
  const currentIdx = videos.findIndex((v) => v.videoId === currentVideo?.videoId);

  const ahead = currentIdx >= 0 ? videos.slice(currentIdx + 1) : videos;
  const behind = currentIdx > 0 ? videos.slice(0, currentIdx) : [];

  const pinnedAhead = ahead.filter((v) => pinnedIds.has(v.videoId));
  const autoAhead = ahead.filter((v) => !pinnedIds.has(v.videoId));

  return (
    <Box>
      {/* Currently playing */}
      {currentIdx >= 0 && (
        <>
          <SectionLabel label="Now Playing" />
          <Video key={`vl-${videos[currentIdx].videoId}`} video={videos[currentIdx]} />
        </>
      )}

      {/* Manually pinned — "Up Next" */}
      {pinnedAhead.length > 0 && (
        <>
          <SectionLabel
            label="Up Next"
            badge={
              <Badge size="xs" color="violet" variant="light">
                {pinnedAhead.length} pinned
              </Badge>
            }
          />
          {pinnedAhead.map((v) => (
            <Video
              key={`vl-${v.videoId}`}
              video={v}
              onRemove={removeFromQueue}
            />
          ))}
        </>
      )}

      {/* Auto-queue suggestions */}
      {autoAhead.length > 0 && (
        <>
          <SectionLabel label="Recommended" />
          {autoAhead.map((v) => (
            <Video
              key={`vl-${v.videoId}`}
              video={v}
              onRemove={removeFromQueue}
            />
          ))}
        </>
      )}

      {/* Already played */}
      {behind.length > 0 && (
        <>
          <SectionLabel label="History" dimmed />
          {behind.map((v) => (
            <Video key={`vl-${v.videoId}`} video={v} />
          ))}
        </>
      )}
    </Box>
  );
});

const SectionLabel: FC<{
  label: string;
  badge?: React.ReactNode;
  dimmed?: boolean;
}> = memo(({ label, badge, dimmed }) => (
  <Flex
    align="center"
    gap={6}
    px="sm"
    pt={10}
    pb={4}
    style={{ userSelect: "none" }}
  >
    <Text
      size="xs"
      fw={700}
      c={dimmed ? "dimmed" : "dimmed"}
      style={{ textTransform: "uppercase", letterSpacing: "0.07em", opacity: dimmed ? 0.5 : 0.8 }}
    >
      {label}
    </Text>
    {badge}
  </Flex>
));

