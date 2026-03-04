/**
 * SyncSettings — v3
 *
 * Instant sync: data flows over WebSocket the moment you click "Sync now".
 * No codes, no waiting — linked devices receive updates in < 1 second.
 *
 * Permanent device code system:
 *   • Each device has a stable 8-char code derived from its deviceId
 *   • Pair by entering the other device's code; that's it
 *   • Linked devices show live "online / playing" presence
 */

import {
  Alert,
  Badge,
  Box,
  Button,
  CopyButton,
  Divider,
  Flex,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  ActionIcon,
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
  IconX,
} from "@tabler/icons-react";
import { memo, useCallback, useMemo, useState } from "react";

import { db }                   from "../database";
import { useSetFavorite }       from "../providers/Favorite";
import { useRefreshHistory }    from "../providers/History";
import { useSetFollowedArtists, getFollowedArtists } from "../providers/FollowedArtists";
import { useSetPlaylists }      from "../providers/Playlist";
import { useSettings, useSetSettings } from "../providers/Settings";
import { usePresenceContext }   from "../providers/Presence";
import { presenceService }      from "../services/presence";
import { pushSync, pullSync } from "../services/sync";
import type { FavoritePlaylist, Playlist } from "../types/interfaces/Playlist";
import type { LinkedDevice }    from "../types/interfaces/Settings";
import type { DevicePresence }  from "../hooks/usePresence";
import { deriveDeviceCode }     from "../hooks/usePresence";
import { getMusicalDeviceName, resolveDeviceName } from "../utils/deviceName";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatRelative = (iso: string): string => {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const PlatformIcon = ({ platform, size = 16 }: { platform: string; size?: number }) => {
  if (platform === "ipad")                             return <IconDeviceTablet size={size} />;
  if (platform === "android" || platform === "mobile") return <IconDeviceMobile size={size} />;
  return <IconDeviceDesktop size={size} />;
};

const PlatformLabel: Record<string, string> = {
  linux: "Linux", android: "Android", ipad: "iPad", windows: "Windows", mac: "Mac", other: "Other",
};

// ─── Component ────────────────────────────────────────────────────────────────

export const SyncSettings = memo(() => {
  const settings    = useSettings() as any;
  const setSettings = useSetSettings();
  const setFavorite = useSetFavorite();
  const setPlaylists = useSetPlaylists() as (p: Playlist[]) => void;
  const refreshHistory = useRefreshHistory();
  const setFollowedArtists = useSetFollowedArtists();

  const { myCode, wsConnected, devicePresences, pushInstantSync } = usePresenceContext();
  const linkedDevices: LinkedDevice[] = useMemo(() => settings.linkedDevices ?? [], [settings.linkedDevices]);

  // ── Pairing form ──────────────────────────────────────────────────────────
  const [pairCode,     setPairCode]     = useState("");
  const [pairName,     setPairName]     = useState("");
  const [pairPlatform, setPairPlatform] = useState<string>("other");
  const [pairing,      setPairing]      = useState(false);

  // ── Manual sync (legacy fallback) ─────────────────────────────────────────
  const [pushCode, setPushCode] = useState<string>("");
  const [pullCode, setPullCode] = useState<string>("");
  const [pushing,  setPushing]  = useState(false);
  const [pulling,  setPulling]  = useState(false);
  const [syncing,  setSyncing]  = useState(false);

  const setters = useMemo(() => ({
    setFavorite: (p: FavoritePlaylist) => setFavorite(p),
    setPlaylists: (p: Playlist[]) => setPlaylists(p),
    setHistory: () => refreshHistory(),
    setFollowedArtists: () => setFollowedArtists(getFollowedArtists()),
  }), [setFavorite, setPlaylists, refreshHistory, setFollowedArtists]);

  // ── Save linked devices ───────────────────────────────────────────────────
  const saveLinkedDevices = useCallback((devices: LinkedDevice[]) => {
    setSettings((prev: any) => ({ ...prev, linkedDevices: devices }));
    db.update("settings", { ID: 1 }, (row: any) => ({ ...row, linkedDevices: devices }));
    db.commit();
  }, [setSettings]);

  // ── Pair a new device ─────────────────────────────────────────────────────
  const handlePair = useCallback(() => {
    const code = pairCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (code.length < 6) {
      notifications.show({ title: "Pairing", message: "Enter the full device code", color: "orange" }); return;
    }
    if (code === myCode.replace("-", "")) {
      notifications.show({ title: "Pairing", message: "That's your own device code!", color: "orange" }); return;
    }
    if (linkedDevices.find((d) => d.code.replace("-", "") === code)) {
      notifications.show({ title: "Pairing", message: "Device already linked", color: "orange" }); return;
    }
    setPairing(true);
    const formatted = code.length >= 8 ? `${code.slice(0, 4)}-${code.slice(4, 8)}` : code;
    const newDevice: LinkedDevice = {
      code: formatted, name: pairName.trim() || getMusicalDeviceName(formatted),
      platform: pairPlatform, pairedAt: new Date().toISOString(), lastSyncAt: "",
    };
    saveLinkedDevices([...linkedDevices, newDevice]);
    // Notify the other device so it auto-adds us back (bidirectional pairing)
    presenceService.sendPairRequest(formatted, resolveDeviceName(settings.deviceName, myCode), "other");
    setPairCode(""); setPairName(""); setPairPlatform("other");
    setPairing(false);
    notifications.show({ title: "Device linked!", message: `"${newDevice.name}" is now connected — they'll be notified`, color: "green", icon: <IconCheck size={16} /> });
  }, [pairCode, pairName, pairPlatform, linkedDevices, myCode, saveLinkedDevices, settings.deviceName]);

  const handleUnlink = useCallback((code: string) => {
    saveLinkedDevices(linkedDevices.filter((d) => d.code !== code));
    notifications.show({ title: "Device unlinked", message: "Removed from sync list", color: "gray" });
  }, [linkedDevices, saveLinkedDevices]);

  // ── Instant sync ──────────────────────────────────────────────────────────
  const handleInstantSync = useCallback(() => {
    setSyncing(true);
    try {
      pushInstantSync();
      notifications.show({ title: "Syncing…", message: "Data sent to all linked devices instantly", color: "teal", icon: <IconCheck size={16} /> });
    } finally {
      setTimeout(() => setSyncing(false), 600);
    }
  }, [pushInstantSync]);

  // ── Legacy push / pull (fallback when no WS) ─────────────────────────────
  const handleLegacyPush = useCallback(async () => {
    setPushing(true);
    try {
      const result = await pushSync();
      if (result.ok && result.code) {
        setPushCode(result.code);
        notifications.show({ title: "Sync", message: "Code generated — enter it on the other device", color: "green", icon: <IconCheck size={16} /> });
      } else {
        notifications.show({ title: "Sync failed", message: result.error ?? "Unknown error", color: "red", icon: <IconX size={16} /> });
      }
    } finally { setPushing(false); }
  }, []);

  const handleLegacyPull = useCallback(async () => {
    const code = pullCode.replace(/\D/g, "");
    if (code.length !== 6) { notifications.show({ title: "Sync", message: "Enter a 6-digit code", color: "orange" }); return; }
    setPulling(true);
    try {
      const result = await pullSync(code, setters);
      if (result.ok && result.summary) {
        const { newFavorites, newPlaylists, updatedPlaylists, newHistory, newArtists } = result.summary;
        const total = newFavorites + newPlaylists + updatedPlaylists + newHistory + newArtists;
        setPullCode("");
        notifications.show({
          title: "Sync complete",
          message: total === 0 ? "Already up to date" : `+${newFavorites} fav · +${newPlaylists} playlists · +${newHistory} history`,
          color: "green", icon: <IconCheck size={16} />, autoClose: 6000,
        });
      } else {
        notifications.show({ title: "Sync failed", message: result.error ?? "Unknown error", color: "red", icon: <IconX size={16} /> });
      }
    } finally { setPulling(false); }
  }, [pullCode, setters, setSettings]);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Box>
      {/* ── Status bar ── */}
      <Group mb="md" align="center">
        <Text fw={500}>Device Sync</Text>
        <Badge color={wsConnected ? "teal" : "gray"} size="sm" variant="dot">
          {wsConnected ? "Live" : "Offline"}
        </Badge>
        <Badge color={linkedDevices.length > 0 ? "blue" : "gray"} size="sm">
          {linkedDevices.length > 0 ? `${linkedDevices.length} device${linkedDevices.length !== 1 ? "s" : ""}` : "No devices"}
        </Badge>
      </Group>

      <Stack gap="xl">

        {/* ── This device's permanent code ── */}
        <Box>
          <Text fw={500} size="sm" mb={4}>Your device code</Text>
          <Text size="xs" c="dimmed" mb="sm">
            Permanent. Share it with your other devices to link them.
          </Text>
          <CopyButton value={myCode}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? "Copied!" : "Copy"}>
                <Paper withBorder p="sm" onClick={copy}
                  style={{ display: "inline-flex", alignItems: "center", gap: 12, cursor: "pointer", borderRadius: 10 }}>
                  {wsConnected
                    ? <IconWifi    size={18} color="var(--mantine-color-teal-4)" />
                    : <IconWifiOff size={18} color="var(--mantine-color-dimmed)" />
                  }
                  <Text fw={700} size="xl" style={{ letterSpacing: "0.2em", fontFamily: "monospace" }}>
                    {myCode}
                  </Text>
                  <ActionIcon variant="transparent" size="sm" color={copied ? "green" : "gray"}>
                    {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  </ActionIcon>
                </Paper>
              </Tooltip>
            )}
          </CopyButton>
        </Box>

        <Divider />

        {/* ── Instant Sync button ── */}
        {linkedDevices.length > 0 && (
          <Box>
            <Text fw={500} size="sm" mb={4}>Instant sync</Text>
            <Text size="xs" c="dimmed" mb="sm">
              Push your playlists, favourites, history and followed artists to all linked devices right now.
              {!wsConnected && " (WebSocket offline — will queue until reconnected)"}
            </Text>
            <Button
              leftSection={<IconRefresh size={16} />}
              loading={syncing}
              onClick={handleInstantSync}
              color="teal"
              variant={wsConnected ? "filled" : "light"}
            >
              Sync now → {linkedDevices.length} device{linkedDevices.length !== 1 ? "s" : ""}
            </Button>
          </Box>
        )}

        {linkedDevices.length > 0 && <Divider />}

        {/* ── Linked devices list ── */}
        <Box>
          <Text fw={500} size="sm" mb={4}>Linked devices</Text>

          {linkedDevices.length === 0 ? (
            <Text size="xs" c="dimmed" mb="sm">No devices linked yet. Add one below.</Text>
          ) : (
            <Stack gap="xs" mb="md">
              {linkedDevices.map((device) => {
                const dp: DevicePresence | undefined = devicePresences[device.code];
                const isPlaying = dp?.online && dp.presence && !dp.presence.paused;
                const isOnline  = dp?.online;
                return (
                  <Paper key={device.code} withBorder p="sm"
                    style={{
                      borderRadius: 8,
                      borderColor: isPlaying ? "var(--mantine-color-teal-7)" : isOnline ? "var(--mantine-color-blue-8)" : undefined,
                      transition: "border-color 0.3s",
                    }}>
                    <Flex align="center" justify="space-between">
                      <Flex align="center" gap="sm" style={{ flex: 1, minWidth: 0 }}>
                        <PlatformIcon platform={device.platform} />
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Group gap={6}>
                            <Text size="sm" fw={600}>{device.name}</Text>
                            {isOnline
                              ? <IconHeart size={13} fill="var(--mantine-color-pink-5)" color="var(--mantine-color-pink-5)" />
                              : <IconHeartOff size={13} color="var(--mantine-color-dimmed)" />
                            }
                            <Badge size="xs" color={isPlaying ? "teal" : isOnline ? "blue" : "gray"} variant="dot">
                              {isPlaying ? "Playing" : isOnline ? "Online" : "Offline"}
                            </Badge>
                          </Group>
                          <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>{device.code}</Text>
                          {dp?.presence && (
                            <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
                              ♪ {dp.presence.title}
                            </Text>
                          )}
                        </Box>
                      </Flex>
                      <Group gap="xs">
                        <Badge size="xs" color="teal" variant="light">
                          {PlatformLabel[device.platform] ?? device.platform}
                        </Badge>
                        <Tooltip label="Unlink">
                          <ActionIcon color="red" variant="subtle" size="sm" onClick={() => handleUnlink(device.code)}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Flex>

                    {/* Now playing row with remote controls */}
                    {dp?.presence && (
                      <Flex align="center" gap="sm" mt="xs">
                        {dp.presence.thumbnailUrl && (
                          <Box style={{ width: 32, height: 32, borderRadius: 4, flexShrink: 0,
                            background: `url(${dp.presence.thumbnailUrl}) center/cover` }} />
                        )}
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" fw={500} lineClamp={1}>{dp.presence.title}</Text>
                          <Text size="xs" c="dimmed" lineClamp={1}>{dp.presence.author}</Text>
                        </Box>
                        <Group gap={4}>
                          <Tooltip label="Prev"><ActionIcon size="xs" variant="subtle" color="gray" onClick={() => presenceService.sendControl(device.code, "prev")}><IconPlayerSkipBack size={12}/></ActionIcon></Tooltip>
                          {dp.presence.paused
                            ? <Tooltip label="Play"><ActionIcon size="xs" variant="subtle" color="teal" onClick={() => presenceService.sendControl(device.code, "play")}><IconPlayerPlay size={12}/></ActionIcon></Tooltip>
                            : <Tooltip label="Pause"><ActionIcon size="xs" variant="subtle" color="orange" onClick={() => presenceService.sendControl(device.code, "pause")}><IconPlayerPause size={12}/></ActionIcon></Tooltip>
                          }
                          <Tooltip label="Next"><ActionIcon size="xs" variant="subtle" color="gray" onClick={() => presenceService.sendControl(device.code, "next")}><IconPlayerSkipForward size={12}/></ActionIcon></Tooltip>
                        </Group>
                      </Flex>
                    )}
                  </Paper>
                );
              })}
            </Stack>
          )}

          {/* Link a new device */}
          <Paper withBorder p="md" style={{ borderRadius: 10 }}>
            <Text size="sm" fw={500} mb="xs">Link a new device</Text>
            <Text size="xs" c="dimmed" mb="sm">
              Open Settings → Device Sync on the other device, copy its code, paste it here.
            </Text>
            <Stack gap="sm">
              <TextInput
                label="Device code" placeholder="XXXX-XXXX"
                value={pairCode}
                onChange={(e) => {
                  const raw = e.currentTarget.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
                  setPairCode(raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw);
                }}
                style={{ maxWidth: 200 }}
              />
              <Group gap="sm">
                <TextInput label="Device name" placeholder="e.g. My iPad"
                  value={pairName} onChange={(e) => setPairName(e.currentTarget.value)} style={{ maxWidth: 200 }} />
                <Select
                  label="Platform"
                  data={[
                    { value: "linux", label: "Linux" }, { value: "android", label: "Android" },
                    { value: "ipad", label: "iPad" }, { value: "windows", label: "Windows" },
                    { value: "mac", label: "Mac" }, { value: "other", label: "Other" },
                  ]}
                  value={pairPlatform} onChange={(v) => setPairPlatform(v ?? "other")} style={{ width: 140 }}
                />
              </Group>
              <Button leftSection={<IconLink size={16} />} loading={pairing} onClick={handlePair} size="sm">
                Link device
              </Button>
            </Stack>
          </Paper>
        </Box>

        <Divider />

        {/* ── Legacy fallback ── */}
        <Box>
          <Text fw={500} size="sm" mb={2}>Fallback: code-based sync</Text>
          <Text size="xs" c="dimmed" mb="sm">
            Use this if the device isn't linked or the live connection is unavailable.
          </Text>
          <Stack gap="sm">
            <Group gap="sm" align="flex-end">
              <Button leftSection={<IconRefresh size={16} />} loading={pushing} onClick={handleLegacyPush} size="sm" variant="light">
                Generate 6-digit code
              </Button>
              {pushCode && (
                <CopyButton value={pushCode}>
                  {({ copied, copy }) => (
                    <Group gap={6} onClick={copy} style={{ background: "var(--mantine-color-dark-6)", borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}>
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
              <TextInput placeholder="123-456" value={pullCode}
                onChange={(e) => {
                  const d = e.currentTarget.value.replace(/\D/g, "").slice(0, 6);
                  setPullCode(d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d);
                }}
                style={{ width: 130 }} inputMode="numeric" />
              <Button loading={pulling} onClick={handleLegacyPull} disabled={pullCode.replace(/\D/g, "").length !== 6} size="sm" variant="light">
                Pull by code
              </Button>
            </Group>
          </Stack>
        </Box>

        <Alert color="blue" variant="light">
          <Text size="xs">
            Device codes are permanent and local-only. Live sync uses a WebSocket through your Elysium server.
            Nothing is sent to external servers.
          </Text>
        </Alert>

      </Stack>
    </Box>
  );
});
