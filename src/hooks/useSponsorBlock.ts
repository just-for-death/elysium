import { useCallback, useEffect } from "react";

import {
  useAudioElement,
  usePlayerProgress,
  usePlayerVideo,
} from "../providers/Player";
import type { SponsorBlockSegment } from "../types/interfaces/SponsorBlock";

const inRange = (num: number, min: number, max: number) =>
  num >= min && num <= max;

const getNextSegment = (
  currentTime: number,
  segments: SponsorBlockSegment[],
) => {
  // Find the first segment whose range contains the current playback time
  return segments.find(
    (segment) =>
      currentTime >= segment.startTime - 0.5 &&
      currentTime < segment.endTime,
  );
};

export const useSponsorBlock = () => {
  const playerVideo = usePlayerVideo();
  const playerState = usePlayerProgress();
  const getAudioEl = useAudioElement();

  const handleSeek = useCallback(
    (currentTime: number) => {
      const audio = getAudioEl();
      if (!audio) return;
      audio.currentTime = currentTime;
    },
    [getAudioEl],
  );

  useEffect(() => {
    if (playerVideo.sponsorBlockSegments && playerState.currentTime) {
      const nextSegment = getNextSegment(
        playerState.currentTime,
        playerVideo.sponsorBlockSegments,
      );

      if (
        nextSegment &&
        inRange(
          playerState.currentTime,
          nextSegment.startTime,
          nextSegment.endTime,
        )
      ) {
        handleSeek(nextSegment.endTime);
      }
    }
  }, [
    playerState.currentTime,
    playerVideo.sponsorBlockSegments,
    handleSeek,
  ]);

  return null;
};
