import { Button, Flex, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";

import { db } from "../database";
import { getPlaylist, getPlaylists } from "../database/utils";
import { getMapping } from "../utils/invidiousMappings";
import { useIsLocalPlaylist } from "../hooks/useIsLocalPlaylist";
import { useSetPlaylists } from "../providers/Playlist";
import { useSettings } from "../providers/Settings";
import { usePresenceContext } from "../providers/Presence";
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
    const { sendVideoDelete } = usePresenceContext();

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
          videoCount: updatedVideos.length,
        }),
      );
      db.commit();

      // Propagate deletion to all paired devices (online = immediate, offline = queued)
      sendVideoDelete(
        (playlist as any).syncId ?? "",
        playlist.title,
        video.videoId,
      );

      setPlaylists(getPlaylists());

      // Sync removal to Invidious if this playlist has a mapping
      if (creds && playlistId) {
        const invId = getMapping(playlistId);
        if (invId) {
          // Invidious DELETE requires the video's indexId, NOT videoId.
          // Fetch the remote playlist to find the correct indexId for this video.
          fetch(`/api/invidious/playlists/${invId}`, {
            headers: {
              "X-Invidious-Instance": creds.instanceUrl,
              "X-Invidious-SID": creds.sid,
              "Content-Type": "application/json",
            },
          })
            .then(r => r.ok ? r.json() : null)
            .then(remote => {
              const remoteVideo = (remote?.videos ?? []).find((v: any) => v.videoId === video.videoId);
              const indexId: string | undefined = remoteVideo?.indexId;
              if (!indexId) return; // video not in remote playlist, nothing to do
              return removeVideoFromInvidiousPlaylist(creds, invId, indexId);
            })
            .catch(() => {
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
