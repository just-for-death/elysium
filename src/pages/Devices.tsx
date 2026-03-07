/**
 * DevicesPage — full-page device sync hub for mobile & tablet.
 * Shows linked devices with live ❤️ status, now-playing info,
 * and always-visible remote controls (prev / play-pause / next).
 */

import {
  Alert,
  ActionIcon,
  Badge,
  Box,
  Button,
  CopyButton,
  Divider,
  Flex,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCheck,
  IconCopy,
  IconDeviceDesktop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconHeart,
  IconHeartOff,
  IconLink,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconRefresh,
  IconTrash,
  IconWifi,
  IconWifiOff,
} from "@tabler/icons-react";
import { memo, useCallback, useMemo, useState } from "react";

import { db }                    from "../database";
import { useSetFavorite }        from "../providers/Favorite";
import { useRefreshHistory }     from "../providers/History";
import { useSetFollowedArtists, getFollowedArtists } from "../providers/FollowedArtists";
import { useSetPlaylists }       from "../providers/Playlist";
import { useSettings, useSetSettings } from "../providers/Settings";
import { usePresenceContext }    from "../providers/Presence";
import { presenceService }       from "../services/presence";
import { pushSync, pullSync }    from "../services/sync";
import type { FavoritePlaylist, Playlist } from "../types/interfaces/Playlist";
import type { LinkedDevice }     from "../types/interfaces/Settings";
import type { DevicePresence }   from "../hooks/usePresence";
import { resolveDeviceName }  from "../utils/deviceName";

// ─── Platform icon ─────────────────────────────────────────────────────────────

const PlatformIcon = ({ platform, size = 20 }: { platform: string; size?: number }) => {
  if (platform === "ipad")                             return <IconDeviceTablet size={size} />;
  if (platform === "android" || platform === "mobile") return <IconDeviceMobile size={size} />;
  return <IconDeviceDesktop size={size} />;
};

// ─── Device card ───────────────────────────────────────────────────────────────

const DeviceCard = memo(({ device, dp, onUnlink }: {
  device: LinkedDevice;
  dp: DevicePresence | undefined;
  onUnlink: (code: string) => void;
}) => {
  const isOnline  = dp?.online ?? false;
  const presence  = dp?.presence ?? null;
  const isPlaying = isOnline && presence && !presence.paused;

  const send = (cmd: "play" | "pause" | "next" | "prev") =>
    presenceService.sendControl(device.code, cmd);

  return (
    <Paper
      withBorder
      p="md"
      radius="lg"
      style={{
        borderColor: isPlaying
          ? "var(--mantine-color-teal-6)"
          : isOnline
          ? "var(--mantine-color-blue-8)"
          : "var(--mantine-color-dark-4)",
        transition: "border-color 0.3s",
      }}
    >
      {/* ── Header ── */}
      <Flex align="center" gap="sm" mb="sm">
        <Box style={{ color: isOnline ? "var(--mantine-color-teal-4)" : "var(--mantine-color-dimmed)" }}>
          <PlatformIcon platform={device.platform} />
        </Box>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Flex align="center" gap={6}>
            <Text fw={700} size="sm" lineClamp={1}>{device.name}</Text>
            {isOnline
              ? <IconHeart size={14} fill="var(--mantine-color-pink-5)" color="var(--mantine-color-pink-5)" />
              : <IconHeartOff size={14} color="var(--mantine-color-dimmed)" />
            }
          </Flex>
          <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>{device.code}</Text>
        </Box>
        <Badge size="sm" color={isPlaying ? "teal" : isOnline ? "blue" : "gray"} variant="dot">
          {isPlaying ? "Playing" : isOnline ? "Online" : "Offline"}
        </Badge>
        <Tooltip label="Unlink" withArrow>
          <ActionIcon color="red" variant="subtle" size="sm" onClick={() => onUnlink(device.code)}>
            <IconTrash size={14} />
          </ActionIcon>
        </Tooltip>
      </Flex>

      <Divider mb="sm" />

      {/* ── Now playing info (only when playing) ── */}
      {presence && (
        <Flex align="center" gap="sm" mb="sm">
          {presence.thumbnailUrl && (
            <Box style={{
              width: 48, height: 48, borderRadius: 8, flexShrink: 0,
              background: `url(${presence.thumbnailUrl}) center/cover`,
            }} />
          )}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={600} lineClamp={1}>♪ {presence.title}</Text>
            <Text size="xs" c="dimmed" lineClamp={1}>{presence.author}</Text>
          </Box>
        </Flex>
      )}

      {/* ── Remote controls — always visible when online ── */}
      {isOnline ? (
        <Flex gap={12} justify="center" align="center">
          <Tooltip label="Previous" withArrow>
            <ActionIcon size="xl" variant="light" color="gray" radius="xl" onClick={() => send("prev")}>
              <IconPlayerSkipBack size={20} />
            </ActionIcon>
          </Tooltip>

          {presence && !presence.paused ? (
            <Tooltip label="Pause" withArrow>
              <ActionIcon size="xl" variant="filled" color="orange" radius="xl" onClick={() => send("pause")}>
                <IconPlayerPause size={20} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label="Play" withArrow>
              <ActionIcon size="xl" variant="filled" color="teal" radius="xl" onClick={() => send("play")}>
                <IconPlayerPlay size={20} />
              </ActionIcon>
            </Tooltip>
          )}

          <Tooltip label="Next" withArrow>
            <ActionIcon size="xl" variant="light" color="gray" radius="xl" onClick={() => send("next")}>
              <IconPlayerSkipForward size={20} />
            </ActionIcon>
          </Tooltip>
        </Flex>
      ) : (
        <Text size="xs" c="dimmed" ta="center" py={4}>
          Device is offline — controls unavailable
        </Text>
      )}
    </Paper>
  );
});

