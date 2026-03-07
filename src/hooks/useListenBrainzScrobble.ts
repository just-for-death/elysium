import { useCallback, useEffect, useMemo, useRef } from "react";

import { usePlayerProgress, usePlayerStatus, usePlayerVideo } from "../providers/Player";
import { useSettings } from "../providers/Settings";
import {
  submitListen,
  submitPlayingNow,
} from "../services/listenbrainz";
import { extractArtistTrack } from "../services/lyrics";

/**
 * Hook that handles automatic ListenBrainz scrobbling.
 * - Sends "playing now" when a new track starts.
 * - Scrobbles the track once the user has listened to 50% or 4 minutes (whichever comes first).
 */
export function useListenBrainzScrobble() {
  const settings = useSettings();
  const { video } = usePlayerVideo();
  const playerState = usePlayerProgress();
  const playerStatus = usePlayerStatus();

  // Track which video we've already scrobbled
  const scrobbledVideoId = useRef<string | null>(null);
  // Track whether we've sent "playing now" for the current video
  const playingNowSentRef = useRef<string | null>(null);
  // Track the timestamp when the track started playing
  const trackStartTimestamp = useRef<number>(Math.floor(Date.now() / 1000));

  const isEnabled =
    !!settings.listenBrainzToken &&
    !!settings.listenBrainzUsername &&
    settings.listenBrainzEnabled;

  const credentials = useMemo(
    () => ({
      userToken: settings.listenBrainzToken ?? "",
      username: settings.listenBrainzUsername ?? "",
    }),
    [settings.listenBrainzToken, settings.listenBrainzUsername],
  );

  // When a new video starts, send "Playing Now" and reset scrobble state
  useEffect(() => {
    if (!video || !isEnabled || !credentials.userToken) return;
    if (playingNowSentRef.current === video.videoId) return;

    playingNowSentRef.current = video.videoId;
    scrobbledVideoId.current = null;
    trackStartTimestamp.current = Math.floor(Date.now() / 1000);

    if (settings.listenBrainzPlayingNow !== false) {
      const { artist, track } = extractArtistTrack(video.title ?? "", video.author ?? "");
      submitPlayingNow(credentials, {
        artist_name: artist,
        track_name: track,
        additional_info: {
          youtube_id: video.videoId,
          origin_url: `https://www.youtube.com/watch?v=${video.videoId}`,
        },
      });
    }
  }, [video?.videoId, isEnabled, credentials.userToken, settings.listenBrainzPlayingNow]);

  // Watch playback progress and scrobble at the right time (50% or 4 min per ListenBrainz docs)
  const handleScrobble = useCallback(() => {
    if (!video || !isEnabled || !credentials.userToken) return;
    if (scrobbledVideoId.current === video.videoId) return;

    const duration = playerStatus.audioDuration;
    const currentTime = playerState.currentTime;

    if (!duration || duration <= 0 || currentTime == null || currentTime < 0) return;

    const pct = (settings.listenBrainzScrobblePercent ?? 50) / 100;
    const maxSec = settings.listenBrainzScrobbleMaxSeconds ?? 240;
    const threshold = maxSec > 0
      ? Math.min(duration * pct, maxSec)
      : duration * pct;

    if (currentTime >= threshold) {
      scrobbledVideoId.current = video.videoId;
      const { artist, track } = extractArtistTrack(video.title ?? "", video.author ?? "");
      submitListen(
        credentials,
        {
          artist_name: artist,
          track_name: track,
          duration_ms: Math.round(duration * 1000),
          additional_info: {
            youtube_id: video.videoId,
            origin_url: `https://www.youtube.com/watch?v=${video.videoId}`,
          },
        },
        trackStartTimestamp.current
      );
    }
  }, [
    video,
    isEnabled,
    credentials,
    playerState.currentTime,
    playerStatus.audioDuration,
    settings.listenBrainzScrobblePercent,
    settings.listenBrainzScrobbleMaxSeconds,
  ]);

  useEffect(() => {
    handleScrobble();
  }, [handleScrobble]);
}
