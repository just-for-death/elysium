/**
 * InvidiousAccountSettings
 *
 * Settings panel for Invidious account login and playlist sync.
 *
 * Features:
 *  • Login with username + password against any Invidious instance
 *    (defaults to the currently selected instance)
 *  • Persist token + username + instance URL in settings DB
 *  • Pull playlists FROM Invidious → import as local Elysium playlists
 *  • Push local Elysium playlists → Invidious (creates new playlists)
 *  • Logout (revokes token server-side)
 *
 * Auth API: POST /api/v1/auth/tokens/register
 * Docs: https://docs.invidious.io/api/
 */

import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Group,
  Loader,
  PasswordInput,
  Progress,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconExternalLink,
  IconLogin,
  IconLogout,
  IconRefresh,
  IconUser,
} from "@tabler/icons-react";
import { memo, useCallback, useEffect, useState } from "react";

import { db } from "../database";
import { getPlaylists, updatePlaylistVideos } from "../database/utils";
import { usePlaylists, useSetPlaylists } from "../providers/Playlist";
import { useSettings, useSetSettings } from "../providers/Settings";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import {
  loginInvidious,
  logoutInvidious,
  fetchInvidiousPlaylists,
  pushPlaylistToInvidious,
  syncPlaylistToInvidious,
  type InvidiousCredentials,
  type InvidiousPlaylist,
} from "../services/invidiousAuth";

import type { Playlist } from "../types/interfaces/Playlist";
import { getMappings, getMapping, setMapping, setMappings } from "../utils/invidiousMappings";
import { acquirePushLock, releasePushLock } from "../services/invidiousAuth";
import type { CardVideo } from "../types/interfaces/Card";

// ─── Privacy options ──────────────────────────────────────────────────────────

const PRIVACY_OPTIONS = [
  { value: "private",   label: "Private" },
  { value: "unlisted",  label: "Unlisted" },
  { value: "public",    label: "Public" },
];

// ─── Main component ───────────────────────────────────────────────────────────

export const InvidiousAccountSettings = memo(() => {
  const settings    = useSettings();
  const setSettings = useSetSettings();

  const isLoggedIn = !!settings.invidiousSid && !!settings.invidiousUsername;

  const creds: InvidiousCredentials | null = isLoggedIn
    ? {
        instanceUrl: settings.invidiousLoginInstance ?? settings.currentInstance?.uri ?? "",
        sid:         settings.invidiousSid!,
        username:    settings.invidiousUsername!,
      }
    : null;

  // ── Track fresh login so LoggedInPanel can auto-push ─────────────────────
  const [justLoggedIn, setJustLoggedIn] = useState(false);

  // ── Persist helpers ────────────────────────────────────────────────────────

  const persist = useCallback(
    (patch: Partial<typeof settings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      db.update("settings", { ID: 1 }, (row: any) => ({ ...row, ...patch }));
      db.commit();
    },
    [setSettings],
  );

  return isLoggedIn && creds ? (
    <LoggedInPanel
      creds={creds}
      persist={persist}
      autoSync={justLoggedIn}
      onAutoSyncDone={() => setJustLoggedIn(false)}
    />
  ) : (
    <LoginPanel persist={persist} onLoginSuccess={() => setJustLoggedIn(true)} />
  );
});

// ─── Login panel ──────────────────────────────────────────────────────────────

interface LoginPanelProps {
  persist: (patch: Record<string, unknown>) => void;
  onLoginSuccess: () => void;
}

