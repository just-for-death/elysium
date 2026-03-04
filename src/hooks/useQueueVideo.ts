import { useCallback } from "react";
import { showNotification } from "@mantine/notifications";

import type { CardVideo } from "../types/interfaces/Card";
import type { Video } from "../types/interfaces/Video";
import { usePlayerVideo } from "../providers/Player";
import { usePlayerPlaylist, useSetPlayerPlaylist } from "../providers/PlayerPlaylist";
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

const getNextVideoId = (videos: Video[], currentVideoId: string): string | null => {
  const idx = videos.findIndex((v) => v.videoId === currentVideoId);
  return videos[idx + 1]?.videoId ?? null;
};

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

  /**
   * Insert the video immediately after the currently playing track,
   * before any recommendations/suggestions.
   */
  const addNext = useCallback(
    (card: CardVideo) => {
      const toAdd = cardVideoToVideo(card);

      // Remove any existing entry for this video to avoid duplicates
      const without = playlist.filter((v) => v.videoId !== card.videoId);

      // Find where the current song sits and insert right after it
      const currentIdx = without.findIndex(
        (v) => v.videoId === currentVideo?.videoId,
      );
      const insertAt = currentIdx >= 0 ? currentIdx + 1 : 0;

      const next = [
        ...without.slice(0, insertAt),
        toAdd,
        ...without.slice(insertAt),
      ];

      // Update playlist first, then immediately sync nextVideoId so the
      // player knows to play this track when the current one ends
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
    [currentVideo, playlist, setPlaylist, setPreviousNextVideos],
  );

  /**
   * Append the video at the very end of the queue.
   */
  const addLast = useCallback(
    (card: CardVideo) => {
      const toAdd = cardVideoToVideo(card);

      // Remove duplicates, then push to end
      const without = playlist.filter((v) => v.videoId !== card.videoId);
      const next = [...without, toAdd];

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
    [currentVideo, playlist, setPlaylist, setPreviousNextVideos],
  );

  return { addNext, addLast };
};
