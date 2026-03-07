import {
  ActionIcon,
  Box,
  Flex,
  LoadingOverlay,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlaylistAdd,
  IconTrash,
} from "@tabler/icons-react";
import { type FC, memo, useState } from "react";

import { usePlayVideo } from "../hooks/usePlayVideo";
import { useQueueVideo } from "../hooks/useQueueVideo";
import { useAudioElement, usePlayerStatus, usePlayerVideo } from "../providers/Player";
import { usePinnedVideoIds } from "../providers/PlayerPlaylist";
import { useSettings } from "../providers/Settings";
import type { Video as VideoType } from "../types/interfaces/Video";
import type { CardVideo } from "../types/interfaces/Card";
import { getThumbnailQuality } from "../utils/formatData";
import { sanitizeThumbnailUrl } from "../utils/cleanVideoThumbnailsUrl";
import { Image } from "./Image";
import classes from "./Video.module.css";

const hexToRgba = (hex: string | null | undefined, alpha: string): string | undefined => {
  if (!hex || !hex.startsWith("#") || hex.length < 7) return undefined;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return undefined;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Fastest possible thumbnail for a Video in the queue list.
 * Priority:
 *  1. Direct ytimg.com mqdefault URL built from videoId — no domain needed,
 *     loads instantly from YouTube CDN cache (not proxied through Invidious).
 *  2. Stored thumbnail/videoThumbnails from the Video object.
 *  3. sanitizeThumbnailUrl as final safety net.
 */
const getFastThumbnailUrl = (video: VideoType, instanceDomain: string): string => {
  // ytimg.com serves thumbnails directly without any Invidious round-trip.
  // mqdefault (320×180) is always available for non-live videos.
  if (video.videoId && !video.videoId.startsWith("apple_")) {
    return `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`;
  }
  // Apple Music virtual IDs fall back to stored thumbnail
  const stored = video.thumbnail ?? getThumbnailQuality(video.videoThumbnails, "default");
  return sanitizeThumbnailUrl(stored, instanceDomain, video.videoId);
};

interface VideoProps {
  video: VideoType;
  withThumbnail?: boolean;
  onRemove?: (videoId: string) => void;
}

export const Video: FC<VideoProps> = memo(({ video, withThumbnail = true, onRemove }) => {
  const { video: playedVideo, primaryColor } = usePlayerVideo();
  const { handlePlay, loading } = usePlayVideo();
  const { addNext, addLast } = useQueueVideo();
  const getAudioEl = useAudioElement();
  const playerState = usePlayerStatus();
  const { currentInstance } = useSettings();
  const pinnedIds = usePinnedVideoIds();

  const [actionsVisible, setActionsVisible] = useState(false);

  const instanceDomain = currentInstance?.uri ?? "";
  const imageSrc = getFastThumbnailUrl(video, instanceDomain);
  const isPlaying = playedVideo?.videoId === video.videoId;
  // FIX: track whether the now-playing track is currently paused so we can
  // show the correct icon and allow resume directly from the queue row.
  const isPaused = isPlaying && playerState.paused;
  const isPinned = pinnedIds.has(video.videoId);

  // FIX: toggle play/pause for the now-playing row; play fresh for others.
  const handleClick = () => {
    const audio = getAudioEl();
    if (isPlaying) {
      if (!audio) return;
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    } else {
      handlePlay(video.videoId);
    }
  };

  // Convert Video → CardVideo for queue actions
  const asCard: CardVideo = {
    videoId: video.videoId,
    title: video.title,
    type: video.type as CardVideo["type"],
    thumbnail: imageSrc,
    videoThumbnails: video.videoThumbnails,
    liveNow: video.liveNow,
    lengthSeconds: video.lengthSeconds,
  };

  // FIX: only show the loading overlay on the specific row that is loading,
  // not on every row (loading from usePlayVideo is global).
  const isThisRowLoading = loading && isPlaying;

  return (
    <Box
      style={{ width: "100%", maxWidth: "100%", position: "relative" }}
      onMouseEnter={() => setActionsVisible(true)}
      onMouseLeave={() => setActionsVisible(false)}
    >
      <UnstyledButton onClick={handleClick} style={{ width: "100%" }}>
        <Flex
          align="center"
          gap="md"
          p="sm"
          className={classes.container}
          style={{
            background: isPlaying
              ? hexToRgba(primaryColor?.color, "0.6")
              : undefined,
          }}
        >
          <LoadingOverlay visible={isThisRowLoading} />
          <Flex align="center" style={{ flex: 1 }} gap="md">
            {withThumbnail ? (
              <Box className={classes.image}>
                <VideoThumbnail
                  src={imageSrc}
                  title={video.title}
                />
              </Box>
            ) : null}
            <Box maw="calc(100vw - 180px)" style={{ overflow: "hidden" }}>
              <Text size="sm" lineClamp={1}>
                {isPlaying ? <strong>{video.title}</strong> : video.title}
              </Text>
              {video.author ? (
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {video.author}
                </Text>
              ) : null}
            </Box>
          </Flex>

          {/* Inline queue actions — visible on hover or always when playing/touch */}
          <Flex
            gap={4}
            align="center"
            style={{
              flexShrink: 0,
              opacity: actionsVisible || isPlaying ? 1 : 0,
              transition: "opacity 0.15s",
              // FIX: keep pointer events active when isPlaying so the
              // pause/resume button is always tappable on touch devices,
              // even without a hover event.
              pointerEvents: actionsVisible || isPlaying ? "auto" : "none",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {!isPlaying && (
              <>
                <Tooltip label="Play next" position="top" withArrow>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={() => addNext(asCard)}
                  >
                    <IconPlayerSkipForward size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Add to queue" position="top" withArrow>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={() => addLast(asCard)}
                  >
                    <IconPlaylistAdd size={14} />
                  </ActionIcon>
                </Tooltip>
                {onRemove && (
                  <Tooltip label="Remove from queue" position="top" withArrow>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      color="red"
                      onClick={() => onRemove(video.videoId)}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </>
            )}
            {/* FIX: show play/pause for the now-playing row; play for others */}
            <Tooltip
              label={isPlaying ? (isPaused ? "Resume" : "Pause") : "Play"}
              position="top"
              withArrow
            >
              <ActionIcon
                variant="filled"
                color="teal"
                radius="md"
                size="lg"
                onClick={(e) => { e.stopPropagation(); handleClick(); }}
              >
                {isPlaying && !isPaused
                  ? <IconPlayerPause size={16} />
                  : <IconPlayerPlay size={16} />
                }
              </ActionIcon>
            </Tooltip>
          </Flex>
        </Flex>
      </UnstyledButton>

      {/* Pinned indicator */}
      {isPinned && !isPlaying && (
        <Box
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--mantine-color-violet-5)",
            pointerEvents: "none",
          }}
        />
      )}
    </Box>
  );
});

interface VideoThumbnailProps {
  src: string;
  title: string;
}

const VideoThumbnail: FC<VideoThumbnailProps> = memo(({ src, title }) => (
  <Box className={classes.image}>
    <Image src={src} title={title} className={classes.image} />
  </Box>
));