const LoginPanel = memo(({ persist, onLoginSuccess }: LoginPanelProps) => {
  const settings = useSettings();

  const defaultInstance = normalizeInstanceUri(
    settings.currentInstance?.uri ?? "https://invidious.io",
  );

  const [instanceUrl, setInstanceUrl] = useState(defaultInstance);
  const [username,    setUsername]    = useState("");
  const [password,    setPassword]    = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const handleLogin = async () => {
    if (!instanceUrl.trim() || !username.trim() || !password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loginInvidious(instanceUrl.trim(), username.trim(), password.trim());
      if (result.success && result.sid) {
        persist({
          invidiousSid:         result.sid,
          invidiousUsername:      result.username ?? username.trim(),
          invidiousLoginInstance: normalizeInstanceUri(instanceUrl.trim()),
        });
        onLoginSuccess();
        notifications.show({
          title: "Invidious",
          message: `Logged in as ${result.username ?? username}`,
          color: "teal",
        });
      } else {
        setError(result.error ?? "Login failed. Check your credentials.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack gap="sm">
      <Alert color="blue" variant="light" p="sm">
        <Text size="sm">
          Log in with your{" "}
          <Anchor href="https://docs.invidious.io/" target="_blank" size="sm">
            Invidious
          </Anchor>{" "}
          account to sync playlists between Elysium and your Invidious instance.
          Your password is only used to obtain a session token and is never stored.
        </Text>
      </Alert>

      <TextInput
        label="Invidious instance"
        description="Defaults to your currently selected instance"
        placeholder="https://invidious.io"
        value={instanceUrl}
        onChange={e => setInstanceUrl(e.currentTarget.value)}
        size="sm"
      />

      <TextInput
        label="Username"
        placeholder="Your Invidious username"
        value={username}
        onChange={e => setUsername(e.currentTarget.value)}
        size="sm"
        autoComplete="username"
      />

      <PasswordInput
        label="Password"
        placeholder="Your Invidious password"
        value={password}
        onChange={e => setPassword(e.currentTarget.value)}
        onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
        size="sm"
        autoComplete="current-password"
      />

      {error && (
        <Alert color="red" variant="light" p="xs">
          <Text size="xs">{error}</Text>
        </Alert>
      )}

      <Button
        leftSection={<IconLogin size={15} />}
        onClick={handleLogin}
        loading={loading}
        disabled={!instanceUrl.trim() || !username.trim() || !password.trim()}
        color="teal"
      >
        Log in to Invidious
      </Button>
    </Stack>
  );
});

// ─── Logged-in panel ──────────────────────────────────────────────────────────

interface LoggedInPanelProps {
  creds: InvidiousCredentials;
  persist: (patch: Record<string, unknown>) => void;
  autoSync?: boolean;
  onAutoSyncDone?: () => void;
}

const LoggedInPanel = memo(({ creds, persist, autoSync, onAutoSyncDone }: LoggedInPanelProps) => {
  const settings     = useSettings();
  const localPlaylists = usePlaylists();
  const setPlaylists = useSetPlaylists() as (p: Playlist[]) => void;

  const [invPlaylists, setInvPlaylists] = useState<InvidiousPlaylist[]>([]);
  const [loadingInv,   setLoadingInv]   = useState(false);

  // Push state
  const [privacy,       setPrivacy]       = useState<"private"|"unlisted"|"public">(
    () => {
      // Try to load from settings first
      const saved = settings.invidiousPlaylistPrivacy;
      return (saved as "private"|"unlisted"|"public") || "private";
    }
  );
  const [pushingId,     setPushingId]     = useState<number | null>(null);
  const [pushedIds,     setPushedIds]     = useState<Set<number>>(new Set());

  // Pull state
  const [importingId,   setImportingId]   = useState<string | null>(null);
  const [importedIds,   setImportedIds]   = useState<Set<string>>(new Set());

  // Bulk push state
  const [bulkPushing,   setBulkPushing]   = useState(false);
  const [bulkProgress,  setBulkProgress]  = useState(0);
  const [bulkTotal,     setBulkTotal]     = useState(0);

  const invBase = normalizeInstanceUri(creds.instanceUrl);

  // ── Fetch Invidious playlists ──────────────────────────────────────────────

  const fetchPlaylists = useCallback(async () => {
    setLoadingInv(true);
    try {
      const data = await fetchInvidiousPlaylists(creds);
      setInvPlaylists(data);

      // ── Auto-link by name matching ────────────────────────────────────────
      // If a local playlist title exactly matches an Invidious playlist title
      // (case-insensitive) and that local playlist isn't already mapped,
      // auto-link them so future pushes sync rather than duplicate.
      if (data.length > 0) {
        const allLocal = getPlaylists() as any[];
        const currentMappings = getMappings();
        let linked = 0;

        for (const local of allLocal) {
          if (!local.ID) continue;
          // Already has a mapping — skip
          if (currentMappings[String(local.ID)] || local.playlistId) continue;

          const localTitle = (local.title ?? "").trim().toLowerCase();
          if (!localTitle || localTitle === "cache") continue;

          const match = data.find(
            (inv) => (inv.title ?? "").trim().toLowerCase() === localTitle,
          );
          if (match) {
            currentMappings[String(local.ID)] = match.playlistId;
            linked++;
          }
        }

        if (linked > 0) {
          setMappings(currentMappings);
          notifications.show({
            title: "Playlists linked",
            message: `${linked} local playlist${linked !== 1 ? "s" : ""} matched by name and linked to Invidious.`,
            color: "teal",
            autoClose: 5000,
          });
        }
      }
    } catch (e: any) {
      notifications.show({
        title: "Invidious",
        message: `Could not fetch playlists: ${e?.message ?? "unknown error"}`,
        color: "red",
      });
    } finally {
      setLoadingInv(false);
    }
  }, [creds.sid]);

  // On mount: fetch playlists; backfill any missing mappings; optionally auto-sync
  useEffect(() => {
    const init = async () => {
      await fetchPlaylists();

      // ── Backfill: copy DB row playlistId → localStorage if missing ──
      // Playlists pulled from Invidious have playlistId set in the DB row.
      // We backfill localStorage so future pushes sync instead of re-creating.
      // We do NOT sync the other direction (localStorage→DB row) because
      // db.update({ ID }) silently matches ALL rows in localstoragedb.
      const allLocal = getPlaylists() as any[];
      const currentMappings = getMappings();
      let backfilled = false;
      for (const pl of allLocal) {
        if (!pl.ID) continue;
        if (pl.playlistId && !currentMappings[String(pl.ID)]) {
          currentMappings[String(pl.ID)] = pl.playlistId;
          backfilled = true;
        }
      }
      if (backfilled) setMappings(currentMappings);

      if (autoSync) {
        onAutoSyncDone?.();
        const syncable = allLocal.filter(
          (p: any) => p.ID && p.type !== "cache" && p.title !== "Cache",
        );
        if (syncable.length > 0) {
          setBulkPushing(true);
          setBulkProgress(0);
          setBulkTotal(syncable.length);
          let done = 0;
          const mappings = { ...getMappings() };
          for (const pl of syncable) {
            try {
              // DB row is the primary source of truth for the linked Invidious ID
              const existingInvId: string | undefined =
                pl.playlistId || (pl.ID ? mappings[String(pl.ID)] : undefined) || undefined;
              if (existingInvId) {
                // Already mapped — sync only, never re-create
                await syncPlaylistToInvidious(creds, existingInvId, pl.videos ?? []);
              } else {
                const invId = await pushPlaylistToInvidious(creds, pl.title, pl.videos ?? [], "private");
                if (pl.ID && invId) {
                  mappings[String(pl.ID)] = invId;
                }
              }
              if (pl.ID) setPushedIds(prev => new Set(prev).add(pl.ID!));
            } catch { /* skip */ }
            done++;
            setBulkProgress(done);
          }
          setMappings(mappings);
          db.commit();
          setPlaylists(getPlaylists());
          await fetchPlaylists();
          setBulkPushing(false);
          notifications.show({
            title: "Auto-sync complete",
            message: `${done} local playlist${done !== 1 ? "s" : ""} pushed/synced to Invidious.`,
            color: "teal",
            autoClose: 5000,
          });
        }
      }
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Logout ─────────────────────────────────────────────────────────────────

  const handleLogout = async () => {
    await logoutInvidious(creds);
    persist({
      invidiousSid:         null,
      invidiousUsername:      null,
      invidiousLoginInstance: null,
    });
    notifications.show({ title: "Invidious", message: "Logged out.", autoClose: 2500 });
  };

  // ── Push single playlist → Invidious ─────────────────────────────────────

  const handlePush = async (pl: Playlist) => {
    if (!pl.ID) return;
    // Guard against concurrent pushes:
    // 1. React state guard (same component instance)
    if (pushingId !== null || bulkPushing) return;
    // 2. Module-level mutex guard (across component instances, e.g. StrictMode double-mount)
    if (!acquirePushLock()) return;
    setPushingId(pl.ID);
    try {
      const videos = pl.videos as CardVideo[];

      // localStorage is the sole reliable store for push-created mappings.
      const existingInvId: string | undefined = getMapping(pl.ID) || undefined;

      let invId: string;
      let isSync = false;

      if (existingInvId) {
        // Already pushed before — only sync (add missing videos), never re-create
        await syncPlaylistToInvidious(creds, existingInvId, videos);
        invId = existingInvId;
        isSync = true;
      } else {
        // First push — create new playlist on Invidious
        invId = await pushPlaylistToInvidious(creds, pl.title, videos, privacy);
        // localStorage is the reliable store for push mappings.
        // NEVER use db.update({ ID }) - localstoragedb doesn't support ID as a query field,
        // it silently matches ALL rows and corrupts every playlist's playlistId.
        setMapping(pl.ID, invId);
        // Refresh React context so the button immediately switches to "Sync".
        setPlaylists(getPlaylists());
      }

      setPushedIds(prev => new Set(prev).add(pl.ID!));
      await fetchPlaylists();
      notifications.show({
        title: isSync ? "Synced to Invidious" : "Pushed to Invidious",
        message: (
          <span>
            "{pl.title}" →{" "}
            <Anchor
              href={`${invBase}/playlist?list=${invId}`}
              target="_blank"
              size="xs"
              style={{ color: "#2ab5a5" }}
            >
              View on Invidious
            </Anchor>
          </span>
        ) as any,
        color: "teal",
        autoClose: 7000,
      });
    } catch (e: any) {
      notifications.show({
        title: "Push failed",
        message: e?.message ?? "Unknown error",
        color: "red",
      });
    } finally {
      releasePushLock();
      setPushingId(null);
    }
  };

  // ── Push ALL local playlists ───────────────────────────────────────────────

  const handlePushAll = async () => {
    const syncable = localSyncable;
    if (!syncable.length) return;
    if (!acquirePushLock()) return;
    setBulkPushing(true);
    setBulkProgress(0);
    setBulkTotal(syncable.length);

    let done = 0;
    const newMappings = { ...getMappings() };

    for (const pl of syncable) {
      try {
        const existingInvId: string | undefined = pl.ID ? newMappings[String(pl.ID)] : undefined;

        if (existingInvId) {
          // Already mapped — sync only (add missing videos), never re-create
          await syncPlaylistToInvidious(creds, existingInvId, pl.videos as CardVideo[]);
        } else {
          // First time — create and persist to both DB row and localStorage
          const invId = await pushPlaylistToInvidious(creds, pl.title, pl.videos as CardVideo[], privacy);
          if (pl.ID && invId) {
            newMappings[String(pl.ID)] = invId;
          }
        }
        if (pl.ID) setPushedIds(prev => new Set(prev).add(pl.ID!));
      } catch { /* skip individual failures */ }
      done++;
      setBulkProgress(done);
    }

    // Persist all new mappings and DB changes atomically
    setMappings(newMappings);
    db.commit();
    // Refresh React context so all buttons switch to "Sync"
    setPlaylists(getPlaylists());

    await fetchPlaylists();
    releasePushLock();
    setBulkPushing(false);
    notifications.show({
      title: "Bulk push complete",
      message: `${done} playlists pushed/synced to Invidious.`,
      color: "teal",
    });
  };

  // ── Pull single playlist ← Invidious ──────────────────────────────────────

  const handlePull = (pl: InvidiousPlaylist) => {
    setImportingId(pl.playlistId);
    try {
      const videos: CardVideo[] = (pl.videos ?? []).map(v => ({
        type: "video" as const,
        videoId: v.videoId,
        title: v.title,
        // Always use YouTube CDN — avoids double-URL bugs when the Invidious
        // instance URL is prepended to an already-absolute thumbnail URL.
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        liveNow: false,
        lengthSeconds: v.lengthSeconds ?? 0,
      }));

      const allLocal = db.queryAll("playlists") as any[];

      // 1. Check by playlistId (the Invidious playlist ID already stored in DB rows)
      const existing = allLocal.find(
        (p) => p.playlistId && p.playlistId === pl.playlistId
      );
      if (existing) {
        const localIds = new Set((existing.videos ?? []).map((v: any) => v.videoId));
        const newVids = videos.filter((v) => !localIds.has(v.videoId));
        if (newVids.length) {
          updatePlaylistVideos(existing.title, [...(existing.videos ?? []), ...newVids] as CardVideo[]);
        }
        setPlaylists(getPlaylists());
        setImportedIds(prev => new Set(prev).add(pl.playlistId));
        notifications.show({
          title: newVids.length ? "Playlist updated" : "Already up to date",
          message: newVids.length
            ? `"${existing.title}" +${newVids.length} new videos`
            : `"${existing.title}" has no new videos`,
          color: "teal",
          autoClose: 5000,
        });
        return;
      }

      // 2. New playlist — insert with playlistId + syncId
      db.insert("playlists", {
        createdAt: new Date().toISOString(),
        title: pl.title,
        playlistId: pl.playlistId,
        videos,
        videoCount: videos.length,
        type: "playlist",
        syncId: crypto.randomUUID(),
      });
      db.commit();

      // Retrieve the newly inserted row to get its auto-assigned local ID,
      // then save the mapping so future pushes sync back to the same Invidious playlist
      // instead of creating a new one every time.
      const inserted = db.queryAll("playlists", {
        query: { title: pl.title },
        sort: [["ID", "DESC"]],
        limit: 1,
      })[0];

      if (inserted?.ID) {
        setMapping(inserted.ID, pl.playlistId);
      }

      setPlaylists(getPlaylists());
      setImportedIds(prev => new Set(prev).add(pl.playlistId));

      notifications.show({
        title: "Imported",
        message: `"${pl.title}" (${videos.length} videos) added to your playlists.`,
        color: "teal",
        autoClose: 4000,
      });
    } finally {
      setImportingId(null);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const localSyncable = localPlaylists.filter(
    p => p.ID && (p as any).type !== "cache" && p.title !== "Cache",
  );

  return (
    <Stack gap="md">

      {/* Connected badge + logout */}
      <Flex align="center" justify="space-between" wrap="wrap" gap="xs">
        <Group gap="xs">
          <IconUser size={15} style={{ color: "#2ab5a5" }} />
          <Text size="sm" fw={600} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {creds.username}
          </Text>
          <Badge size="xs" color="teal" variant="light">
            {normalizeInstanceUri(creds.instanceUrl).replace(/^https?:\/\//, "")}
          </Badge>
        </Group>
        <Group gap="xs">
          <Anchor
            href={`${invBase}/feed/playlists`}
            target="_blank"
            size="xs"
            style={{ color: "#2ab5a5" }}
          >
            My playlists <IconExternalLink size={10} style={{ verticalAlign: "middle" }} />
          </Anchor>
          <Button
            size="xs"
            variant="subtle"
            color="red"
            leftSection={<IconLogout size={13} />}
            onClick={handleLogout}
          >
            Log out
          </Button>
        </Group>
      </Flex>

      <Divider />

      {/* ── Auto-push toggle ── */}
      <Flex align="center" justify="space-between" py={4}>
        <Box>
          <Text size="sm" fw={600} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Auto-push new playlists
          </Text>
          <Text size="xs" c="dimmed">
            Automatically create new local playlists on Invidious and keep them in sync
          </Text>
        </Box>
        <Switch
          checked={settings.invidiousAutoPush ?? false}
          onChange={e => persist({ invidiousAutoPush: e.currentTarget.checked })}
          color="teal"
          size="sm"
        />
      </Flex>

      <Divider />
      <Box>
        <Flex align="center" justify="space-between" mb="xs">
          <Box>
            <Title order={6} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              Push to Invidious
            </Title>
            <Text size="xs" c="dimmed">Upload local playlists to your Invidious account</Text>
          </Box>
          <Group gap="xs">
            <Select
              size="xs"
              value={privacy}
              onChange={v => {
                const newPrivacy = (v ?? "private") as "private"|"unlisted"|"public";
                setPrivacy(newPrivacy);
                // Persist to database
                persist({ invidiousPlaylistPrivacy: newPrivacy });
              }}
              data={PRIVACY_OPTIONS}
              style={{ width: 110 }}
              styles={{ input: { fontSize: 11 } }}
            />
            <Button
              size="xs"
              color="teal"
              variant="light"
              leftSection={<IconArrowUp size={13} />}
              loading={bulkPushing}
              disabled={!localSyncable.length || bulkPushing || pushingId !== null}
              onClick={handlePushAll}
            >
              Push All
            </Button>
          </Group>
        </Flex>

        {/* Bulk progress */}
        {bulkPushing && (
          <Box mb="xs">
            <Text size="xs" c="dimmed" mb={4}>
              Pushing {bulkProgress}/{bulkTotal}…
            </Text>
            <Progress value={(bulkProgress / Math.max(bulkTotal, 1)) * 100} color="teal" size="xs" animated />
          </Box>
        )}

        {localSyncable.length === 0 ? (
          <Text size="xs" c="dimmed">No local playlists to push.</Text>
        ) : (
          <Stack gap={4}>
            {localSyncable.map(pl => {
              const wasPushed = pl.ID ? pushedIds.has(pl.ID) : false;
              const isPushing = pl.ID === pushingId;
              return (
                <Flex
                  key={pl.ID}
                  align="center"
                  justify="space-between"
                  px="sm"
                  py={8}
                  style={{
                    background: wasPushed ? "rgba(42,181,165,0.07)" : "rgba(255,255,255,0.02)",
                    borderRadius: 7,
                    border: wasPushed
                      ? "1px solid rgba(42,181,165,0.2)"
                      : "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <Box style={{ minWidth: 0 }}>
                    <Text
                      size="sm"
                      fw={600}
                      lineClamp={1}
                      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                    >
                      {pl.title}
                    </Text>
                    <Group gap={4}>
                      <Text size="xs" c="dimmed">{pl.videoCount} videos</Text>
                      {pl.ID && getMapping(pl.ID) && !wasPushed && (
                        <Badge size="xs" color="teal" variant="dot">linked</Badge>
                      )}
                    </Group>
                  </Box>
                  <Button
                    size="xs"
                    variant={wasPushed ? "filled" : "subtle"}
                    color="teal"
                    loading={isPushing}
                    disabled={isPushing || bulkPushing || pushingId !== null}
                    leftSection={
                      isPushing ? undefined :
                      wasPushed ? <IconCheck size={12} /> :
                      (pl.ID && getMapping(pl.ID))
                        ? <IconRefresh size={12} />
                        : <IconArrowUp size={12} />
                    }
                    onClick={() => handlePush(pl)}
                  >
                    {wasPushed ? "Synced" :
                     (pl.ID && getMapping(pl.ID)) ? "Sync" : "Push"}
                  </Button>
                </Flex>
              );
            })}
          </Stack>
        )}
      </Box>

      <Divider />

      {/* ── Pull: Invidious → Elysium ── */}
      <Box>
        <Flex align="center" justify="space-between" mb="xs">
          <Box>
            <Title order={6} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              Pull from Invidious
            </Title>
            <Text size="xs" c="dimmed">Import Invidious playlists into Elysium</Text>
          </Box>
          <Button
            size="xs"
            variant="subtle"
            color="teal"
            leftSection={<IconRefresh size={13} />}
            loading={loadingInv}
            onClick={fetchPlaylists}
          >
            Refresh
          </Button>
        </Flex>

        {loadingInv && !invPlaylists.length && (
          <Flex align="center" gap="xs" py="xs">
            <Loader size="xs" color="teal" />
            <Text size="xs" c="dimmed">Fetching your Invidious playlists…</Text>
          </Flex>
        )}

        {!loadingInv && invPlaylists.length === 0 && (
          <Text size="xs" c="dimmed">No playlists found on this Invidious account.</Text>
        )}

        {invPlaylists.length > 0 && (
          <Stack gap={4}>
            {invPlaylists.map(pl => {
              const wasImported = importedIds.has(pl.playlistId);
              const isImporting = importingId === pl.playlistId;
              return (
                <Flex
                  key={pl.playlistId}
                  align="center"
                  justify="space-between"
                  px="sm"
                  py={8}
                  style={{
                    background: wasImported ? "rgba(42,181,165,0.07)" : "rgba(255,255,255,0.02)",
                    borderRadius: 7,
                    border: wasImported
                      ? "1px solid rgba(42,181,165,0.2)"
                      : "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <Box style={{ minWidth: 0 }}>
                    <Text
                      size="sm"
                      fw={600}
                      lineClamp={1}
                      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                    >
                      {pl.title}
                    </Text>
                    <Group gap={6}>
                      <Text size="xs" c="dimmed">{pl.videoCount} videos</Text>
                      {pl.privacy && (
                        <Badge
                          size="xs"
                          variant="light"
                          color={pl.privacy === "public" ? "teal" : "gray"}
                        >
                          {pl.privacy}
                        </Badge>
                      )}
                    </Group>
                  </Box>
                  <Group gap={6}>
                    <Button
                      size="xs"
                      variant={wasImported ? "filled" : "subtle"}
                      color="teal"
                      loading={isImporting}
                      disabled={isImporting}
                      leftSection={
                        isImporting ? undefined :
                        wasImported ? <IconCheck size={12} /> :
                        <IconArrowDown size={12} />
                      }
                      onClick={() => handlePull(pl)}
                    >
                      {wasImported ? "Imported" : "Import"}
                    </Button>
                    <Button
                      component="a"
                      href={`${invBase}/playlist?list=${pl.playlistId}`}
                      target="_blank"
                      size="xs"
                      variant="subtle"
                      color="gray"
                      px={6}
                    >
                      <IconExternalLink size={13} />
                    </Button>
                  </Group>
                </Flex>
              );
            })}
          </Stack>
        )}
      </Box>
    </Stack>
  );
});
