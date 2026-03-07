/**
 * useAutoQueue — v7
 *
 * Fetches a batch of up to QUEUE_TARGET (7) tracks ahead so there is always
 * a deep queue pre-loaded.
 *
 * Strategy dispatch:
 *   discover  → getDiscoverSuggestions  (batch, Apple + LB trending)
 *   similar   → getSimilarSuggestions   (batch, LB Radio + Last.fm fallback)
 *   my_taste  → getMyTasteSuggestion    (single Ollama pick, then padded with similar)
 *   legacy modes → single-result wrappers, called repeatedly to fill the batch
 */

import { useEffect, useRef } from "react";

import { getSettings, getVideosHistory } from "../database/utils";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import { usePlayerVideo } from "../providers/Player";
import { usePlayerPlaylist, useSetPlayerPlaylist, usePinnedVideoIds } from "../providers/PlayerPlaylist";
import { useSetPreviousNextVideos } from "../providers/PreviousNextTrack";
import {
  getAppleChartsSuggestion,
  getDiscoverSuggestions,
  getLastfmSimilarSuggestion,
  getListenBrainzSuggestion,
  getMyTasteSuggestion,
  getOllamaSuggestion,
  getSimilarSuggestions,
  type QueueMode,
  type QueueSuggestion,
} from "../services/autoQueue";
import { extractArtistTrack, extractedResultIsSuspicious } from "../services/lyrics";
import { ollamaExtractArtistTrack } from "../services/ollama";
import { log } from "../utils/logger";
import type { Video } from "../types/interfaces/Video";

/** How many tracks to keep ahead of the current track in the playlist */
const QUEUE_TARGET = 7;

/** How many tracks ahead we already have before we bother fetching */
const QUEUE_FETCH_THRESHOLD = 3;

