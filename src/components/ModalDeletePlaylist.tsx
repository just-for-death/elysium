import { Box, Button, Flex, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";

import { db } from "../database";
import { getPlaylists } from "../database/utils";
import { getMapping, deleteMapping } from "../utils/invidiousMappings";
import { useSetPlaylists } from "../providers/Playlist";
import { useSettings, useSetSettings } from "../providers/Settings";
import { deleteInvidiousPlaylist } from "../services/invidiousAuth";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import type { CardPlaylist } from "../types/interfaces/Card";
import { Modal } from "./Modal";

interface ModalDeletePlaylistProps {
  opened: boolean;
  onClose: () => void;
  playlist: CardPlaylist;
}

export const ModalDeletePlaylist: FC<ModalDeletePlaylistProps> = memo(
  ({ opened, onClose, playlist }) => {
    const setPlaylists = useSetPlaylists();
    const settings = useSettings();
    const setSettings = useSetSettings();
    const { t } = useTranslation();

    const handleDeletePlaylist = async () => {
      // Remove Invidious mapping before deleting locally
      const invId = playlist.ID ? getMapping(playlist.ID) : undefined;

      db.deleteRows("playlists", { ID: playlist.ID });
      db.commit();
      setPlaylists(getPlaylists());

      // Clean up mapping entry
      if (playlist.ID && getMapping(playlist.ID)) {
        deleteMapping(playlist.ID);
      }

      notifications.show({
        title: t("modal.playlist.delete.notification.title"),
        message: `${playlist.title} ${t("modal.playlist.delete.notification.message")}`,
      });

      // Auto-delete from Invidious if logged in and mapping exists
      if (invId && settings.invidiousSid && settings.invidiousUsername) {
        try {
          const creds = {
            instanceUrl: normalizeInstanceUri(settings.invidiousLoginInstance ?? settings.currentInstance?.uri ?? ""),
            sid: settings.invidiousSid,
            username: settings.invidiousUsername,
          };
          await deleteInvidiousPlaylist(creds, invId);
          notifications.show({
            title: "Invidious",
            message: `"${playlist.title}" also deleted from Invidious.`,
            color: "teal",
            autoClose: 3000,
          });
        } catch {
          // Silent — local deletion already done
        }
      }

      onClose();
    };

    return (
      <Modal
        opened={opened}
        onClose={() => onClose()}
        centered
        size="lg"
        title={t("modal.playlist.delete.title")}
        overlayProps={{ blur: 3 }}
      >
        <Box role="form" aria-label={t("modal.playlist.delete.button.submit")}>
          <Text>
            {t("modal.playlist.delete.text")} <strong>{playlist.title}</strong>{" "}
            {t("modal.playlist.delete.text2")} ?
          </Text>
          <Flex gap={8} justify="flex-end" mt="xl">
            <Button onClick={() => onClose()} color="gray">
              {t("button.cancel")}
            </Button>
            <Button onClick={handleDeletePlaylist} color="red">
              {t("modal.playlist.delete.button.submit")}
            </Button>
          </Flex>
        </Box>
      </Modal>
    );
  },
);
