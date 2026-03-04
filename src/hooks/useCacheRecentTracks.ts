import { useEffect } from "react";

import { useHistory } from "../providers/History";
import { updateCachePlaylist } from "../database/utils";

export const useCacheRecentTracks = () => {
  const history = useHistory();

  useEffect(() => {
    // Sync the 10 most-recently-played tracks to the "Cache" playlist
    const recent = history.slice(0, 10);
    updateCachePlaylist(recent);

    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
      return;
    }

    if (recent.length === 0) return;

    const tracks = recent.map((card) => {
      const thumbs: Array<{ quality: string; url: string }> =
        (card as any).videoThumbnails ?? [];

      const best =
        thumbs.find((t) => t.quality === "maxresdefault") ??
        thumbs.find((t) => t.quality === "sddefault") ??
        thumbs.find((t) => t.quality === "high") ??
        thumbs[0];

      const thumbnailUrl: string | undefined =
        best?.url ?? (card as any).thumbnail ?? undefined;

      return { thumbnailUrl };
    });

    navigator.serviceWorker.controller.postMessage({
      type: "CACHE_RECENT_TRACKS",
      tracks,
    });
  }, [history]);
};
