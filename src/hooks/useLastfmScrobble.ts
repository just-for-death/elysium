import { useEffect, useRef } from "react";
import { usePlayerState, usePlayerVideo } from "../providers/Player";
import { parseArtistTrack, scrobbleTrack, updateNowPlaying } from "../services/lastfm";
import type { LastfmCredentials } from "../services/lastfm";

// Scrobble rules (per Last.fm spec):
// - Track must be > 30s long
// - Scrobble after 50% of track played or 4 mins, whichever comes first
// - "Now Playing" is sent when track starts

export function useLastfmScrobble(credentials: LastfmCredentials | null) {
  const { video } = usePlayerVideo();
  const playerState = usePlayerState();

  const nowPlayingSentRef = useRef<string | null>(null);
  const scrobbledRef = useRef<string | null>(null);
  const trackStartTimestampRef = useRef<number>(0);
  const scrobbleThresholdRef = useRef<number>(0);

  useEffect(() => {
    if (!credentials?.sessionKey || !video) return;

    const videoId = video.videoId;
    const duration = video.lengthSeconds ?? 0;

    // Only scrobble tracks longer than 30s
    if (duration < 30) return;

    // Reset refs when video changes
    if (nowPlayingSentRef.current !== videoId) {
      nowPlayingSentRef.current = videoId;
      scrobbledRef.current = null;
      trackStartTimestampRef.current = Math.floor(Date.now() / 1000);
      // Scrobble threshold: 50% or 4 minutes
      scrobbleThresholdRef.current = Math.min(duration * 0.5, 240);

      const { artist, track } = parseArtistTrack(video.title, video.author ?? "");
      updateNowPlaying(credentials, track, artist, duration).catch(console.warn);
    }
  }, [video, credentials]);

  useEffect(() => {
    if (!credentials?.sessionKey || !video) return;

    const duration = video.lengthSeconds ?? 0;
    if (duration < 30) return;

    const currentTime = playerState.currentTime ?? 0;
    const videoId = video.videoId;

    // Check if we should scrobble
    if (
      scrobbledRef.current !== videoId &&
      currentTime >= scrobbleThresholdRef.current &&
      scrobbleThresholdRef.current > 0
    ) {
      scrobbledRef.current = videoId;
      const { artist, track } = parseArtistTrack(video.title, video.author ?? "");
      scrobbleTrack(
        credentials,
        track,
        artist,
        trackStartTimestampRef.current,
        duration
      ).catch(console.warn);
    }
  }, [playerState.currentTime, video, credentials]);
}
