import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  NumberInput,
  PasswordInput,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { IconBrandLastfm, IconCheck, IconX } from "@tabler/icons-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { db } from "../database";
import { useSetSettings, useSettings } from "../providers/Settings";
import { validateListenBrainzToken } from "../services/listenbrainz";
import { ListenBrainzPlaylistSync } from "./ListenBrainzPlaylistSync";

const SCROBBLE_CAP_OPTIONS = [
  { value: "0", label: "No cap" },
  { value: "60", label: "1 minute" },
  { value: "120", label: "2 minutes" },
  { value: "180", label: "3 minutes" },
  { value: "240", label: "4 minutes (default)" },
  { value: "300", label: "5 minutes" },
  { value: "480", label: "8 minutes" },
  { value: "600", label: "10 minutes" },
];

export const ListenBrainzSettings = memo(() => {
  const settings = useSettings();
  const setSettings = useSetSettings();
  const { t } = useTranslation();

  const [token, setToken] = useState(settings.listenBrainzToken ?? "");
  const [validating, setValidating] = useState(false);

  const isConnected = !!settings.listenBrainzUsername;

  const scrobblePercent = settings.listenBrainzScrobblePercent ?? 50;
  const scrobbleMaxSeconds = settings.listenBrainzScrobbleMaxSeconds ?? 240;

  const handleConnect = async () => {
    if (!token.trim()) return;
    setValidating(true);
    try {
      const result = await validateListenBrainzToken(token.trim());
      if (result.valid && result.username) {
        const updated = {
          listenBrainzToken: token.trim(),
          listenBrainzUsername: result.username,
          listenBrainzEnabled: true,
        };
        setSettings((prev) => ({ ...prev, ...updated }));
        db.update("settings", { ID: 1 }, () => updated);
        db.commit();
        showNotification({
          title: "ListenBrainz",
          message: `Connected as ${result.username}`,
          color: "green",
        });
      } else {
        showNotification({
          title: "ListenBrainz",
          message: "Invalid token. Please check your ListenBrainz user token.",
          color: "red",
        });
      }
    } finally {
      setValidating(false);
    }
  };

  const handleDisconnect = () => {
    const updated = {
      listenBrainzToken: null,
      listenBrainzUsername: null,
      listenBrainzEnabled: false,
    };
    setSettings((prev) => ({ ...prev, ...updated }));
    db.update("settings", { ID: 1 }, () => updated);
    db.commit();
    setToken("");
    showNotification({
      title: "ListenBrainz",
      message: "Disconnected from ListenBrainz.",
    });
  };

  const handleToggleEnabled = (enabled: boolean) => {
    setSettings((prev) => ({ ...prev, listenBrainzEnabled: enabled }));
    db.update("settings", { ID: 1 }, () => ({ listenBrainzEnabled: enabled }));
    db.commit();
  };

  const handleScrobblePercentChange = (value: number) => {
    setSettings((prev) => ({ ...prev, listenBrainzScrobblePercent: value }));
    db.update("settings", { ID: 1 }, () => ({ listenBrainzScrobblePercent: value }));
    db.commit();
  };

  const handleScrobbleMaxSecondsChange = (value: string | null) => {
    const seconds = parseInt(value ?? "240", 10);
    setSettings((prev) => ({ ...prev, listenBrainzScrobbleMaxSeconds: seconds }));
    db.update("settings", { ID: 1 }, () => ({ listenBrainzScrobbleMaxSeconds: seconds }));
    db.commit();
  };

  const thresholdDescription = (() => {
    const pct = `${scrobblePercent}%`;
    if (scrobbleMaxSeconds === 0) return `after ${pct} of the track`;
    const capMin = Math.floor(scrobbleMaxSeconds / 60);
    const capSec = scrobbleMaxSeconds % 60;
    const capLabel = capSec === 0 ? `${capMin} min` : `${capMin}m ${capSec}s`;
    return `after ${pct} of the track, or ${capLabel} — whichever comes first`;
  })();

  return (
    <Box>
      <Group mb="sm" align="center">
        <Text fw={500}>ListenBrainz Scrobbling</Text>
        {isConnected ? (
          <Badge color="green" leftSection={<IconCheck size={12} />}>
            Connected as {settings.listenBrainzUsername}
          </Badge>
        ) : (
          <Badge color="gray" leftSection={<IconX size={12} />}>
            Not connected
          </Badge>
        )}
      </Group>

      <Text size="sm" c="dimmed" mb="md">
        Automatically scrobble tracks you listen to on{" "}
        <Anchor href="https://listenbrainz.org" target="_blank" size="sm">
          ListenBrainz
        </Anchor>
        . Scrobbles {thresholdDescription}.
      </Text>

      {!isConnected ? (
        <Stack gap="sm">
          <Alert color="blue" variant="light">
            <Text size="sm">
              Get your User Token from{" "}
              <Anchor
                href="https://listenbrainz.org/settings/"
                target="_blank"
                size="sm"
              >
                listenbrainz.org/settings
              </Anchor>{" "}
              under "User Token".
            </Text>
          </Alert>
          <PasswordInput
            label="User Token"
            placeholder="Paste your ListenBrainz user token"
            value={token}
            onChange={(e) => setToken(e.currentTarget.value)}
          />
          <Button
            onClick={handleConnect}
            loading={validating}
            disabled={!token.trim()}
            leftSection={<IconBrandLastfm size={16} />}
          >
            Connect to ListenBrainz
          </Button>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Switch
            label="Enable scrobbling"
            description="Automatically submit listens when you play tracks"
            checked={settings.listenBrainzEnabled ?? true}
            onChange={(e) => handleToggleEnabled(e.currentTarget.checked)}
          />
          <Divider />
          <Switch
            label="Submit 'Playing Now'"
            description="Show what you're currently listening to on your ListenBrainz profile"
            checked={settings.listenBrainzPlayingNow ?? true}
            onChange={(e) => {
              const val = e.currentTarget.checked;
              setSettings((prev) => ({ ...prev, listenBrainzPlayingNow: val }));
              db.update("settings", { ID: 1 }, () => ({ listenBrainzPlayingNow: val }));
              db.commit();
            }}
          />
          <Divider />

          {/* Scrobble threshold */}
          <Box>
            <Text size="sm" fw={500} mb={4}>
              Scrobble after
            </Text>
            <Text size="xs" c="dimmed" mb="xs">
              Percentage of track listened before a scrobble is submitted
            </Text>
            <Group align="flex-start" gap="md">
              <Box style={{ flex: 1 }}>
                <Slider
                  min={10}
                  max={100}
                  step={5}
                  value={scrobblePercent}
                  onChange={handleScrobblePercentChange}
                  marks={[
                    { value: 25, label: "25%" },
                    { value: 50, label: "50%" },
                    { value: 75, label: "75%" },
                    { value: 100, label: "100%" },
                  ]}
                  mb="lg"
                />
              </Box>
              <NumberInput
                value={scrobblePercent}
                onChange={(v) => handleScrobblePercentChange(Number(v))}
                min={10}
                max={100}
                step={5}
                suffix="%"
                w={80}
                size="xs"
              />
            </Group>
          </Box>

          <Box>
            <Text size="sm" fw={500} mb={4}>
              Scrobble cap
            </Text>
            <Text size="xs" c="dimmed" mb="xs">
              Maximum time before a scrobble is triggered regardless of percentage
            </Text>
            <Select
              data={SCROBBLE_CAP_OPTIONS}
              value={String(scrobbleMaxSeconds)}
              onChange={handleScrobbleMaxSecondsChange}
              size="sm"
              w={220}
            />
          </Box>

          <Divider />
          <Group>
            <Button
              variant="outline"
              color="red"
              size="xs"
              onClick={handleDisconnect}
            >
              Disconnect
            </Button>
            <Anchor
              href={`https://listenbrainz.org/user/${settings.listenBrainzUsername}/`}
              target="_blank"
              size="sm"
            >
              View my listens →
            </Anchor>
          </Group>

          {/* ── Playlist Sync Section ─────────────────────────────────── */}
          <Divider
            my="md"
            label={
              <Text size="xs" fw={700} style={{ letterSpacing: "1px", textTransform: "uppercase", color: "var(--sp-text-muted)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Playlist Sync
              </Text>
            }
          />
          <ListenBrainzPlaylistSync />
        </Stack>
      )}
    </Box>
  );
});
