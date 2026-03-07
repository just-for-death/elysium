import {
  ActionIcon,
  Menu,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlaylistAdd, IconPlus } from "@tabler/icons-react";
import { memo, useCallback } from "react";

import { db } from "../database";
import { getPlaylist, getPlaylists } from "../database/utils";
import { getMapping } from "../utils/invidiousMappings";
import { usePlayerVideo } from "../providers/Player";
import { usePlaylists, useSetPlaylists } from "../providers/Playlist";
import { useSettings } from "../providers/Settings";
import { addVideoToInvidiousPlaylist } from "../services/invidiousAuth";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import type { CardVideo } from "../types/interfaces/Card";
import type { Playlist } from "../types/interfaces/Playlist";

/**
 * Add the currently playing song to any existing playlist.
 * Renders as an icon button with a dropdown menu in the player.
 */
export const ButtonAddToPlaylist = memo(() => {
  const playerVideo = usePlayerVideo();
  const playlists = usePlaylists();
  const setPlaylists = useSetPlaylists();
  const settings = useSettings();

  const handleAddToPlaylist = useCallback(
    (playlist: Playlist) => {
      if (!playerVideo?.video) return;

      const v = playerVideo.video;
      const card: CardVideo = {
        type: "video",
        videoId: v.videoId,
        title: v.title,
        thumbnail:
          playerVideo.thumbnailUrl ??
          `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        liveNow: v.liveNow ?? false,
        lengthSeconds: v.lengthSeconds ?? 0,
        videoThumbnails: [],
      };

      const existing = getPlaylist(playlist.ID as number);
      const videos: CardVideo[] = Array.isArray(existing?.videos)
        ? (existing.videos as CardVideo[])
        : [];

      // Avoid duplicate entries
      const alreadyIn = videos.some((item) => item.videoId === card.videoId);
      if (alreadyIn) {
        notifications.show({
          message: `"${v.title}" is already in "${playlist.title}"`,
          color: "yellow",
          autoClose: 3000,
        });
        return;
      }

      const updated = [...videos, card];
      db.update("playlists", { ID: playlist.ID }, (raw: Playlist) => ({
        ...raw,
        videos: updated,
        videoCount: updated.length,
      }));
      db.commit();
      setPlaylists(getPlaylists());

      // Sync the newly added video to Invidious if the playlist has a mapping
      if (playlist.ID && settings?.invidiousSid && settings?.invidiousUsername) {
        const invId = getMapping(playlist.ID);
        if (invId) {
          addVideoToInvidiousPlaylist(
            {
              instanceUrl: normalizeInstanceUri(settings.invidiousLoginInstance ?? settings.currentInstance?.uri ?? ""),
              sid: settings.invidiousSid,
              username: settings.invidiousUsername,
            },
            invId,
            card.videoId,
          ).catch(() => {
            // Silent fail — local change already persisted
          });
        }
      }

      notifications.show({
        message: `Added "${v.title}" to "${playlist.title}"`,
        color: "teal",
        autoClose: 3000,
      });
    },
    [playerVideo, setPlaylists, settings],
  );

  if (!playerVideo?.video) return null;

  // Only show playlists that aren't system playlists
  const userPlaylists = playlists.filter(
    (p) => p.title !== "Favorites" && p.type !== "cache",
  );

  return (
    <Menu shadow="md" width={220} position="top" withArrow>
      <Menu.Target>
        <ActionIcon
          variant="transparent"
          c="white"
          aria-label="Add to playlist"
          title="Add to playlist"
        >
          <IconPlaylistAdd size={20} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Add to playlist</Menu.Label>
        {userPlaylists.length === 0 ? (
          <Menu.Item disabled>
            <Text size="sm" c="dimmed">
              No playlists yet
            </Text>
          </Menu.Item>
        ) : (
          userPlaylists.map((playlist) => (
            <Menu.Item
              key={playlist.ID ?? playlist.title}
              leftSection={<IconPlus size={14} />}
              onClick={() => handleAddToPlaylist(playlist)}
            >
              {playlist.title}
            </Menu.Item>
          ))
        )}
      </Menu.Dropdown>
    </Menu>
  );
});
