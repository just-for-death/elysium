import { ActionIcon, Box, Flex, Tooltip } from "@mantine/core";
import { IconSettings, IconWifi, IconWifiOff } from "@tabler/icons-react";
import { memo } from "react";

import { usePresenceContext } from "../providers/Presence";
import { useStableNavigate } from "../providers/Navigate";
import classes from "./Header.module.css";
import { SearchBar } from "./SearchBar";
import { SearchFilters } from "./SearchFiltersMenu";

const PresenceIndicator = memo(() => {
  const { wsConnected: online } = usePresenceContext();
  return (
    <Tooltip label={online ? "Sync connected" : "Sync offline"} withArrow position="bottom">
      <ActionIcon
        variant="filled"
        radius="md"
        color="gray"
        style={{ height: 36, width: 36, opacity: online ? 1 : 0.5 }}
        aria-label="Sync status"
      >
        {online ? <IconWifi size={18} /> : <IconWifiOff size={18} />}
      </ActionIcon>
    </Tooltip>
  );
});

export const Header = memo(() => {
  const navigate = useStableNavigate();

  return (
    <header className={classes.container}>
      <SearchBar />
      <Flex gap={8} align="center">
        {/* Apple Music toggle + filter — from SearchFilters */}
        <SearchFilters />
        {/* Linked device / wifi — next to Apple icon */}
        <Box visibleFrom="sm">
          <PresenceIndicator />
        </Box>
        {/* Settings — replaces light/dark toggle */}
        <Tooltip label="Settings" withArrow position="bottom">
          <ActionIcon
            variant="filled"
            radius="md"
            color="gray"
            style={{ height: 36, width: 36 }}
            onClick={() => navigate("/settings")}
            aria-label="Settings"
          >
            <IconSettings size={18} />
          </ActionIcon>
        </Tooltip>
      </Flex>
    </header>
  );
});