// ─── Page ──────────────────────────────────────────────────────────────────────

export const DevicesPage = memo(() => {
  const settings    = useSettings() as any;
  const setSettings = useSetSettings();
  const setFavorite = useSetFavorite();
  const setPlaylists = useSetPlaylists() as (p: Playlist[]) => void;
  const refreshHistory = useRefreshHistory();
  const setFollowedArtists = useSetFollowedArtists();

  const { myCode, wsConnected, devicePresences, pushInstantSync } = usePresenceContext();
  const linkedDevices: LinkedDevice[] = useMemo(() => settings.linkedDevices ?? [], [settings.linkedDevices]);

  const [pairCode,     setPairCode]     = useState("");
  const [pairing,      setPairing]      = useState(false);
  const [syncing,      setSyncing]      = useState(false);
  const [pushCode,     setPushCode]     = useState("");
  const [pullCode,     setPullCode]     = useState("");
  const [pushing,      setPushing]      = useState(false);
  const [pulling,      setPulling]      = useState(false);

  const setters = useMemo(() => ({
    setFavorite:         (p: FavoritePlaylist) => setFavorite(p),
    setPlaylists:        (p: Playlist[]) => setPlaylists(p),
    setHistory:          () => refreshHistory(),
    setFollowedArtists:  () => setFollowedArtists(getFollowedArtists()),
  }), [setFavorite, setPlaylists, refreshHistory, setFollowedArtists]);

  const saveLinkedDevices = useCallback((devices: LinkedDevice[]) => {
    setSettings((prev: any) => ({ ...prev, linkedDevices: devices }));
    db.update("settings", { ID: 1 }, (row: any) => ({ ...row, linkedDevices: devices }));
    db.commit();
  }, [setSettings]);

  const handlePair = useCallback(() => {
    const code = pairCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (code.length < 6) {
      notifications.show({ title: "Pairing", message: "Enter the full device code", color: "orange" }); return;
    }
    if (code === myCode.replace(/-/g, "")) {
      notifications.show({ title: "Pairing", message: "That's your own code!", color: "orange" }); return;
    }
    if (linkedDevices.find((d) => d.code.replace(/-/g, "") === code)) {
      notifications.show({ title: "Pairing", message: "Already linked", color: "orange" }); return;
    }
    setPairing(true);
    const formatted = code.length >= 8 ? `${code.slice(0, 4)}-${code.slice(4, 8)}` : code;
    // Send pairing request — do NOT save locally yet.
    // The device is saved when pair:confirmed arrives from the server
    // (after the other device accepts), handled in usePresence.ts.
    presenceService.sendPairRequest(formatted, resolveDeviceName(settings.deviceName, myCode), "other");
    setPairCode("");
    setPairing(false);
    notifications.show({
      title: "Pairing request sent",
      message: "Waiting for the other device to accept…",
      color: "blue",
      autoClose: 30_000,
    });
  }, [pairCode, linkedDevices, myCode, settings.deviceName]);

  const handleUnlink = useCallback((code: string) => {
    saveLinkedDevices(linkedDevices.filter((d) => d.code !== code));
    notifications.show({ title: "Device unlinked", message: "Removed", color: "gray" });
  }, [linkedDevices, saveLinkedDevices]);

  const handleSync = useCallback(() => {
    setSyncing(true);
    pushInstantSync();
    notifications.show({ title: "Syncing…", message: "Data pushed to all linked devices", color: "teal" });
    setTimeout(() => setSyncing(false), 800);
  }, [pushInstantSync]);

  const handleLegacyPush = useCallback(async () => {
    setPushing(true);
    try {
      const result = await pushSync();
      if (result.ok && result.code) {
        setPushCode(result.code);
        notifications.show({ title: "Code generated", message: "Enter it on the other device", color: "green" });
      } else {
        notifications.show({ title: "Failed", message: result.error ?? "Unknown error", color: "red" });
      }
    } finally { setPushing(false); }
  }, []);

  const handleLegacyPull = useCallback(async () => {
    const code = pullCode.replace(/\D/g, "");
    if (code.length !== 6) {
      notifications.show({ title: "Sync", message: "Enter a 6-digit code", color: "orange" }); return;
    }
    setPulling(true);
    try {
      const result = await pullSync(code, setters);
      if (result.ok) {
        setPullCode("");
        notifications.show({ title: "Sync complete", message: "Data merged", color: "green", autoClose: 5000 });
      } else {
        notifications.show({ title: "Failed", message: result.error ?? "Unknown error", color: "red" });
      }
    } finally { setPulling(false); }
  }, [pullCode, setters]);

  const onlineCount = linkedDevices.filter((d) => devicePresences[d.code]?.online).length;

  return (
    <ScrollArea h="100%" p="md">
      <Stack gap="xl" pb={120}>

        {/* ── Title + live badge ── */}
        <Flex align="center" justify="space-between">
          <Title order={2}>Linked Devices</Title>
          <Badge
            color={wsConnected ? "teal" : "gray"}
            size="md"
            variant="dot"
            leftSection={wsConnected ? <IconWifi size={12} /> : <IconWifiOff size={12} />}
          >
            {wsConnected ? `Live · ${onlineCount} online` : "Offline"}
          </Badge>
        </Flex>

        {/* ── My device code ── */}
        <Box>
          <Text fw={600} size="sm" mb={4}>Your device code</Text>
          <Text size="xs" c="dimmed" mb="sm">Share with other devices to link them.</Text>
          <CopyButton value={myCode}>
            {({ copied, copy }) => (
              <Paper
                withBorder p="md" onClick={copy} radius="lg"
                style={{ display: "inline-flex", alignItems: "center", gap: 14, cursor: "pointer", minWidth: 220 }}
              >
                {wsConnected
                  ? <IconWifi size={20} color="var(--mantine-color-teal-4)" />
                  : <IconWifiOff size={20} color="var(--mantine-color-dimmed)" />
                }
                <Text fw={800} size="xl" style={{ letterSpacing: "0.22em", fontFamily: "monospace", flex: 1 }}>
                  {myCode}
                </Text>
                <ActionIcon variant="transparent" size="sm" color={copied ? "green" : "gray"}>
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              </Paper>
            )}
          </CopyButton>
        </Box>

        <Divider />

        {/* ── Linked device cards ── */}
        <Box>
          <Flex align="center" justify="space-between" mb="md">
            <Text fw={600} size="sm">
              Devices
              {linkedDevices.length > 0 && (
                <Text span c="dimmed" size="xs" ml={6}>
                  ({linkedDevices.length})
                </Text>
              )}
            </Text>
            {linkedDevices.length > 0 && (
              <Button
                size="xs" variant="light" color="teal"
                leftSection={<IconRefresh size={13} />}
                loading={syncing}
                onClick={handleSync}
              >
                Sync all
              </Button>
            )}
          </Flex>

          {linkedDevices.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              No devices linked yet — add one below.
            </Text>
          ) : (
            <Stack gap="md">
              {linkedDevices.map((device) => (
                <DeviceCard
                  key={device.code}
                  device={device}
                  dp={devicePresences[device.code]}
                  onUnlink={handleUnlink}
                />
              ))}
            </Stack>
          )}
        </Box>

        <Divider />

        {/* ── Link a new device ── */}
        <Box>
          <Text fw={600} size="sm" mb={4}>Link a new device</Text>
          <Text size="xs" c="dimmed" mb="md">
            Settings → Device Sync on the other device → copy its code → paste here.
          </Text>
          <Stack gap="sm">
            <TextInput
              label="Device code"
              placeholder="XXXX-XXXX"
              value={pairCode}
              onChange={(e) => {
                const raw = e.currentTarget.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
                setPairCode(raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw);
              }}
            />
            <Button leftSection={<IconLink size={16} />} loading={pairing} onClick={handlePair} fullWidth>
              Link device
            </Button>
          </Stack>
        </Box>

        <Divider />

        {/* ── Fallback code sync ── */}
        <Box>
          <Text fw={600} size="sm" mb={2}>Fallback: one-time code sync</Text>
          <Text size="xs" c="dimmed" mb="sm">Use when live sync is unavailable.</Text>
          <Stack gap="sm">
            <Group gap="sm" align="flex-end">
              <Button
                leftSection={<IconRefresh size={14} />}
                loading={pushing}
                onClick={handleLegacyPush}
                variant="light"
                size="sm"
              >
                Generate 6-digit code
              </Button>
              {pushCode && (
                <CopyButton value={pushCode}>
                  {({ copied, copy }) => (
                    <Group
                      gap={6} onClick={copy}
                      style={{ background: "var(--mantine-color-dark-6)", borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}
                    >
                      <Text fw={700} size="lg" style={{ letterSpacing: "0.18em", fontFamily: "monospace" }}>
                        {pushCode.slice(0, 3)}-{pushCode.slice(3)}
                      </Text>
                      <ActionIcon variant="transparent" size="sm" color={copied ? "green" : "gray"}>
                        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      </ActionIcon>
                    </Group>
                  )}
                </CopyButton>
              )}
            </Group>
            <Group gap="sm" align="flex-end">
              <TextInput
                placeholder="123-456"
                value={pullCode}
                onChange={(e) => {
                  const d = e.currentTarget.value.replace(/\D/g, "").slice(0, 6);
                  setPullCode(d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d);
                }}
                style={{ width: 140 }}
                inputMode="numeric"
              />
              <Button
                loading={pulling}
                onClick={handleLegacyPull}
                disabled={pullCode.replace(/\D/g, "").length !== 6}
                size="sm"
                variant="light"
              >
                Pull by code
              </Button>
            </Group>
          </Stack>
        </Box>

        <Alert color="blue" variant="light">
          <Text size="xs">
            Device codes are permanent and local-only. Live sync uses WebSocket through your Elysium server — nothing leaves your network.
          </Text>
        </Alert>

      </Stack>
    </ScrollArea>
  );
});
