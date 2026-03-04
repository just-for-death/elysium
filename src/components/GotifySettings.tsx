import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  PasswordInput,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBell, IconBellOff, IconCheck, IconX } from "@tabler/icons-react";
import { memo, useState } from "react";

import { db } from "../database";
import { useSetSettings, useSettings } from "../providers/Settings";
import { testGotifyConnection } from "../services/gotify";

export const GotifySettings = memo(() => {
  const settings = useSettings() as any;
  const setSettings = useSetSettings();

  const [url, setUrl] = useState<string>(settings.gotifyUrl ?? "");
  const [token, setToken] = useState<string>(settings.gotifyToken ?? "");
  const [testing, setTesting] = useState(false);

  const isEnabled = Boolean(settings.gotifyEnabled);
  const isConfigured = Boolean(settings.gotifyUrl && settings.gotifyToken);

  const handleSave = () => {
    const trimmedUrl = url.trim().replace(/\/+$/, "");
    const trimmedToken = token.trim();

    const updates = {
      gotifyUrl: trimmedUrl,
      gotifyToken: trimmedToken,
      gotifyEnabled: Boolean(trimmedUrl && trimmedToken),
    };

    setSettings((prev: any) => ({ ...prev, ...updates }));
    db.update("settings", { ID: 1 }, () => updates);
    db.commit();

    notifications.show({
      title: "Gotify",
      message: "Settings saved",
      color: "green",
      icon: <IconCheck size={16} />,
    });
  };

  const handleTest = async () => {
    const trimmedUrl = url.trim().replace(/\/+$/, "");
    const trimmedToken = token.trim();
    if (!trimmedUrl || !trimmedToken) {
      notifications.show({
        title: "Gotify",
        message: "Please enter both the server URL and app token first",
        color: "orange",
      });
      return;
    }
    setTesting(true);
    try {
      const result = await testGotifyConnection(trimmedUrl, trimmedToken);
      if (result.ok) {
        notifications.show({
          title: "Gotify",
          message: "✅ Connection successful! Check your Gotify app.",
          color: "green",
          icon: <IconCheck size={16} />,
        });
      } else {
        notifications.show({
          title: "Gotify",
          message: result.error ?? "Connection failed",
          color: "red",
          icon: <IconX size={16} />,
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const handleToggle = (enabled: boolean) => {
    setSettings((prev: any) => ({ ...prev, gotifyEnabled: enabled }));
    db.update("settings", { ID: 1 }, () => ({ gotifyEnabled: enabled }));
    db.commit();
  };

  return (
    <Box>
      <Group mb="sm" align="center">
        <Text fw={500}>Gotify Push Notifications</Text>
        {isConfigured ? (
          isEnabled ? (
            <Badge color="green" leftSection={<IconBell size={12} />}>
              Active
            </Badge>
          ) : (
            <Badge color="gray" leftSection={<IconBellOff size={12} />}>
              Paused
            </Badge>
          )
        ) : null}
      </Group>

      <Text size="sm" c="dimmed" mb="md">
        Receive push notifications on your devices when a followed artist drops
        new music. Requires a self-hosted{" "}
        <Text
          component="a"
          href="https://gotify.net"
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
          c="blue"
          style={{ textDecoration: "underline" }}
        >
          Gotify
        </Text>{" "}
        server and an app token.
      </Text>

      <Stack gap="sm">
        <TextInput
          label="Gotify Server URL"
          placeholder="https://gotify.example.com"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          description="The base URL of your Gotify server"
        />
        <PasswordInput
          label="App Token"
          placeholder="A1b2C3d4..."
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
          description="Create an application in Gotify and paste its token here"
        />

        <Group gap="xs" mt="xs">
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={handleTest} loading={testing}>
            Send test notification
          </Button>
        </Group>

        {isConfigured && (
          <>
            <Divider mt="xs" />
            <Switch
              label="Enable Gotify notifications"
              checked={isEnabled}
              onChange={(e) => handleToggle(e.currentTarget.checked)}
              description="Toggle without losing your credentials"
            />
          </>
        )}

        {isConfigured && (
          <Alert color="teal" variant="light" mt="xs">
            <Text size="xs">
              Notifications are sent when a followed artist releases new music.
              The app checks for updates every hour while open.
            </Text>
          </Alert>
        )}
      </Stack>
    </Box>
  );
});
