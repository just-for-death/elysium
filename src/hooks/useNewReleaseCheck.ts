/**
 * useNewReleaseCheck
 *
 * Runs a background check every hour (when the app is open) to look for
 * new releases from followed artists. When a new release is detected:
 *  1. Updates the "last seen" record in the DB
 *  2. Shows an in-app Mantine notification
 *  3. Sends a Gotify push notification if configured
 */

import { showNotification } from "@mantine/notifications";
import { useEffect, useRef } from "react";

import { normalizeInstanceUri } from "../utils/invidiousInstance";
import { updateArtistLastSeen, useFollowedArtists } from "../providers/FollowedArtists";
import { getSettings } from "../database/utils";
import { getLatestRelease } from "../services/appleMusic";
import { sendNewReleaseAlert } from "../services/gotify";
import { log } from "../utils/logger";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const INITIAL_DELAY_MS = 30 * 1000; // 30 s after app load

// ─── YouTube (Invidious) latest video ─────────────────────────────────────────

const getLatestYouTubeRelease = async (
  channelId: string,
  invidiousBaseUri: string,
): Promise<{ name: string; releaseDate: string; artworkUrl?: string } | null> => {
  try {
    const url = `${invidiousBaseUri}/api/v1/channels/${channelId}/videos?page=1&sort_by=newest`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const videos: any[] = Array.isArray(data?.videos) ? data.videos : (Array.isArray(data) ? data : []);
    if (!videos.length) return null;
    const latest = videos[0];
    return {
      name: latest.title ?? "New video",
      releaseDate: latest.published
        ? new Date(latest.published * 1000).toISOString()
        : new Date().toISOString(),
      artworkUrl: latest.videoThumbnails?.[0]?.url,
    };
  } catch {
    return null;
  }
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useNewReleaseCheck = () => {
  const followed = useFollowedArtists();
  const followedRef = useRef(followed);
  followedRef.current = followed;

  useEffect(() => {
    const runCheck = async () => {
      const artists = followedRef.current;
      if (!artists.length) return;

      const settings = getSettings();
      const baseUri = normalizeInstanceUri(settings.currentInstance?.uri ?? "");
      const gotifyUrl = (settings as any).gotifyUrl as string | undefined;
      const gotifyToken = (settings as any).gotifyToken as string | undefined;
      const gotifyEnabled = (settings as any).gotifyEnabled as boolean | undefined;

      log.debug("useNewReleaseCheck: checking", { count: artists.length });

      for (const artist of artists) {
        try {
          let latest: { name: string; releaseDate: string; artworkUrl?: string } | null = null;

          if (artist.platform === "apple_music" && artist.itunesId) {
            latest = await getLatestRelease(artist.itunesId);
          } else if (artist.platform === "youtube" && baseUri) {
            latest = await getLatestYouTubeRelease(artist.artistId, baseUri);
          }

          if (!latest) continue;

          // Check if this is actually new
          const isNew =
            !artist.lastSeenReleaseDate ||
            new Date(latest.releaseDate) > new Date(artist.lastSeenReleaseDate);

          if (!isNew) continue;

          // Update DB
          updateArtistLastSeen(artist.artistId, latest.name, latest.releaseDate);

          // In-app notification
          showNotification({
            title: `🎵 New release: ${artist.name}`,
            message: `${artist.name} — ${latest.name}`,
            color: "pink",
            autoClose: 10000,
          });

          // Gotify push notification
          if (gotifyEnabled && gotifyUrl && gotifyToken) {
            await sendNewReleaseAlert(
              gotifyUrl,
              gotifyToken,
              artist.name,
              latest.name,
              latest.artworkUrl,
            );
          }
        } catch (err) {
          log.warn("useNewReleaseCheck: check failed for artist", {
            artist: artist.name,
            err,
          });
        }
      }
    };

    // Initial check after a short delay so the app finishes loading first
    const initialTimer = setTimeout(runCheck, INITIAL_DELAY_MS);
    const interval = setInterval(runCheck, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []); // intentionally run once — followedRef keeps it fresh
};
