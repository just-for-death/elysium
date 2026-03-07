import { useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { memo } from "react";

import { FullscreenPlayer } from "../components/FullscreenPlayer";
import { MobilePlayer } from "../components/MobilePlayer";
import { Player } from "../components/Player";
import { PlayerAudio } from "../components/PlayerAudio";
import { usePlayerUrl } from "../providers/Player";
import { usePlayerMode } from "../providers/PlayerMode";
import { useSettings } from "../providers/Settings";
import { VideoPlayerContainer } from "./VideoPlayer";

export const PlayerContainer = memo(() => {
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.md})`, true, {
    getInitialValueInEffect: false,
  });
  const playerUrl = usePlayerUrl();
  const playerMode = usePlayerMode();
  const settings = useSettings();

  if (!playerUrl) return null;

  return (
    <>
      <PlayerAudio />
      {/* FullscreenPlayer must always be mounted — on mobile it is NOT inside
          <Player />, so without this the overlay never renders and setFullscreen
          does nothing on Android / mobile browsers. */}
      {isMobile && <FullscreenPlayer />}
      {settings.videoMode && playerMode === "video" ? (
        <VideoPlayerContainer />
      ) : null}
      {isMobile ? <MobilePlayer /> : <Player />}
    </>
  );
});