export const useAutoQueue = () => {
  const { video } = usePlayerVideo();
  const playlist = usePlayerPlaylist();
  const setPlaylist = useSetPlayerPlaylist();
  const setPreviousNextVideos = useSetPreviousNextVideos();
  const pinnedVideoIds = usePinnedVideoIds();

  const playlistRef = useRef<Video[]>(playlist);
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);

  // Keep a ref to pinnedIds so the async run() closure sees the latest value
  const pinnedIdsRef = useRef<Set<string>>(pinnedVideoIds);
  useEffect(() => { pinnedIdsRef.current = pinnedVideoIds; }, [pinnedVideoIds]);

  const fetchingForVideoIdRef = useRef<string | null>(null);
  const lastVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!video?.videoId) return;
    if (video.videoId === lastVideoIdRef.current) return;
    lastVideoIdRef.current = video.videoId;

    const settings = getSettings();
    const rawMode: string = (settings as any).queueMode ?? "off";
    const legacyOllama = (settings as any).ollamaEnabled && (settings as any).ollamaUrl;
    const effectiveMode: QueueMode =
      rawMode !== "off" ? (rawMode as QueueMode) : legacyOllama ? "my_taste" : "off";

    if (effectiveMode === "off" || effectiveMode === "invidious") return;

    const currentVideo = video;

    const run = async () => {
      if (fetchingForVideoIdRef.current === currentVideo.videoId) return;
      fetchingForVideoIdRef.current = currentVideo.videoId;

      try {
        const currentPlaylist = playlistRef.current;
        const currentIdx = currentPlaylist.findIndex((v) => v.videoId === currentVideo.videoId);
        const tracksAhead = currentIdx === -1 ? 0 : currentPlaylist.length - currentIdx - 1;

        if (tracksAhead >= QUEUE_FETCH_THRESHOLD) {
          log.debug("AutoQueue: enough tracks ahead, skipping", { tracksAhead });
          return;
        }

        const needed = QUEUE_TARGET - tracksAhead;

        // Build avoid structures (history + already queued ahead)
        const history = getVideosHistory().slice(1, 15);
        const alreadyQueued = currentPlaylist.slice(Math.max(0, currentIdx + 1));
        const avoidTitles = new Set<string>([
          ...history.map((h) => h.title?.toLowerCase() ?? ""),
          ...alreadyQueued.map((v) => v.title?.toLowerCase() ?? ""),
        ]);
        const avoidList = [
          ...history.map((h) => ({ title: h.title ?? "" })),
          ...alreadyQueued.map((v) => ({ title: v.title ?? "" })),
        ];

        const freshSettings = getSettings();
        const lbToken    = freshSettings.listenBrainzToken ?? null;
        const lbUsername = freshSettings.listenBrainzUsername ?? null;
        const ollamaUrl  = ((freshSettings as any).ollamaUrl ?? "").replace(/\/$/, "");
        const ollamaModel = (freshSettings as any).ollamaModel ?? "llama3.2:3b";
        const lastfmKey  = (freshSettings as any).lastfmQueueApiKey ?? null;

        const currentArtist = currentVideo.author ?? "";
        const currentTitle  = currentVideo.title ?? "";

        // Extract clean artist + track from the YouTube title/channel.
        // Raw data: author="Better Noise Music" (a label channel), title="From Ashes To New - Die For You Official Music Video"
        // extractArtistTrack parses "Artist - Song Title" and strips "(Official Music Video)" etc.
        let { artist: cleanArtist, track: cleanTrack } = extractArtistTrack(currentTitle, currentArtist);

        // ── Ollama fallback when regex extraction looks wrong ──────────────
        // e.g. channel="World Tour & Tourism" leaks through as artist,
        // or title still has | chars, meaning the parser couldn't split it.
        if (
          ollamaUrl &&
          extractedResultIsSuspicious(
            { artist: cleanArtist, track: cleanTrack },
            currentTitle,
            currentArtist,
          )
        ) {
          const ollamaResult = await ollamaExtractArtistTrack(
            ollamaUrl, ollamaModel, currentTitle, currentArtist,
          );
          if (ollamaResult) {
            cleanArtist = ollamaResult.artist;
            cleanTrack  = ollamaResult.track;
            log.debug("[useAutoQueue] Ollama extraction:", { cleanArtist, cleanTrack });
          }
        }

        // ── Get a batch of suggestions ─────────────────────────────────────
        let suggestions: QueueSuggestion[] = [];

        if (effectiveMode === "discover") {
          suggestions = await getDiscoverSuggestions(avoidTitles, needed);

        } else if (effectiveMode === "similar") {
          suggestions = await getSimilarSuggestions(
            cleanArtist, cleanTrack, avoidTitles, lbToken, lastfmKey, needed,
            currentVideo.author ?? undefined,
          );

        } else if (effectiveMode === "my_taste") {
          // Ollama produces one track; pad the rest with similar tracks
          const ollamaPickP = ollamaUrl
            ? getMyTasteSuggestion(
                { title: cleanTrack, artist: cleanArtist },
                avoidList, avoidTitles, lbToken, lbUsername, ollamaUrl, ollamaModel,
              )
            : Promise.resolve(null);

          const similarP = getSimilarSuggestions(
            cleanArtist, cleanTrack, avoidTitles, lbToken, lastfmKey, needed,
            currentVideo.author ?? undefined,
          );

          const [ollamaPick, similarBatch] = await Promise.all([ollamaPickP, similarP]);

          if (ollamaPick) {
            suggestions.push(ollamaPick);
            // Add similar tracks that don't duplicate Ollama's pick
            const ollamaKey = ollamaPick.title.toLowerCase();
            for (const s of similarBatch) {
              if (suggestions.length >= needed) break;
              if (s.title.toLowerCase() !== ollamaKey) suggestions.push(s);
            }
          } else {
            suggestions = similarBatch;
          }

        // ── Legacy modes (single-track, called up to `needed` times) ──────
        } else if (effectiveMode === "apple_charts") {
          for (let i = 0; i < needed; i++) {
            const s = await getAppleChartsSuggestion(avoidTitles);
            if (!s) break;
            avoidTitles.add(s.title.toLowerCase());
            suggestions.push(s);
          }

        } else if (effectiveMode === "listenbrainz") {
          for (let i = 0; i < needed; i++) {
            const s = await getListenBrainzSuggestion(avoidTitles);
            if (!s) break;
            avoidTitles.add(s.title.toLowerCase());
            suggestions.push(s);
          }

        } else if (effectiveMode === "lastfm_similar") {
          if (lastfmKey) {
            for (let i = 0; i < needed; i++) {
              const s = await getLastfmSimilarSuggestion(lastfmKey, cleanArtist, cleanTrack, avoidTitles);
              if (!s) break;
              avoidTitles.add(s.title.toLowerCase());
              suggestions.push(s);
            }
          }

        } else if (effectiveMode === "ollama") {
          if (ollamaUrl) {
            for (let i = 0; i < needed; i++) {
              const s = await getOllamaSuggestion(ollamaUrl, ollamaModel, { title: cleanTrack, artist: cleanArtist }, avoidList);
              if (!s) break;
              avoidTitles.add(s.title.toLowerCase());
              avoidList.push({ title: s.title });
              suggestions.push(s);
            }
          }
        }

        if (!suggestions.length) return;

        // ── Search Invidious for each suggestion in parallel ───────────────
        const base = normalizeInstanceUri(freshSettings.currentInstance?.uri ?? "");
        if (!base) return;

        const searchOne = async (suggestion: QueueSuggestion): Promise<Video | null> => {
          const query = `${suggestion.artist} ${suggestion.title}`;
          const searchUrl = `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance&page=1`;
          try {
            const res = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) return null;
            const data = await res.json();
            const results: any[] = Array.isArray(data) ? data : [];

            // Find first valid non-live, non-duplicate result
            const queuedIds = new Set(playlistRef.current.map((v) => v.videoId));
            const match = results.find(
              (v: any) =>
                v.type === "video" &&
                v.videoId &&
                !queuedIds.has(v.videoId) &&
                v.lengthSeconds > 30 &&
                !v.liveNow,
            );
            if (!match) return null;

            log.debug("AutoQueue: resolved track", {
              mode: effectiveMode,
              suggested: `${suggestion.artist} - ${suggestion.title}`,
              found: match.title,
            });

            return {
              videoId: match.videoId,
              title: match.title ?? suggestion.title,
              author: match.author ?? suggestion.artist,
              authorId: match.authorId ?? "",
              type: "video",
              lengthSeconds: match.lengthSeconds ?? 0,
              viewCount: match.viewCount ?? 0,
              likeCount: match.likeCount ?? 0,
              description: "",
              descriptionHtml: "",
              genre: "",
              isFamilyFriendly: true,
              isListed: true,
              isUpcoming: false,
              liveNow: false,
              allowRatings: true,
              thumbnail: "",
              adaptiveFormats: [],
              videoThumbnails: match.videoThumbnails ?? [],
              recommendedVideos: [],
            } satisfies Video;
          } catch {
            return null;
          }
        };

        // Fan-out all searches in parallel for speed
        const resolved = (await Promise.all(suggestions.map(searchOne)))
          .filter((v): v is Video => v !== null);

        if (!resolved.length) return;

        // De-duplicate by videoId (different suggestions may resolve to same video)
        const seenVideoIds = new Set(playlistRef.current.map((v) => v.videoId));
        const uniqueNew: Video[] = [];
        for (const v of resolved) {
          if (!seenVideoIds.has(v.videoId)) {
            seenVideoIds.add(v.videoId);
            uniqueNew.push(v);
          }
        }

        if (!uniqueNew.length) return;

        // ── Inject new tracks AFTER all pinned items ahead of current ──────────
        // Pinned items (manually queued by user) are never displaced.
        // Auto suggestions are inserted after the last pinned item in the
        // ahead-of-current block, preserving user intent.
        const latestPlaylist = playlistRef.current;
        const latestIdx = latestPlaylist.findIndex((v) => v.videoId === currentVideo.videoId);

        // Remove any video we're about to re-add (avoid duplicates if re-triggered)
        const newVideoIds = new Set(uniqueNew.map((v) => v.videoId));
        const filteredPlaylist = latestPlaylist.filter((v) => !newVideoIds.has(v.videoId));

        let newPlaylist: Video[];
        if (latestIdx === -1) {
          newPlaylist = [currentVideo, ...filteredPlaylist.filter((v) => v.videoId !== currentVideo.videoId), ...uniqueNew];
        } else {
          const filteredIdx = filteredPlaylist.findIndex((v) => v.videoId === currentVideo.videoId);
          const afterCurrent = filteredIdx === -1 ? filteredPlaylist.length : filteredIdx + 1;

          // Walk forward from the current track and skip over all pinned items.
          // Insert auto-queue suggestions after the last consecutive pinned item.
          const pinned = pinnedIdsRef.current;
          let insertPos = afterCurrent;
          for (let i = afterCurrent; i < filteredPlaylist.length; i++) {
            if (pinned.has(filteredPlaylist[i].videoId)) {
              insertPos = i + 1; // keep pinned item in place, push insert point
            } else {
              break; // first non-pinned slot — insert here
            }
          }

          newPlaylist = [
            ...filteredPlaylist.slice(0, insertPos),
            ...uniqueNew,
            ...filteredPlaylist.slice(insertPos),
          ];
        }

        setPlaylist(newPlaylist);

        const newIdx = newPlaylist.findIndex((v) => v.videoId === currentVideo.videoId);
        setPreviousNextVideos({
          videosIds: {
            previousVideoId: newIdx > 0 ? newPlaylist[newIdx - 1].videoId : null,
            nextVideoId: newIdx >= 0 && newIdx < newPlaylist.length - 1
              ? newPlaylist[newIdx + 1].videoId
              : null,
          },
        });

        log.debug("AutoQueue: injected batch", {
          mode: effectiveMode,
          count: uniqueNew.length,
          titles: uniqueNew.map((v) => v.title),
        });
      } finally {
        if (fetchingForVideoIdRef.current === currentVideo.videoId) {
          fetchingForVideoIdRef.current = null;
        }
      }
    };

    run().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.videoId]);
};
