import { ActionIcon, type ActionIconProps, Flex } from "@mantine/core";
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
} from "@tabler/icons-react";
import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";

import { usePlayVideo } from "../hooks/usePlayVideo";
import { useAudioElement, usePlayerStatus } from "../providers/Player";
import { usePlayerMode } from "../providers/PlayerMode";
import { usePlayerPlaylist } from "../providers/PlayerPlaylist";
import { usePreviousNextVideos } from "../providers/PreviousNextTrack";

interface PlayerActionsProps {
  showTrackPrevious?: boolean;
  showTrackNext?: boolean;
}

export const PlayerActions: FC<PlayerActionsProps> = memo(
  ({ showTrackPrevious = true, showTrackNext = true }) => {
    const playerMode = usePlayerMode();
    const iconPlayPauseOnly = !showTrackPrevious && !showTrackNext;
    const iconPlayPauseOnlyProps: ActionIconProps = {
      size: iconPlayPauseOnly ? "lg" : "xl",
      radius: iconPlayPauseOnly ? "md" : "lg",
    };

    return (
      <Flex
        align="center"
        gap="lg"
        style={{ pointerEvents: playerMode === "video" ? "none" : "all" }}
      >
        {showTrackPrevious ? <ButtonPreviousVideo /> : null}
        <ButtonPlayPause
          {...iconPlayPauseOnlyProps}
          iconSize={iconPlayPauseOnly ? 16 : undefined}
        />
        {showTrackNext ? <ButtonNextVideo /> : null}
      </Flex>
    );
  },
);

interface ButtonNextVideoProps extends ActionIconProps {
  iconSize?: number;
}

const ButtonPlayPause: FC<ButtonNextVideoProps> = memo(
  ({ size, radius, iconSize }) => {
    const playerState = usePlayerStatus();
    const getAudioEl = useAudioElement();

    const handlePlayPause = () => {
      const audio = getAudioEl();

      // Fix #2: Guard against null audio element (e.g. before a track has loaded)
      if (!audio) return;

      if (audio.paused) {
        audio.play();
      } else {
        audio.pause();
      }
    };

    return (
      <ActionIcon
        variant="filled"
        size={size}
        radius={radius}
        title={playerState.paused ? "Play" : "Pause"}
        onClick={handlePlayPause}
      >
        {playerState.paused ? (
          <IconPlayerPlay size={iconSize} />
        ) : (
          <IconPlayerPause size={iconSize} />
        )}
      </ActionIcon>
    );
  },
);

const ButtonPreviousVideo = memo(() => {
  const { handlePlay, loading } = usePlayVideo();
  const { videosIds } = usePreviousNextVideos();
  const playlist = usePlayerPlaylist();
  const { t } = useTranslation();

  const handlePlayPreviousVideo = () => {
    handlePlay(videosIds.previousVideoId as string, playlist.length ? playlist : null);
  };

  return (
    <ActionIcon
      size="lg"
      radius="md"
      title={t("player.previous.video")}
      disabled={!videosIds.previousVideoId}
      onClick={handlePlayPreviousVideo}
      loading={loading}
      data-action="prev"
    >
      <IconPlayerTrackPrev size={16} />
    </ActionIcon>
  );
});

const ButtonNextVideo = memo(() => {
  const { handlePlay, loading } = usePlayVideo();
  const { videosIds } = usePreviousNextVideos();
  const playlist = usePlayerPlaylist();
  const { t } = useTranslation();

  const handlePlayNextVideo = () => {
    handlePlay(videosIds.nextVideoId as string, playlist.length ? playlist : null);
  };

  return (
    <ActionIcon
      size="lg"
      radius="md"
      title={t("player.next.video")}
      disabled={!videosIds.nextVideoId}
      onClick={handlePlayNextVideo}
      loading={loading}
      data-action="next"
    >
      <IconPlayerTrackNext size={16} />
    </ActionIcon>
  );
});
