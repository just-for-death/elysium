import {
  Box,
  Button,
  Card,
  Divider,
  Flex,
  ScrollArea,
  Space,
  Tabs,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDocumentTitle } from "@mantine/hooks";
import {
  IconListNumbers,
  IconMicrophone2,
  IconVideo,
} from "@tabler/icons-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useStableNavigate } from "../providers/Navigate";
import { usePlayerUrl, usePlayerVideo } from "../providers/Player";
import { usePlayerMode, useSetPlayerMode } from "../providers/PlayerMode";
import { usePlayerPlaylist } from "../providers/PlayerPlaylist";
import { useSetVideoIframeVisibility } from "../providers/VideoIframeVisibility";
import type { CardVideo } from "../types/interfaces/Card";
import type { Video } from "../types/interfaces/Video";
import { ButtonDevicesAvailable } from "./ButtonDevicesAvailable";
import { ButtonDownload } from "./ButtonDownload";
import { ButtonFavorite } from "./ButtonFavorite";
import { ButtonPlayerModeVideo } from "./ButtonPlayerModeVideo";
import { ButtonRepeat } from "./ButtonRepeat";
import { ButtonShare } from "./ButtonShare";
import classes from "./DrawerPlayer.module.css";
import { ButtonVolume } from "./Player";
import { PlayerActions } from "./PlayerActions";
import { PlayerBackground } from "./PlayerBackground";
import { PlayerLoadingOverlay } from "./PlayerLoadingOverlay";
import { PlayerProgress } from "./PlayerProgress";
import { SyncedLyrics } from "./SyncedLyrics";
import { VideoIframe } from "./VideoIframe";
import { VideoList } from "./VideoList";

export const DrawerPlayer = memo(() => {
  const playerUrl = usePlayerUrl();
  const playerPlaylist = usePlayerPlaylist();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>("queue");

  const cardStyles = {
    width: playerUrl ? 500 : 0,
    opacity: playerUrl ? 1 : 0,
    boxShadow: "0 -10px 10px rgb(0 0 0 / 20%)",
  };

  return (
    <Card className={classes.card} style={cardStyles} radius={0} p={0}>
      <PlayerBackground />
      <Box>
        <Box p="xl" pos="relative">
          <Title order={3}>{t("drawer.player.title")}</Title>
          <Space h={36} />
          <DrawerPlayerVideo />
          <PlayerLoadingOverlay />
          <Space h="md" />
        </Box>
        <Divider />

        {/* Tab navigation */}
        <Tabs
          value={activeTab}
          onChange={(v) => setActiveTab(v ?? "queue")}
          px="sm"
          pt="xs"
        >
          <Tabs.List>
            <Tabs.Tab value="queue" leftSection={<IconListNumbers size={15} />}>
              {t("drawer.player.queue")}
            </Tabs.Tab>
            <Tabs.Tab value="lyrics" leftSection={<IconMicrophone2 size={15} />}>
              Lyrics
            </Tabs.Tab>
            <Tabs.Tab value="video" leftSection={<IconVideo size={15} />}>
              Video
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="queue" pt="xs">
            <Box px="xs">
              <ScrollArea className={classes.scrollArea}>
                <VideoList videos={playerPlaylist} />
              </ScrollArea>
            </Box>
          </Tabs.Panel>

          <Tabs.Panel value="lyrics" pt="xs">
            <SyncedLyrics />
          </Tabs.Panel>

          <Tabs.Panel value="video" pt="xs">
            <EmbeddedVideoPanel />
          </Tabs.Panel>
        </Tabs>
      </Box>
    </Card>
  );
});

/** Video tab — switches player to video mode and shows the VideoIframe */
const EmbeddedVideoPanel = memo(() => {
  const { video } = usePlayerVideo();
  const playerMode = usePlayerMode();
  const setPlayerMode = useSetPlayerMode();
  const setVideoIframeVisibility = useSetVideoIframeVisibility();

  if (!video) {
    return (
      <Flex align="center" justify="center" style={{ height: 200 }} direction="column" gap="sm">
        <Text c="dimmed" size="sm">No track playing</Text>
      </Flex>
    );
  }

  if (playerMode !== "video") {
    const handleEnableVideo = () => {
      setPlayerMode("video");
      setVideoIframeVisibility(true);
    };

    return (
      <Flex align="center" justify="center" direction="column" gap="md" py="xl">
        <IconVideo size={40} opacity={0.4} />
        <Text c="dimmed" size="sm" ta="center">
          Switch to video mode to watch the video
        </Text>
        <Button
          size="sm"
          variant="light"
          leftSection={<IconVideo size={16} />}
          onClick={handleEnableVideo}
        >
          Watch Video
        </Button>
      </Flex>
    );
  }

  // Render VideoIframe inline inside the drawer panel
  return (
    <Box
      style={{
        margin: "0 8px",
        borderRadius: 8,
        overflow: "hidden",
        aspectRatio: "16/9",
        position: "relative",
      }}
    >
      <VideoIframe />
    </Box>
  );
});

export const DrawerPlayerVideo = memo(() => {
  const { video } = usePlayerVideo() as { video: Video };

  return (
    <>
      <Flex justify="center" align="center" direction="column">
        <VideoInformations />
        <Space h="md" />
        <ButtonDevicesAvailable variant="text" />
        <Space h="md" />
        <Flex gap="md">
          <ButtonDownload iconSize={16} />
          <ButtonShare iconSize={16} />
          <ButtonPlayerModeVideo render="button" iconSize={16} />
          <ButtonVolume />
        </Flex>
        <Space h="xl" />
        <Flex className={classes.progressContainer}>
          <PlayerProgress />
        </Flex>
        <Space h="xl" />
        <Flex align="center" gap="xl">
          <ButtonRepeat iconSize={16} />
          <PlayerActions />
          <ButtonFavorite card={video as CardVideo} variant="transparent" />
        </Flex>
      </Flex>
    </>
  );
});

const VideoInformations = memo(() => {
  const { video } = usePlayerVideo();
  const [descriptionLineClamp, setDescriptionLineClamp] = useState<
    number | undefined
  >(1);
  const navigate = useStableNavigate();

  useDocumentTitle(`${video?.title as string} - Elysium`);

  if (!video) {
    return null;
  }

  const handleToggleDescription = () => {
    setDescriptionLineClamp(descriptionLineClamp ? undefined : 1);
  };

  const image =
    video.videoThumbnails.find((t) => t.quality === "maxresdefault") ??
    video.videoThumbnails.find((t) => t.quality === "sddefault") ??
    video.videoThumbnails[0];

  return (
    <Box style={{ textAlign: "center", maxWidth: 400 }}>
      <img src={image?.url} alt={video.title} className={classes.thumbnail} />
      <div>
        <Text c="white">
          <strong>{video.title}</strong>
        </Text>
        <UnstyledButton
          mah={120}
          style={{ overflow: "auto" }}
          onClick={handleToggleDescription}
        >
          <Text lineClamp={descriptionLineClamp} size="sm" mt="xs">
            {video.description}
          </Text>
        </UnstyledButton>
        <Button
          variant="subtle"
          onClick={() => navigate(`/channels/${video.authorId}`)}
          radius="md"
        >
          {video.author}
        </Button>
      </div>
    </Box>
  );
});
