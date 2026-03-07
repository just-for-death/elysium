import {
  ActionIcon,
  Box,
  Button,
  Drawer,
  Flex,
  Menu,
  Popover,
  ScrollArea,
  Space,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDocumentTitle, useMediaQuery } from "@mantine/hooks";
import {
  IconDotsVertical,
  IconMicrophone2,
  IconPlaylist,
  IconVideo,
  IconVolume,
  IconMaximize,
} from "@tabler/icons-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDevices } from "../hooks/useDevices";
import { useStableNavigate } from "../providers/Navigate";
import {
  useAudioElement,
  usePlayerStatus,
  usePlayerUrl,
  usePlayerVideo,
} from "../providers/Player";
import { usePlayerMode, useSetPlayerMode } from "../providers/PlayerMode";
import { usePlayerPlaylist } from "../providers/PlayerPlaylist";
import { useSetVideoIframeVisibility } from "../providers/VideoIframeVisibility";
import { ButtonDevicesAvailable } from "./ButtonDevicesAvailable";
import { ButtonDownload } from "./ButtonDownload";
import { ButtonFavorite } from "./ButtonFavorite";
import { ButtonAddToPlaylist } from "./ButtonAddToPlaylist";
import { ButtonPlayerModeVideo } from "./ButtonPlayerModeVideo";
import { ButtonRepeat } from "./ButtonRepeat";
import { ButtonShare } from "./ButtonShare";
import { ButtonStop } from "./ButtonStop";
import classes from "./Player.module.css";
import { PlayerActions } from "./PlayerActions";
import { PlayerBackground } from "./PlayerBackground";
import { PlayerLoadingOverlay } from "./PlayerLoadingOverlay";
import { PlayerProgress } from "./PlayerProgress";
import { SyncedLyrics } from "./SyncedLyrics";
import { VerticalSlider } from "./VerticalSlider";
import { VideoList } from "./VideoList";
import { FullscreenPlayer } from "./FullscreenPlayer";
import { useSetFullscreenPlayer } from "../providers/FullscreenPlayer";

export const Player = memo(() => {
  const showPlayerBar = useMediaQuery("(max-width: 2140px)");
  const { isMedium, isLarge, isLessThanLarge, isXlarge } = useDevices();

  return (
    <>
      <FullscreenPlayer />
      <Box
      role="dialog"
      aria-label="Player"
      className={classes.container}
      data-visible={showPlayerBar}
    >
      <Flex align="center" className={classes.content}>
        <PlayerLoadingOverlay />
        {showPlayerBar ? (
          <>
            <PlayerBackground />
            <VideoInformations />
            <Space w={isXlarge ? 60 : 30} />
            <Flex align="center" style={{ flex: 1 }}>
              <PlayerActions />
              <Space w={8} />
              <ButtonStop iconSize={20} />
              <Space w={isLessThanLarge ? 30 : 60} />
              {isMedium ? (
                <>
                  <PlayerProgress />
                  <Space w={isLarge ? 60 : 30} />
                </>
              ) : null}
              <ButtonDevicesAvailable variant="icon" />
              <Space w={20} />
              <ButtonRepeat iconSize={20} />
              <Space w={20} />
              <ButtonDownload iconSize={20} />
              <Space w={20} />
              <ButtonShare iconSize={20} />
              {isLarge ? (
                <>
                  <Space w={20} />
                  <ButtonFavorite iconSize={20} variant="transparent" />
                  <Space w={20} />
                  <ButtonAddToPlaylist />
                </>
              ) : null}
              <Space w={20} />
              <ButtonVolume />
              <Space w={20} />
              <ButtonLyrics />
              <Space w={20} />
              <ButtonVideoMode />
              <Space w={20} />
              <PlayerPlaylist />
              {isLessThanLarge ? (
                <>
                  <Space w={20} />
                  <MoreSubMenu />
                </>
              ) : null}
              <Space w={12} />
              <ButtonFullscreen />
            </Flex>
          </>
        ) : null}
      </Flex>
    </Box>
    </>
  );
});

const VideoInformations = memo(() => {
  const { video, thumbnailUrl } = usePlayerVideo();
  const navigate = useStableNavigate();
  const setFullscreen = useSetFullscreenPlayer();

  useDocumentTitle(video?.title as string);

  if (!video) return null;

  return (
    <Flex
      align="center"
      className={classes.videoInformationsContainer}
      gap="lg"
    >
      <Box
        style={{
          position: "relative",
          flexShrink: 0,
        }}
        className={classes.thumbnailWrapper}
        onClick={() => setFullscreen(true)}
        title="Open full player"
      >
        <Box
          style={{
            background: `url(${thumbnailUrl}) center center / cover grey`,
            cursor: "pointer",
          }}
          className={classes.thumbnail}
        />
        <Box className={classes.thumbnailOverlay}>
          <IconMaximize size={16} color="white" />
        </Box>
      </Box>
      <Box maw="100%" pr="lg" onClick={() => setFullscreen(true)} style={{ cursor: "pointer" }}>
        <Text c="white" lineClamp={1} title={video.title}>
          {video.title}
        </Text>
        <Text c="white" size="sm" lineClamp={1}>
          {video.description}
        </Text>
        <Button
          variant="subtle"
          c="white"
          size="xs"
          p={0}
          onClick={() => navigate(`/channels/${video.authorId}`)}
        >
          {video.author}
        </Button>
      </Box>
    </Flex>
  );
});

