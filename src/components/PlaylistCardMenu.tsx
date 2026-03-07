import {
  ActionIcon,
  Loader,
  Menu,
  Tooltip,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowUp,
  IconBrandYoutube,
  IconCopy,
  IconDatabase,
  IconDotsVertical,
  IconEdit,
  IconExternalLink,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { type FC, memo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CardPlaylist, CardVideo } from "../types/interfaces/Card";
import { useSettings } from "../providers/Settings";
import { useSetPlaylists } from "../providers/Playlist";
import { db } from "../database";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import { pushPlaylistToInvidious, syncPlaylistToInvidious } from "../services/invidiousAuth";
import { getMapping, setMapping } from "../utils/invidiousMappings";
import { getPlaylists } from "../database/utils";
import { ModalDeletePlaylist } from "./ModalDeletePlaylist";
import { ModalUpdatePlaylist } from "./ModalUpdatePlaylist";

interface PlaylistCardMenuProps {
  playlist: CardPlaylist;
}

export const PlaylistCardMenu: FC<PlaylistCardMenuProps> = memo(({ playlist }) => {
  const [menuOpened,        setMenuOpened]        = useState(false);
  const [modalUpdateOpened, setModalUpdateOpened] = useState(false);
  const [modalDeleteOpened, setModalDeleteOpened] = useState(false);
  const [pushingToInv,      setPushingToInv]      = useState(false);

  const { t }     = useTranslation();
  const clipboard = useClipboard();
  const settings  = useSettings();
  const setPlaylists = useSetPlaylists();

  const isCachePlaylist =
    (playlist as any).type === "cache" || playlist.title === "Cache";

  if (isCachePlaylist) {
    return (
      <ActionIcon
        variant="transparent"
        color="teal"
        style={{ marginLeft: "auto", marginRight: -8 }}
        title="Cache playlist"
      >
        <IconDatabase size={18} />
      </ActionIcon>
    );
  }

  const invidiousBase = normalizeInstanceUri(settings.currentInstance?.uri ?? "");

  // playlistId is set on remote playlists (YouTube PL… ID)
  // local playlists only have ID (numeric DB key)
  const shareId      = playlist.playlistId ?? null;
  const isLocalOnly  = !shareId;
  const isInvLogged  = !!settings.invidiousSid && !!settings.invidiousUsername;

  // ── Share handlers (remote playlists only) ──────────────────────────────

  const handleCopyInvidious = () => {
    if (!shareId) return;
    clipboard.copy(`${invidiousBase}/playlist?list=${shareId}`);
    notifications.show({ title: "Copied", message: "Invidious playlist link copied.", autoClose: 2500 });
    setMenuOpened(false);
  };

  const handleCopyYouTube = () => {
    if (!shareId) return;
    clipboard.copy(`https://www.youtube.com/playlist?list=${shareId}`);
    notifications.show({ title: "Copied", message: "YouTube playlist link copied.", autoClose: 2500 });
    setMenuOpened(false);
  };

  const handleOpenInvidious = () => {
    if (!shareId) return;
    window.open(`${invidiousBase}/playlist?list=${shareId}`, "_blank");
    setMenuOpened(false);
  };

  // ── Share handler for LOCAL playlists — generate Invidious link after push ─

  const handleShareLocalViaInvidious = async () => {
    if (!isInvLogged) {
      notifications.show({
        title: "Not logged in",
        message: "Log in to your Invidious account in Settings → Invidious Account first.",
        color: "orange",
      });
      setMenuOpened(false);
      return;
    }

    setPushingToInv(true);
    setMenuOpened(false);

    try {
      const creds = {
        instanceUrl: settings.invidiousLoginInstance ?? settings.currentInstance?.uri ?? "",
        sid:         settings.invidiousSid!,
        username:    settings.invidiousUsername!,
      };
      const videos = playlist.videos as CardVideo[];

      // Check for an existing mapping — reuse it instead of creating a new playlist every time
      const sharingLocalId = (playlist as any).ID as number | undefined;
      const existingShareInvId = sharingLocalId ? getMapping(sharingLocalId) : undefined;

      let shareInvId: string;
      if (existingShareInvId) {
        // Already pushed — sync (additive) then add missing videos.
        // Returns false if remote was deleted — in that case recreate it.
        const stillExists = await syncPlaylistToInvidious(creds, existingShareInvId, videos);
        if (stillExists) {
          shareInvId = existingShareInvId;
        } else {
          // Remote was deleted — recreate as unlisted and remap
          shareInvId = await pushPlaylistToInvidious(creds, playlist.title, videos, "unlisted");
          if (sharingLocalId) setMapping(sharingLocalId, shareInvId);
        }
        setPlaylists(getPlaylists());
      } else {
        shareInvId = await pushPlaylistToInvidious(creds, playlist.title, videos, "unlisted");
        if (sharingLocalId) setMapping(sharingLocalId, shareInvId);
        setPlaylists(getPlaylists());
      }

      const link = `${normalizeInstanceUri(creds.instanceUrl)}/playlist?list=${shareInvId}`;
      clipboard.copy(link);
      notifications.show({
        title: "Shared via Invidious",
        message: `Link copied! "${playlist.title}" is now an unlisted playlist on ${creds.instanceUrl}.`,
        color: "teal",
        autoClose: 8000,
      });
    } catch (e: any) {
      notifications.show({
        title: "Share failed",
        message: e?.message ?? "Unknown error pushing to Invidious.",
        color: "red",
      });
    } finally {
      setPushingToInv(false);
    }
  };

  // ── Push to Invidious (first time) or Sync (already pushed) ──────────────

  const localId = (playlist as any).ID as number | undefined;
  const existingInvId = localId ? getMapping(localId) : undefined;
  const alreadyPushed = !!existingInvId;

  const handlePushToInvidious = async () => {
    if (!isInvLogged) {
      notifications.show({
        title: "Not logged in",
        message: "Log in to Invidious in Settings → Invidious Account first.",
        color: "orange",
      });
      setMenuOpened(false);
      return;
    }

    setPushingToInv(true);
    setMenuOpened(false);

    try {
      const creds = {
        instanceUrl: settings.invidiousLoginInstance ?? settings.currentInstance?.uri ?? "",
        sid:         settings.invidiousSid!,
        username:    settings.invidiousUsername!,
      };
      const videos = playlist.videos as CardVideo[];

      if (alreadyPushed) {
        // Already linked — sync (additive) then add missing videos.
        // syncPlaylistToInvidious returns false when the remote playlist no longer
        // exists (deleted on Invidious). In that case recreate it and remap.
        const stillExists = await syncPlaylistToInvidious(creds, existingInvId!, videos);
        if (!stillExists) {
          // Remote playlist was deleted — recreate and update mapping
          const privacy = (settings as any).invidiousPlaylistPrivacy ?? "private";
          const newId = await pushPlaylistToInvidious(creds, playlist.title, videos, privacy);
          if (localId && newId) setMapping(localId, newId);
        }
        setPlaylists(getPlaylists());
        notifications.show({
          title: stillExists ? "Synced to Invidious" : "Recreated on Invidious",
          message: stillExists
            ? `"${playlist.title}" — changes synced to your Invidious playlist.`
            : `"${playlist.title}" — remote playlist was gone, recreated it.`,
          color: "teal",
          autoClose: 6000,
        });
      } else {
        // First push — create new playlist and save the mapping
        const newId = await pushPlaylistToInvidious(creds, playlist.title, videos, "private");
        if (localId && newId) {
          setMapping(localId, newId);
          setPlaylists(getPlaylists()); // refresh context so menu shows "Sync" next time
        }
        notifications.show({
          title: "Pushed to Invidious",
          message: `"${playlist.title}" saved as a private playlist on your Invidious account.`,
          color: "teal",
          autoClose: 6000,
        });
      }
    } catch (e: any) {
      notifications.show({
        title: alreadyPushed ? "Sync failed" : "Push failed",
        message: e?.message ?? "Unknown error.",
        color: "red",
      });
    } finally {
      setPushingToInv(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (pushingToInv) {
    return (
      <Tooltip label="Pushing to Invidious…">
        <ActionIcon variant="transparent" style={{ marginLeft: "auto", marginRight: -8 }}>
          <Loader size={16} color="teal" />
        </ActionIcon>
      </Tooltip>
    );
  }

  return (
    <>
      <Menu
        opened={menuOpened}
        onChange={setMenuOpened}
        shadow="md"
        width={240}
        aria-label="Open playlist menu"
        styles={{
          dropdown: {
            backgroundColor: "var(--sp-surface, #181818)",
            border: "1px solid rgba(255,255,255,0.08)",
          },
          item: {
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontSize: "14px",
            fontWeight: 500,
          },
          label: {
            fontSize: "10px",
            letterSpacing: "1px",
            textTransform: "uppercase",
          },
        }}
      >
        <Menu.Target>
          <ActionIcon
            onClick={() => setMenuOpened(true)}
            variant="transparent"
            color="gray"
            style={{ marginLeft: "auto", marginRight: -8 }}
          >
            <IconDotsVertical size={18} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>{t("playlist.nemu.title")}</Menu.Label>

          {/* ── Remote playlist share ── */}
          {shareId && (
            <>
              <Menu.Item leftSection={<IconCopy size={14} />} onClick={handleCopyInvidious}>
                Copy Invidious link
              </Menu.Item>
              <Menu.Item leftSection={<IconBrandYoutube size={14} />} onClick={handleCopyYouTube}>
                Copy YouTube link
              </Menu.Item>
              <Menu.Item leftSection={<IconExternalLink size={14} />} onClick={handleOpenInvidious}>
                Open on Invidious
              </Menu.Item>
              <Menu.Divider />
            </>
          )}

          {/* ── Local playlist Invidious actions ── */}
          {isLocalOnly && (
            <>
              <Menu.Item
                leftSection={<IconCopy size={14} />}
                onClick={handleShareLocalViaInvidious}
                style={{ color: "#2ab5a5" }}
                disabled={!playlist.videos?.length}
              >
                Share via Invidious link
              </Menu.Item>
              <Menu.Item
                leftSection={alreadyPushed ? <IconRefresh size={14} /> : <IconArrowUp size={14} />}
                onClick={handlePushToInvidious}
                disabled={!playlist.videos?.length || pushingToInv}
              >
                {alreadyPushed ? "Sync to Invidious" : "Push to Invidious account"}
              </Menu.Item>
              <Menu.Divider />
            </>
          )}

          {/* ── Edit (local only) ── */}
          {isLocalOnly && (
            <Menu.Item
              leftSection={<IconEdit size={14} />}
              onClick={() => { setModalUpdateOpened(true); setMenuOpened(false); }}
            >
              {t("playlist.nemu.edit")}
            </Menu.Item>
          )}

          <Menu.Item
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => { setModalDeleteOpened(true); setMenuOpened(false); }}
          >
            {t("playlist.nemu.delete")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <ModalUpdatePlaylist
        opened={modalUpdateOpened}
        onClose={() => setModalUpdateOpened(false)}
        playlist={playlist}
      />
      <ModalDeletePlaylist
        opened={modalDeleteOpened}
        onClose={() => setModalDeleteOpened(false)}
        playlist={playlist}
      />
    </>
  );
});

