import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Slider,
  Text,
} from "@mantine/core";
import {
  IconMaximize,
  IconVideo,
} from "@tabler/icons-react";
import { memo } from "react";

import {
  useAudioElement,
  usePlayerProgress,
  usePlayerStatus,
  usePlayerVideo,
} from "../providers/Player";
import { usePlayerMode, useSetPlayerMode } from "../providers/PlayerMode";
import { useSetVideoIframeVisibility } from "../providers/VideoIframeVisibility";
import { useSetFullscreenPlayer } from "../providers/FullscreenPlayer";
import classes from "./MobilePlayer.module.css";
import { PlayerActions } from "./PlayerActions";
import { PlayerBackground } from "./PlayerBackground";
import { ButtonStop } from "./ButtonStop";
import { VideoIframe } from "./VideoIframe";

export const MobilePlayer = memo(() => {
  const setFullscreen = useSetFullscreenPlayer();
  const { video, thumbnailUrl } = usePlayerVideo();

  const openFullscreen = () => setFullscreen(true);

  return (
    <Box className={classes.container} onClick={openFullscreen}>
      <PlayerBackground />
      {/* Progress bar at top */}
      <PlayerProgress />
      {/* Main row */}
      <Flex className={classes.content}>
        {/* Thumbnail */}
        <Box
          className={classes.thumb}
          style={{
            background: thumbnailUrl
              ? `url(${thumbnailUrl}) center/cover no-repeat`
              : "rgba(255,255,255,0.08)",
          }}
        />
        {/* Track title + artist */}
        <Box className={classes.trackInfo}>
          <Text size="sm" lineClamp={1} c="white" fw={600} lh={1.3}>
            {video?.title ?? ""}
          </Text>
          <Text size="xs" c="rgba(255,255,255,0.45)" lineClamp={1} lh={1.3}>
            {video?.author ?? ""}
          </Text>
        </Box>
        {/* Controls: prev + play/pause + next + fullscreen */}
        <Flex
          className={classes.controls}
          onClick={(e) => e.stopPropagation()}
        >
          <PlayerActions showTrackNext showTrackPrevious />
          <ButtonStop iconSize={16} />
          {/* Fullscreen — big teal button */}
          <ActionIcon
            className={classes.fsBtn}
            size="lg"
            onClick={(e) => {
              e.stopPropagation();
              openFullscreen();
            }}
            aria-label="Open full player"
          >
            <IconMaximize size={20} />
          </ActionIcon>
        </Flex>
      </Flex>
    </Box>
  );
});

const PlayerProgress = memo(() => {
  const playerStatus = usePlayerStatus();
  const playerProgress = usePlayerProgress();
  const getAudioEl = useAudioElement();

  const handleChangeEnd = (percentage: number) => {
    const audio = getAudioEl();
    if (!audio) return;
    const duration = playerStatus.audioDuration
      ?? (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    if (!duration) return;
    audio.currentTime = (percentage * duration) / 100;
  };

  return (
    <Slider
      className={classes.progress}
      label={null}
      value={playerProgress.percentage ?? 0}
      onChangeEnd={handleChangeEnd}
      size={3}
      radius={0}
      styles={{
        bar: { background: "#2ab5a5" },
        track: { background: "rgba(255,255,255,0.12)", cursor: "pointer" },
        thumb: { display: "none" },
      }}
    />
  );
});

export const MobileVideoPanel = memo(() => {
  const { video } = usePlayerVideo();
  const playerMode = usePlayerMode();
  const setPlayerMode = useSetPlayerMode();
  const setVideoIframeVisibility = useSetVideoIframeVisibility();

  if (!video) {
    return (
      <Flex align="center" justify="center" style={{ height: 160 }}>
        <Text c="dimmed" size="sm">No track playing</Text>
      </Flex>
    );
  }

  if (playerMode !== "video") {
    return (
      <Flex align="center" justify="center" direction="column" gap="md" py="xl">
        <IconVideo size={36} opacity={0.4} />
        <Text c="dimmed" size="sm" ta="center">Switch to video mode</Text>
        <Button
          size="sm"
          variant="light"
          leftSection={<IconVideo size={16} />}
          onClick={() => {
            setPlayerMode("video");
            setVideoIframeVisibility(true);
          }}
        >
          Watch Video
        </Button>
      </Flex>
    );
  }

  return (
    <Box style={{
      borderRadius: 8,
      overflow: "hidden",
      aspectRatio: "16/9",
      position: "relative",
      width: "100%",
    }}>
      <VideoIframe />
    </Box>
  );
});
