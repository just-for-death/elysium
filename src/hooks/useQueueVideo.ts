import { useCallback } from "react";
import { showNotification } from "@mantine/notifications";

import type { CardVideo } from "../types/interfaces/Card";
import type { Video } from "../types/interfaces/Video";
import { usePlayerVideo } from "../providers/Player";
import { usePlayerPlaylist, useSetPlayerPlaylist, useSetPinnedVideoIds } from "../providers/PlayerPlaylist";
import { useSetPreviousNextVideos } from "../providers/PreviousNextTrack";

const cardVideoToVideo = (card: CardVideo): Video => ({
  videoId: card.videoId,
  title: card.title,
  type: card.type as Video["type"],
  thumbnail: card.thumbnail,
  videoThumbnails: card.videoThumbnails ?? [],
  adaptiveFormats: [],
  recommendedVideos: [],
  allowRatings: true,
  author: "",
  authorId: "",
  description: "",
  descriptionHtml: "",
  genre: "",
  isFamilyFriendly: true,
  isListed: true,
  isUpcoming: false,
  liveNow: card.liveNow,
  likeCount: 0,
  viewCount: 0,
  lengthSeconds: card.lengthSeconds,
});

const getPreviousAndNextVideoId = (videos: Video[], videoId: string) => {
  const idx = videos.findIndex((v) => v.videoId === videoId);
  return {
    videosIds: {
      previousVideoId: videos[idx - 1]?.videoId ?? null,
      nextVideoId: videos[idx + 1]?.videoId ?? null,
    },
  };
};

export const useQueueVideo = () => {
  const { video: currentVideo } = usePlayerVideo();
  const playlist = usePlayerPlaylist();
  const setPlaylist = useSetPlayerPlaylist();
  const setPreviousNextVideos = useSetPreviousNextVideos();
  const { pin, unpin } = useSetPinnedVideoIds();

  /**
   * Insert the video immediately after the currently playing track,
   * before any recommendations/suggestions. Marks it as pinned so
   * the auto-queue hook never displaces it.
   */
  const addNext = useCallback(
    (card: CardVideo) => {
      const toAdd = cardVideoToVideo(card);

      // Remove any existing entry to avoid duplicates; unpin old position
      unpin(card.videoId);
      const without = playlist.filter((v) => v.videoId !== card.videoId);

      const currentIdx = without.findIndex(
        (v) => v.videoId === currentVideo?.videoId,
      );
      const insertAt = currentIdx >= 0 ? currentIdx + 1 : 0;

      const next = [
        ...without.slice(0, insertAt),
        toAdd,
        ...without.slice(insertAt),
      ];

      pin(card.videoId);
      setPlaylist(next);
      if (currentVideo) {
        setPreviousNextVideos(getPreviousAndNextVideoId(next, currentVideo.videoId));
      }

      showNotification({
        title: "Queue",
        message: `"${card.title}" will play next`,
        autoClose: 3000,
      });
    },
    [currentVideo, playlist, setPlaylist, setPreviousNextVideos, pin, unpin],
  );

  /**
   * Append the video at the very end of the queue. Marks it as pinned.
   */
  const addLast = useCallback(
    (card: CardVideo) => {
      const toAdd = cardVideoToVideo(card);

      unpin(card.videoId);
      const without = playlist.filter((v) => v.videoId !== card.videoId);
      const next = [...without, toAdd];

      pin(card.videoId);
      setPlaylist(next);
      if (currentVideo) {
        setPreviousNextVideos(getPreviousAndNextVideoId(next, currentVideo.videoId));
      }

      showNotification({
        title: "Queue",
        message: `"${card.title}" added to end of queue`,
        autoClose: 3000,
      });
    },
    [currentVideo, playlist, setPlaylist, setPreviousNextVideos, pin, unpin],
  );

  /**
   * Remove a video from the queue entirely (both pinned and auto-suggested).
   */
  const removeFromQueue = useCallback(
    (videoId: string) => {
      unpin(videoId);
      const next = playlist.filter((v) => v.videoId !== videoId);
      setPlaylist(next);
      if (currentVideo) {
        setPreviousNextVideos(getPreviousAndNextVideoId(next, currentVideo.videoId));
      }
    },
    [currentVideo, playlist, setPlaylist, setPreviousNextVideos, unpin],
  );

  return { addNext, addLast, removeFromQueue };
};
