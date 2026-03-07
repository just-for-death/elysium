import { ActionIcon, Box, CloseButton, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronRight, IconInfoCircle } from "@tabler/icons-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { useAudioElement, usePlayerProgress, usePlayerVideo } from "../providers/Player";
import { useSetPlayerMode } from "../providers/PlayerMode";
import { useSetVideoIframeVisibility } from "../providers/VideoIframeVisibility";
import { useSettings } from "../providers/Settings";
import { DEFAULT_INVIDIOUS_URI, normalizeInstanceUri } from "../utils/invidiousInstance";
import { ModalVideoIframeInformation } from "./ModalVideoIframeInformation";
import classes from "./VideoIframe.module.css";

// Timeout (ms) after which we assume the Invidious embed failed to load
const INVIDIOUS_LOAD_TIMEOUT_MS = 8000;

export const VideoIframe = memo(() => {
  const { video } = usePlayerVideo();
  const playerState = usePlayerProgress();
  const settings = useSettings();

  // Fix #1: All hooks must be called unconditionally — moved above the early return
  const [invidiousFailed, setInvidiousFailed] = useState(false);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = Math.floor(playerState.currentTime ?? 0);
  const base = normalizeInstanceUri(
    settings?.currentInstance?.uri ?? DEFAULT_INVIDIOUS_URI,
  );

  // Fix #1: useMemo calls moved above early return to satisfy Rules of Hooks
  const invidiousSrc = useMemo(() => {
    if (!video) return "";
    const url = new URL(`${base}/embed/${video.videoId}`);
    url.searchParams.set("autoplay", "1");
    if (start > 0) url.searchParams.set("start", String(start));
    url.searchParams.set("local", "true");
    return url.toString();
  }, [base, start, video?.videoId]);

  // YouTube nocookie fallback — used when Invidious embed fails to load
  const youtubeSrc = useMemo(() => {
    if (!video) return "";
    const url = new URL(`https://www.youtube-nocookie.com/embed/${video.videoId}`);
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("rel", "0");
    if (start > 0) url.searchParams.set("start", String(start));
    return url.toString();
  }, [start, video?.videoId]);

  // Fix #5: iframe onError doesn't fire for cross-origin load failures.
  // Instead, start a timeout when the Invidious src changes. If the iframe
  // fires its onLoad within the window, clear the timer (success). If the
  // timer fires first, we assume Invidious failed and switch to the YT fallback.
  useEffect(() => {
    if (!video || invidiousFailed) return;

    loadTimerRef.current = setTimeout(() => {
      setInvidiousFailed(true);
    }, INVIDIOUS_LOAD_TIMEOUT_MS);

    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, [invidiousSrc]); // re-run whenever the Invidious URL changes (new video)

  // Reset fallback state when the video changes
  useEffect(() => {
    setInvidiousFailed(false);
  }, [video?.videoId]);

  const handleIframeLoad = () => {
    if (loadTimerRef.current) {
      clearTimeout(loadTimerRef.current);
      loadTimerRef.current = null;
    }
  };

  if (!video) {
    return null;
  }

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
        onLoad={handleIframeLoad}
      />
    </Box>
  );
});

const ButtonClose = memo(() => {
  const setPlayerMode = useSetPlayerMode();
  const getAudioEl = useAudioElement();

  const handleClick = () => {
    setPlayerMode("audio");

    const audio = getAudioEl();
    if (!audio) return;
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
