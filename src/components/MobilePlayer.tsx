import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Drawer,
  Flex,
  ScrollArea,
  Slider,
  Space,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import {
  IconChevronUp,
  IconListNumbers,
  IconMicrophone2,
  IconVideo,
} from "@tabler/icons-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { usePlayerAudio, usePlayerState, usePlayerVideo } from "../providers/Player";
import { usePlayerMode, useSetPlayerMode } from "../providers/PlayerMode";
import { usePlayerPlaylist } from "../providers/PlayerPlaylist";
import { useSetVideoIframeVisibility } from "../providers/VideoIframeVisibility";
import { DrawerPlayerVideo } from "./DrawerPlayer";
import classes from "./MobilePlayer.module.css";
import { PlayerActions } from "./PlayerActions";
import { PlayerBackground } from "./PlayerBackground";
import { SyncedLyrics } from "./SyncedLyrics";
import { VideoIframe } from "./VideoIframe";
import { VideoList } from "./VideoList";

export const MobilePlayer = memo(() => {
  return (
    <Box className={classes.container}>
      <PlayerBackground />
      <PlayerProgress />
      <Flex className={classes.content}>
        <ButtonOpenDrawer />
        <VideoInformations />
        <PlayerActions showTrackNext={false} showTrackPrevious={false} />
      </Flex>
    </Box>
  );
});

const ButtonOpenDrawer = memo(() => {
  const [isOpen, setOpen] = useState(false);
  const videos = usePlayerPlaylist();
  const { t } = useTranslation();
  const { height } = useViewportSize();
  const [activeTab, setActiveTab] = useState<string>("queue");

  return (
    <>
      <ActionIcon
        color="transparent"
        onClick={() => setOpen((state) => !state)}
      >
        <IconChevronUp size={18} />
      </ActionIcon>
      <Drawer
        opened={isOpen}
        onClose={() => setOpen((state) => !state)}
        title={t("player.title")}
        padding="xl"
        size="full"
        position="bottom"
      >
        <ScrollArea style={{ height, maxWidth: "100%" }}>
          <DrawerPlayerVideo />
          <Space h="xl" />
          <Divider />
          <Space h="xs" />

          <Tabs value={activeTab} onChange={(v) => setActiveTab(v ?? "queue")}>
            <Tabs.List>
              <Tabs.Tab value="queue" leftSection={<IconListNumbers size={14} />}>
                {t("player.queue")}
              </Tabs.Tab>
              <Tabs.Tab value="lyrics" leftSection={<IconMicrophone2 size={14} />}>
                Lyrics
              </Tabs.Tab>
              <Tabs.Tab value="video" leftSection={<IconVideo size={14} />}>
                Video
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="queue" pt="md">
              <VideoList videos={videos} />
            </Tabs.Panel>

            <Tabs.Panel value="lyrics" pt="md">
              <SyncedLyrics />
            </Tabs.Panel>

            <Tabs.Panel value="video" pt="md">
              <MobileVideoPanel />
            </Tabs.Panel>
          </Tabs>
        </ScrollArea>
      </Drawer>
    </>
  );
});

const MobileVideoPanel = memo(() => {
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
    <Box
      style={{
        borderRadius: 8,
        overflow: "hidden",
        aspectRatio: "16/9",
        position: "relative",
        width: "100%",
      }}
    >
      <VideoIframe />
    </Box>
  );
});

const VideoInformations = memo(() => {
  const { video } = usePlayerVideo();

  if (!video) {
    return null;
  }

  return (
    <Box>
      <Text size="sm" lineClamp={1}>
        {video.title}
      </Text>
    </Box>
  );
});

const PlayerProgress = memo(() => {
  const playerState = usePlayerState();
  const playerAudio = usePlayerAudio();

  const handleChangeEnd = (percentage: number) => {
    // @ts-ignore
    const audio = playerAudio?.current?.audioEl.current as HTMLAudioElement;
    if (isFinite(audio.duration)) {
      audio.currentTime = (percentage * audio.duration) / 100;
    }
  };

  return (
    <Slider
      label={null}
      value={playerState.percentage as number}
      onChangeEnd={handleChangeEnd}
      mt="0"
      mb="0"
      size="xs"
      radius={0}
    />
  );
});