export const ButtonVolume = memo(() => {
  const playerState = usePlayerStatus();
  const getAudioEl = useAudioElement();

  const handleChangeEnd = (volume: number) => {
    const audio = getAudioEl();
    if (!audio) return;
    audio.volume = volume / 100;
  };

  return (
    <Popover shadow="md">
      <Popover.Target>
        <ActionIcon color="transparent">
          <IconVolume size={20} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <VerticalSlider
          value={playerState.volume * 100}
          onChangeEnd={handleChangeEnd}
        />
      </Popover.Dropdown>
    </Popover>
  );
});

const PlayerPlaylist = memo(() => {
  const [opened, setOpened] = useState(false);
  const videosPlaylist = usePlayerPlaylist();
  const { t } = useTranslation();

  return (
    <>
      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        title={t("player.next.song")}
        styles={{ body: { padding: "var(--mantine-spacing-xl)" } }}
        position="right"
        size="xl"
      >
        <ScrollArea style={{ height: "calc(100vh - 80px)" }}>
          <VideoList videos={videosPlaylist} />
        </ScrollArea>
      </Drawer>
      <ActionIcon color="transparent" onClick={() => setOpened(true)}>
        <IconPlaylist size={20} />
      </ActionIcon>
    </>
  );
});

export const PlayerSpace = memo(() => {
  const playerUrl = usePlayerUrl();

  return <Box className={classes.spacer} data-visible={Boolean(playerUrl)} />;
});

const MoreSubMenu = memo(() => {
  return (
    <Menu shadow="md" width={200} position="top">
      <Menu.Target>
        <ActionIcon variant="transparent" c="white">
          <IconDotsVertical />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <ButtonPlayerModeVideo render="menu" />
        <ButtonFavorite render="menu" />
        <ButtonAddToPlaylist />
      </Menu.Dropdown>
    </Menu>
  );
});

export const ButtonLyrics = memo(() => {
  const [opened, setOpened] = useState(false);
  const setFullscreen = useSetFullscreenPlayer();

  const handleLyricsClick = () => {
    // On mobile / small screens open popover; always available as popover
    setOpened((o) => !o);
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      shadow="md"
      position="top"
      width={400}
      offset={16}
    >
      <Popover.Target>
        <Tooltip label="Lyrics" withArrow>
          <ActionIcon
            color="transparent"
            onClick={handleLyricsClick}
            variant={opened ? "filled" : undefined}
          >
            <IconMicrophone2 size={20} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p={0} style={{ borderRadius: 12, overflow: "hidden" }}>
        <SyncedLyrics />
      </Popover.Dropdown>
    </Popover>
  );
});

export const ButtonVideoMode = memo(() => {
  const setPlayerMode = useSetPlayerMode();
  const playerMode = usePlayerMode();
  const getAudioEl = useAudioElement();
  const setVideoIframeVisibility = useSetVideoIframeVisibility();

  const handleClick = () => {
    if (playerMode === "video") {
      setPlayerMode("audio");
      setVideoIframeVisibility(false);
    } else {
      setPlayerMode("video");
      setVideoIframeVisibility(true);
      // pause the audio element so video takes over
      const audio = getAudioEl() ?? undefined;
      audio?.pause();
    }
  };

  return (
    <Tooltip label={playerMode === "video" ? "Switch to Audio" : "Switch to Video"} withArrow>
      <ActionIcon
        color="transparent"
        onClick={handleClick}
        variant={playerMode === "video" ? "filled" : undefined}
      >
        <IconVideo size={20} />
      </ActionIcon>
    </Tooltip>
  );
});

export const ButtonFullscreen = memo(() => {
  const setFullscreen = useSetFullscreenPlayer();
  const { video } = usePlayerVideo();

  if (!video) return null;

  return (
    <Tooltip label="Full Player" withArrow>
      <ActionIcon
        size="lg"
        radius="md"
        onClick={() => setFullscreen(true)}
        aria-label="Open full player"
        style={{
          background: "rgba(42,181,165,0.18)",
          color: "#2ab5a5",
          border: "1px solid rgba(42,181,165,0.3)",
        }}
      >
        <IconMaximize size={20} />
      </ActionIcon>
    </Tooltip>
  );
});
