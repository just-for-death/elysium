import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import { IconBell, IconBellOff, IconBellRinging } from "@tabler/icons-react";
import { memo } from "react";

import { usePushNotifications } from "../hooks/usePushNotifications";

export const PushNotificationSettings = memo(() => {
  const { isSupported, status, isSubscribed, subscribe, unsubscribe } =
    usePushNotifications();

  if (!isSupported) {
    return (
      <Alert color="gray" variant="light">
        <Text size="sm">
          Push notifications are not supported in this browser.
        </Text>
      </Alert>
    );
  }

  return (
    <Box>
      <Group mb="sm" align="center">
        <Text fw={500}>Push Notifications</Text>
        {isSubscribed ? (
          <Badge color="green" leftSection={<IconBellRinging size={12} />}>
            Enabled
          </Badge>
        ) : (
          <Badge color="gray" leftSection={<IconBellOff size={12} />}>
            Disabled
          </Badge>
        )}
      </Group>

      <Text size="sm" c="dimmed" mb="md">
        Receive push notifications when Elysium is running in the background.
        Works even when the browser tab is closed.
      </Text>

      {status === "denied" ? (
        <Alert color="red" variant="light">
          <Text size="sm">
            Notifications have been blocked. To re-enable them, click the lock
            icon in your browser address bar and allow notifications for this
            site.
          </Text>
        </Alert>
      ) : (
        <Stack gap="sm">
          {!isSubscribed ? (
            <Button
              leftSection={<IconBell size={16} />}
              onClick={subscribe}
              loading={status === "loading"}
            >
              Enable Push Notifications
            </Button>
          ) : (
            <>
              <Text size="sm" c="green">
                ✓ You will receive push notifications from Elysium.
              </Text>
              <Divider />
              <Button
                variant="outline"
                color="red"
                size="xs"
                leftSection={<IconBellOff size={14} />}
                onClick={unsubscribe}
              >
                Disable Notifications
              </Button>
            </>
          )}
        </Stack>
      )}
    </Box>
  );
});
