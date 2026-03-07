import {
  type Dispatch,
  type FC,
  type PropsWithChildren,
  type SetStateAction,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { Video } from "../types/interfaces/Video";

const PlayerPlaylistContext = createContext<Video[]>([]);
const SetPlayerPlaylistContext = createContext<
  Dispatch<SetStateAction<Video[]>>
>(() => {});

// Tracks which videoIds were manually queued by the user ("pinned").
// Pinned items are never displaced by the auto-queue hook.
const PinnedVideoIdsContext = createContext<Set<string>>(new Set());
const SetPinnedVideoIdsContext = createContext<{
  pin: (id: string) => void;
  unpin: (id: string) => void;
  clearAll: () => void;
  isPinned: (id: string) => boolean;
}>({ pin: () => {}, unpin: () => {}, clearAll: () => {}, isPinned: () => false });

export const PlayerPlaylistProvider: FC<PropsWithChildren> = ({ children }) => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  const pin = useCallback((id: string) => {
    setPinnedIds((prev) => new Set([...prev, id]));
  }, []);

  const unpin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setPinnedIds(new Set());
  }, []);

  const isPinned = useCallback((id: string) => pinnedIds.has(id), [pinnedIds]);

  const pinnedActions = useMemo(
    () => ({ pin, unpin, clearAll, isPinned }),
    [pin, unpin, clearAll, isPinned],
  );

  const value = useMemo(() => ({ videos, setVideos }), [videos]);

  return (
    <PlayerPlaylistContext.Provider value={value.videos}>
      <SetPlayerPlaylistContext.Provider value={value.setVideos}>
        <PinnedVideoIdsContext.Provider value={pinnedIds}>
          <SetPinnedVideoIdsContext.Provider value={pinnedActions}>
            {children}
          </SetPinnedVideoIdsContext.Provider>
        </PinnedVideoIdsContext.Provider>
      </SetPlayerPlaylistContext.Provider>
    </PlayerPlaylistContext.Provider>
  );
};

export const usePlayerPlaylist = () => useContext(PlayerPlaylistContext);
export const useSetPlayerPlaylist = () => useContext(SetPlayerPlaylistContext);
export const usePinnedVideoIds = () => useContext(PinnedVideoIdsContext);
export const useSetPinnedVideoIds = () => useContext(SetPinnedVideoIdsContext);
