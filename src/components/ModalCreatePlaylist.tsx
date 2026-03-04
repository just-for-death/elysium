import { ActionIcon, Button, Flex, TextInput, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlus } from "@tabler/icons-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { db } from "../database";
import { getPlaylists } from "../database/utils";
import { useSetPlaylists } from "../providers/Playlist";
import { useSettings, useSetSettings } from "../providers/Settings";
import { createInvidiousPlaylist } from "../services/invidiousAuth";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import { Form } from "./Form";
import { Modal } from "./Modal";

export const ModalCreatePlaylist = memo(() => {
  const [opened, setOpened] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState("");
  const setPlaylists = useSetPlaylists();
  const settings = useSettings();
  const setSettings = useSetSettings();
  const { t } = useTranslation();

  const isInvLoggedIn = !!settings.invidiousSid && !!settings.invidiousUsername && settings.invidiousAutoPush;

  const handleAddToPlaylist = async () => {
    db.insert("playlists", {
      createdAt: new Date().toISOString(),
      title: playlistTitle,
      videos: [],
      videoCount: 0,
      type: "playlist",
    });
    db.commit();

    const allPlaylists = getPlaylists();
    setPlaylists(allPlaylists);
    setOpened(false);

    notifications.show({
      title: t("modal.create.playlist.notification.title"),
      message: `${playlistTitle} ${t("modal.create.playlist.notification.message")}`,
    });

    // Auto-push to Invidious if enabled
    if (isInvLoggedIn) {
      const newPl = allPlaylists.find(p => p.title === playlistTitle && p.ID);
      if (newPl?.ID) {
        try {
          const creds = {
            instanceUrl: normalizeInstanceUri(settings.invidiousLoginInstance ?? settings.currentInstance?.uri ?? ""),
            sid: settings.invidiousSid!,
            username: settings.invidiousUsername!,
          };
          const invId = await createInvidiousPlaylist(creds, playlistTitle, "private");
          if (invId) {
            const updatedMappings = { ...settings.invidiousPlaylistMappings, [newPl.ID]: invId };
            setSettings((prev: any) => ({ ...prev, invidiousPlaylistMappings: updatedMappings }));
            db.update("settings", { ID: 1 }, () => ({ invidiousPlaylistMappings: updatedMappings }));
            db.commit();
            notifications.show({
              title: "Invidious",
              message: `"${playlistTitle}" created on Invidious and linked for auto-sync.`,
              color: "teal",
              autoClose: 4000,
            });
          }
        } catch {
          // Silent — local playlist already created
        }
      }
    }
  };

  return (
    <>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        centered
        size="lg"
        title={t("create.playlist.title")}
      >
        <Form label="Form create playlist" onSubmit={handleAddToPlaylist}>
          <TextInput
            data-autofocus
            placeholder={t("modal.create.playlist.input.placeholder") as string}
            label={t("modal.create.playlist.input.placeholder")}
            onChange={(event) => setPlaylistTitle(event.target.value)}
          />
          <Flex gap={8} justify="flex-end" mt="xl">
            <Button onClick={() => setOpened(false)} color="gray">
              {t("button.cancel")}
            </Button>
            <Button type="submit" disabled={playlistTitle.length === 0}>
              {t("modal.create.playlist.button.submit")}
            </Button>
          </Flex>
        </Form>
      </Modal>
      <Tooltip label={t("create.playlist.title")} position="left">
        <ActionIcon
          aria-label="Open modal to create playlist"
          onClick={() => setOpened(true)}
          variant="filled"
          radius="xl"
          size="lg"
        >
          <IconPlus size={20} />
        </ActionIcon>
      </Tooltip>
    </>
  );
});
