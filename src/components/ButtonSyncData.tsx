/**
 * ButtonSyncData — sidebar sync button
 *
 * Shows a live status indicator:
 *   - Pulsing green dot  → WS connected & linked devices exist
 *   - Static blue dot    → WS connected, no linked devices
 *   - Gray dot           → WS disconnected / no linked devices
 *
 * Click opens the sync modal (legacy 6-digit pull) OR, if the user has
 * linked devices, triggers an instant push and shows the SyncSettings panel.
 */

import { Indicator, Tooltip } from "@mantine/core";
import { IconCloudDownload, IconCloudUpload } from "@tabler/icons-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { usePresenceContext } from "../providers/Presence";
import { ModalSyncData }     from "./ModalSyncData";
import { NavbarLink }        from "./NavbarLink";

export const ButtonSyncData = memo(() => {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const { wsConnected, devicePresences, pushInstantSync } = usePresenceContext();

  const linkedCount = Object.keys(devicePresences).length;
  const anyOnline   = Object.values(devicePresences).some((d) => d.online);

  // Indicator color
  const color     = wsConnected && linkedCount > 0 ? (anyOnline ? "teal" : "blue") : "gray";
  const pulsing   = wsConnected && anyOnline;

  const handleClick = () => {
    if (linkedCount > 0 && wsConnected) {
      // Instant push to all linked devices
      pushInstantSync();
    } else {
      // Fall back to legacy 6-digit modal
      setOpened((s) => !s);
    }
  };

  const label = linkedCount > 0 && wsConnected
    ? `Sync now (${linkedCount} linked device${linkedCount === 1 ? "" : "s"})`
    : t("navigation.sync");

  return (
    <>
      <Tooltip label={label} position="right">
        <Indicator color={color} processing={pulsing} size={8} offset={4}>
          <NavbarLink
            icon={linkedCount > 0 && wsConnected ? IconCloudUpload : IconCloudDownload}
            label={label}
            onClick={handleClick}
          />
        </Indicator>
      </Tooltip>
      {/* Legacy modal — only shown when no linked devices */}
      {!linkedCount && (
        <ModalSyncData opened={opened} onClose={() => setOpened(false)} />
      )}
    </>
  );
});
