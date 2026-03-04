import { Button, Flex, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";

import { db } from "../database";
import { getPlaylist, getPlaylists } from "../database/utils";
import { useIsLocalPlaylist } from "../hooks/useIsLocalPlaylist";
import { useSetPlaylists } from "../providers/Playlist";
import { useSettings } from "../providers/Settings";
import { removeVideoFromInvidiousPlaylist, type InvidiousCredentials } from "../services/invidiousAuth";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import type { CardVideo } from "../types/interfaces/Card";
import type { Playlist } from "../types/interfaces/Playlist";
import { Modal } from "./Modal";

interface ModalDeleteFromPlaylistProps {
  opened: boolean;
  onClose: () => void;
  video: CardVideo;
}

export const ModalDeleteFromPlaylist: FC<ModalDeleteFromPlaylistProps> = memo(
  ({ opened, onClose, video }) => {
    const setPlaylists = useSetPlaylists();
    const settings = useSettings();
    const { playlistId } = useIsLocalPlaylist();
    const { t } = useTranslation();

    const isLoggedIn = !!settings.invidiousSid && !!settings.invidiousUsername;
    const creds: InvidiousCredentials | null = isLoggedIn
      ? {
          instanceUrl: normalizeInstanceUri(settings.invidiousLoginInstance ?? settings.currentInstance?.uri ?? ""),
          sid: settings.invidiousSid!,
          username: settings.invidiousUsername!,
        }
      : null;

    const handleDeleteVideo = () => {
      const playlist = getPlaylist(Number(playlistId));

      if (!playlist) {
        notifications.show({
          title: "Error",
          message: t("Playlist not found"),
          color: "red",
        });
        throw Error(t("Playlist not found") as string);
      }

      const updatedVideos = (playlist.videos as CardVideo[]).filter(
        (v) => v.videoId !== video.videoId,
      );

      db.update(
        "playlists",
        {
          ID: playlistId,
        },
        (row: Playlist) => ({
          ...row,
          videos: updatedVideos,
        }),
      );
      db.commit();
      setPlaylists(getPlaylists());

      // Sync removal to Invidious if this playlist has a mapping
      if (creds && playlistId) {
        const invId = settings.invidiousPlaylistMappings?.[Number(playlistId)];
        if (invId) {
          removeVideoFromInvidiousPlaylist(creds, invId, video.videoId).catch(() => {
            // Silent fail — local change already persisted
          });
        }
      }

      notifications.show({
        title: t("modal.video.delete.playlist.notification.title"),
        message: `${video.title} ${t(
          "modal.video.delete.playlist.notification.message",
        )}`,
      });

      onClose();
    };

    return (
      <Modal
        opened={opened}
        onClose={() => onClose()}
        centered
        size="lg"
        title={t("modal.video.delete.playlist.title")}
        overlayProps={{
          blur: 3,
        }}
      >
        <Text>
          {t("modal.video.delete.playlist.text")} <strong>{video.title}</strong>{" "}
          {t("modal.video.delete.playlist.text2")}
        </Text>
        <Flex gap={8} justify="flex-end" mt="xl">
          <Button onClick={() => onClose()} color="gray">
            {t("button.cancel")}
          </Button>
          <Button onClick={handleDeleteVideo} color="red">
            {t("modal.video.delete.playlist.button.submit")}
          </Button>
        </Flex>
      </Modal>
    );
  },
);
