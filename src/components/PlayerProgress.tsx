import { Box, Flex, Slider, Text } from "@mantine/core";
import { memo } from "react";

import { useDevices } from "../hooks/useDevices";
import { useSponsorBlock } from "../hooks/useSponsorBlock";
import { useAudioElement, usePlayerProgress, usePlayerStatus } from "../providers/Player";
import { SponsorBlockBar } from "./SponsorBlockBar";

export const PlayerProgress = memo(() => {
  const getAudioEl = useAudioElement();
  const playerProgress = usePlayerProgress();
  const playerStatus = usePlayerStatus();
  const { isLarge } = useDevices();

  useSponsorBlock();

  const handleChangeEnd = (currentTime: number) => {
    const audio = getAudioEl();
    if (!audio) return;
    const duration = playerStatus.audioDuration
      ?? (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    if (!duration) return;
    audio.currentTime = (currentTime * duration) / 100;
  };

  return (
    <Flex align="center" gap={isLarge ? "xl" : "md"} style={{ flex: 1 }}>
      <Text size="xs" c="white">
        {String(playerProgress.formatedCurrentTime ?? "00:00")}
      </Text>
      <Box pos="relative" style={{ flex: 1 }}>
        <Slider
          label={null}
          value={playerProgress.percentage ?? 0}
          onChangeEnd={handleChangeEnd}
          size="xs"
        />
        <SponsorBlockBar />
      </Box>
      <Text size="xs" c="white">
        {String(playerStatus.duration ?? "00:00")}
      </Text>
    </Flex>
  );
});

