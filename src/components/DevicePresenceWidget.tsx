/**
 * DevicePresenceWidget
 *
 * Desktop: compact wifi icon in sidebar → click opens popover with device cards + remote controls
 * Mobile:  mobileInline={true} → expanded inline panel inside the nav drawer
 */

import {
  ActionIcon,
  Badge,
  Box,
  Flex,
  Indicator,
  Popover,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconDeviceDesktop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconWifi,
  IconWifiOff,
} from "@tabler/icons-react";
import { memo, useState } from "react";

import { usePresenceContext }  from "../providers/Presence";
import { presenceService }     from "../services/presence";
import type { DevicePresence } from "../hooks/usePresence";
import classes                 from "./NavbarLink.module.css";

const PlatformIcon = ({ platform, size = 16 }: { platform: string; size?: number }) => {
  if (platform === "ipad")                             return <IconDeviceTablet size={size} />;
  if (platform === "android" || platform === "mobile") return <IconDeviceMobile size={size} />;
  return <IconDeviceDesktop size={size} />;
};

const DeviceCard = memo(({ device, compact = false }: { device: DevicePresence; compact?: boolean }) => {
  const { presence, online, name, platform, code } = device;
  const isPlaying = online && presence && !presence.paused;
  const send = (cmd: "play" | "pause" | "next" | "prev") => presenceService.sendControl(code, cmd);

  return (
    <Box style={{
      background: "var(--mantine-color-dark-7)",
      borderRadius: 10,
      padding: compact ? "8px 10px" : "10px 12px",
      border: `1px solid ${isPlaying ? "var(--mantine-color-teal-7)" : "var(--mantine-color-dark-5)"}`,
      transition: "border-color 0.3s",
    }}>
      <Flex align="center" gap="xs" mb={presence ? 8 : 0}>
        <PlatformIcon platform={platform} size={14} />
        <Text size="xs" fw={600} style={{ flex: 1 }} lineClamp={1}>{name}</Text>
        <Badge size="xs" color={online ? (isPlaying ? "teal" : "blue") : "gray"} variant="dot">
          {online ? (isPlaying ? "Playing" : "Online") : "Offline"}
        </Badge>
      </Flex>

      {presence && (
        <>
          <Flex align="center" gap="sm">
            {presence.thumbnailUrl && (
              <Box style={{ width: 34, height: 34, borderRadius: 4, background: `url(${presence.thumbnailUrl}) center/cover`, flexShrink: 0 }} />
            )}
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="xs" lineClamp={1} fw={500}>{presence.title}</Text>
              <Text size="xs" c="dimmed" lineClamp={1}>{presence.author}</Text>
            </Box>
          </Flex>
          <Flex gap={4} mt={8} align="center" justify="center">
            <Tooltip label="Previous" withArrow>
              <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => send("prev")}><IconPlayerSkipBack size={13} /></ActionIcon>
            </Tooltip>
            {presence.paused ? (
              <Tooltip label="Play" withArrow>
                <ActionIcon size="sm" variant="filled" color="teal" radius="xl" onClick={() => send("play")}><IconPlayerPlay size={13} /></ActionIcon>
              </Tooltip>
            ) : (
              <Tooltip label="Pause" withArrow>
                <ActionIcon size="sm" variant="filled" color="orange" radius="xl" onClick={() => send("pause")}><IconPlayerPause size={13} /></ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="Next" withArrow>
              <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => send("next")}><IconPlayerSkipForward size={13} /></ActionIcon>
            </Tooltip>
          </Flex>
        </>
      )}
    </Box>
  );
});

const InlinePanel = memo(({ devices, wsConnected }: { devices: DevicePresence[]; wsConnected: boolean }) => (
  <Box>
    <Flex align="center" justify="space-between" mb="xs">
      <Flex align="center" gap={6}>
        {wsConnected ? <IconWifi size={14} color="var(--mantine-color-teal-4)" /> : <IconWifiOff size={14} color="var(--mantine-color-dimmed)" />}
        <Text size="xs" fw={600} c={wsConnected ? undefined : "dimmed"}>Linked Devices</Text>
      </Flex>
      <Badge size="xs" color={wsConnected ? "teal" : "gray"} variant="light">{wsConnected ? "Live" : "Offline"}</Badge>
    </Flex>
    <Stack gap={6}>
      {devices.map((d) => <DeviceCard key={d.code} device={d} compact />)}
    </Stack>
  </Box>
));

export const DevicePresenceWidget = memo(({ mobileInline = false }: { mobileInline?: boolean }) => {
  const { wsConnected, devicePresences } = usePresenceContext();
  const [opened, setOpened] = useState(false);
  const devices    = Object.values(devicePresences);
  const anyOnline  = devices.some((d) => d.online);
  const anyPlaying = devices.some((d) => d.online && d.presence && !d.presence.paused);

  if (!devices.length) return null;

  if (mobileInline) return <InlinePanel devices={devices} wsConnected={wsConnected} />;

  return (
    <Popover opened={opened} onChange={setOpened} position="right-end" withArrow shadow="lg" offset={12} width={280}>
      <Popover.Target>
        <Tooltip label="Linked devices" position="right" disabled={opened}>
          <Indicator color={anyPlaying ? "teal" : anyOnline ? "blue" : "gray"} processing={anyPlaying} size={8} offset={4}>
            <ActionIcon className={classes.link} onClick={() => setOpened((o) => !o)} aria-label="Linked devices"
              style={{ color: wsConnected ? undefined : "var(--mantine-color-dimmed)" }}>
              {wsConnected ? <IconWifi stroke={1.5} size={18} /> : <IconWifiOff stroke={1.5} size={18} />}
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p="sm">
        <Flex align="center" justify="space-between" mb="xs">
          <Text size="sm" fw={600}>Linked Devices</Text>
          <Badge size="xs" color={wsConnected ? "teal" : "gray"} variant="light">{wsConnected ? "Live" : "Offline"}</Badge>
        </Flex>
        <Stack gap="xs">
          {devices.map((d) => <DeviceCard key={d.code} device={d} />)}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
});
