import { ActionIcon, Menu } from "@mantine/core";
import {
  IconDownload,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlaylistAdd,
  IconPlus,
  IconShare,
  IconTrash,
} from "@tabler/icons-react";
import { type FC, memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useIsLocalPlaylist } from "../hooks/useIsLocalPlaylist";
import { useQueueVideo } from "../hooks/useQueueVideo";
import { usePlayerVideo } from "../providers/Player";
import type { CardVideo } from "../types/interfaces/Card";
import { ModalAddToPlaylist } from "./ModalAddToPlaylist";
import { ModalDeleteFromPlaylist } from "./ModalDeleteFromPlaylist";

interface CardMenuProps {
  card: CardVideo;
}

export const CardMenu: FC<CardMenuProps> = memo(({ card }) => {
  const [addToPlaylistModalOpened, setAddToPlaylistModalOpened] =
    useState(false);
  const [deleteFromPlaylistModalOpened, setDeleteFromPlaylistModalOpened] =
    useState(false);
  const { isRemotePlaylistDetail, isLocalPlaylist } = useIsLocalPlaylist();
  const { video: currentVideo } = usePlayerVideo();
  const { addNext, addLast } = useQueueVideo();
  const { t } = useTranslation();

  const hasQueue = !!currentVideo;

  return (
    <>
      <Menu aria-label="Card menu" shadow="md" width={220}>
        <Menu.Target>
          <ActionIcon variant="default" radius="md" size={36}>
            <IconPlus size={18} stroke={1.5} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {/* Queue actions — only shown when something is playing */}
          {hasQueue && (
            <>
              <Menu.Label>Queue</Menu.Label>
              <Menu.Item
                leftSection={<IconPlayerSkipForward size={14} />}
                onClick={() => addNext(card)}
                aria-label="Play next"
              >
                Play next
              </Menu.Item>
              <Menu.Item
                leftSection={<IconPlaylistAdd size={14} />}
                onClick={() => addLast(card)}
                aria-label="Add to queue"
              >
                Add to queue
              </Menu.Item>
              <Menu.Divider />
            </>
          )}

          {/* Playlist actions */}
          {!isRemotePlaylistDetail ? (
            <>
              <Menu.Label>{t("menu.video.settings")}</Menu.Label>
              {isLocalPlaylist ? (
                <Menu.Item
                  onClick={() => setDeleteFromPlaylistModalOpened(true)}
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  aria-label={t("menu.video.remove.playlist")}
                >
                  {t("menu.video.remove.playlist")}
                </Menu.Item>
              ) : (
                <Menu.Item
                  onClick={() => setAddToPlaylistModalOpened(true)}
                  leftSection={<IconPlayerPlay size={14} />}
                  aria-label={t("menu.video.add.playlist")}
                >
                  {t("menu.video.add.playlist")}
                </Menu.Item>
              )}
            </>
          ) : null}

          <Menu.Label>{t("menu.video.other")}</Menu.Label>
          <Menu.Item leftSection={<IconDownload size={14} />}>
            {t("menu.video.download")}
          </Menu.Item>
          <Menu.Item leftSection={<IconShare size={14} />}>
            {t("menu.video.share")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <ModalAddToPlaylist
        opened={addToPlaylistModalOpened}
        onClose={() => setAddToPlaylistModalOpened(false)}
        video={card}
      />
      <ModalDeleteFromPlaylist
        opened={deleteFromPlaylistModalOpened}
        onClose={() => setDeleteFromPlaylistModalOpened(false)}
        video={card}
      />
    </>
  );
});
