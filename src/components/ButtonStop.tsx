import { ActionIcon, Tooltip } from "@mantine/core";
import { IconPlayerStop } from "@tabler/icons-react";
import { memo } from "react";

import { useAudioElement, useSetPlayerProgress, useSetPlayerStatus, useSetPlayerUrl, useSetPlayerVideo, initialPlayerStatus, initialPlayerProgress } from "../providers/Player";
import { useSetPlayerPlaylist, useSetPinnedVideoIds } from "../providers/PlayerPlaylist";
import { useSetPreviousNextVideos } from "../providers/PreviousNextTrack";
import { useSetVideoIframeVisibility } from "../providers/VideoIframeVisibility";
import { useSetPlayerMode } from "../providers/PlayerMode";

interface ButtonStopProps {
  iconSize?: number;
}

export const ButtonStop = memo(({ iconSize = 20 }: ButtonStopProps) => {
  const getAudioEl         = useAudioElement();
  const setPlayerUrl       = useSetPlayerUrl();
  const setPlayerVideo     = useSetPlayerVideo();
  const setPlayerStatus    = useSetPlayerStatus();
  const setPlayerProgress  = useSetPlayerProgress();
  const setPlaylist        = useSetPlayerPlaylist();
  const { clearAll }       = useSetPinnedVideoIds();
  const setPrevNext        = useSetPreviousNextVideos();
  const setVideoIframe     = useSetVideoIframeVisibility();
  const setPlayerMode      = useSetPlayerMode();

  const handleStop = () => {
    // 1. Pause & detach audio immediately
    const audio = getAudioEl();
    if (audio) {
      audio.pause();
      audio.src = "";
      audio.load();
    }

    // 2. Tear down video iframe
    setVideoIframe(false);
    setPlayerMode("audio");

    // 3. Reset all player state
    setPlayerUrl(null);
    setPlayerVideo({ video: null, sponsorBlockSegments: null, thumbnailUrl: null, primaryColor: null });
    setPlayerStatus(initialPlayerStatus);
    setPlayerProgress(initialPlayerProgress);

    // 4. Clear queue + pins
    setPlaylist([]);
    clearAll();
    setPrevNext({ videosIds: { previousVideoId: null, nextVideoId: null } });
  };

  return (
    <Tooltip label="Stop" withArrow>
      <ActionIcon
        color="transparent"
        variant="subtle"
        onClick={handleStop}
        aria-label="Stop playback"
      >
        <IconPlayerStop size={iconSize} />
      </ActionIcon>
    </Tooltip>
  );
});
