import { ActionIcon, Box, CloseButton, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronRight, IconInfoCircle } from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";

import { usePlayerAudio, usePlayerState, usePlayerVideo } from "../providers/Player";
import { useSetPlayerMode } from "../providers/PlayerMode";
import { useSetVideoIframeVisibility } from "../providers/VideoIframeVisibility";
import { useSettings } from "../providers/Settings";
import { DEFAULT_INVIDIOUS_URI, normalizeInstanceUri } from "../utils/invidiousInstance";
import { ModalVideoIframeInformation } from "./ModalVideoIframeInformation";
import classes from "./VideoIframe.module.css";

export const VideoIframe = memo(() => {
  const { video } = usePlayerVideo();
  const playerState = usePlayerState();
  const settings = useSettings();
  const [invidiousFailed, setInvidiousFailed] = useState(false);

  if (!video) {
    return null;
  }

  const start = Math.floor(playerState.currentTime ?? 0);
  const base = normalizeInstanceUri(
    settings?.currentInstance?.uri ?? DEFAULT_INVIDIOUS_URI,
  );

  const invidiousSrc = useMemo(() => {
    const url = new URL(`${base}/embed/${video.videoId}`);
    url.searchParams.set("autoplay", "1");
    if (start > 0) url.searchParams.set("start", String(start));
    url.searchParams.set("local", "true");
    return url.toString();
  }, [base, start, video.videoId]);

  // YouTube nocookie fallback — used when Invidious embed fails to load
  const youtubeSrc = useMemo(() => {
    const url = new URL(`https://www.youtube-nocookie.com/embed/${video.videoId}`);
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("rel", "0");
    if (start > 0) url.searchParams.set("start", String(start));
    return url.toString();
  }, [start, video.videoId]);

  const src = invidiousFailed ? youtubeSrc : invidiousSrc;

  return (
    <Box className={classes.box}>
      <ButtonHide />
      <ButtonInformation />
      <ButtonClose />
      {invidiousFailed && (
        <Box
          style={{
            position: "absolute",
            top: 4,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            background: "rgba(0,0,0,0.6)",
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: 11,
            color: "#aaa",
            pointerEvents: "none",
          }}
        >
          Invidious unavailable · YouTube fallback
        </Box>
      )}
      <iframe
        className={classes.iframe}
        src={src}
        title={video.title}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        loading="lazy"
        onError={() => {
          if (!invidiousFailed) setInvidiousFailed(true);
        }}
      />
    </Box>
  );
});

const ButtonClose = memo(() => {
  const setPlayerMode = useSetPlayerMode();
  const playerAudio = usePlayerAudio();

  const handleClick = () => {
    setPlayerMode("audio");

    // @ts-ignore
    const audio = playerAudio?.current?.audioEl.current as HTMLAudioElement;
    audio.play();
  };

  return (
    <CloseButton
      size="md"
      className={`${classes.buttonClose} ${classes.button}`}
      onClick={handleClick}
      title="Close"
    />
  );
});

const ButtonHide = memo(() => {
  const setVideoIframeVisibility = useSetVideoIframeVisibility();

  return (
    <ActionIcon
      className={`${classes.buttonHide} ${classes.button}`}
      title="Hide"
      onClick={() => setVideoIframeVisibility(false)}
    >
      <IconChevronRight />
    </ActionIcon>
  );
});

const ButtonInformation = memo(() => {
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <>
      <Tooltip label="Information" position="left">
        <ActionIcon
          className={`${classes.buttonInfo} ${classes.button}`}
          onClick={open}
        >
          <IconInfoCircle />
        </ActionIcon>
      </Tooltip>
      <ModalVideoIframeInformation opened={opened} onClose={close} />
    </>
  );
});
