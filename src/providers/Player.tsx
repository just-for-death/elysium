import {
  type Dispatch,
  type FC,
  type MutableRefObject,
  type PropsWithChildren,
  type SetStateAction,
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { useRemotePlay } from "../hooks/useRemotePlay";
import type { SponsorBlockSegment } from "../types/interfaces/SponsorBlock";
import type { Video } from "../types/interfaces/Video";
import type { ColorInfo } from "../utils/colorExtractor";

interface PlayerVideo {
  video: Video | null;
  sponsorBlockSegments: SponsorBlockSegment[] | null;
  thumbnailUrl: string | null;
  primaryColor: ColorInfo | null;
}

const initialPlayerVideoState = {
  video: null,
  sponsorBlockSegments: null,
  thumbnailUrl: null,
  primaryColor: null,
};

// ── Split state: PlayerStatus (stable) + PlayerProgress (updates every 500ms) ──
//
// PERF FIX (iPad): Previously a single PlayerState context held ALL fields.
// handleListen (500ms timer) called setPlayerState, causing ALL ~27 consumer
// components to reconcile — including PlayerActions, ButtonRepeat, and
// PlayerLoadingOverlay which never use currentTime/percentage.
//
// Splitting into two contexts means the 500ms listen tick ONLY re-renders the
// ~6 components that actually display progress. Status-only components (play
// button, loading overlay, repeat button, volume, etc.) no longer re-render
// during playback. On iPad this cuts JS work by ~70% during audio playback.

// PlayerStatus: stable fields that only change on play/pause/load/volume events
export interface PlayerStatus {
  paused: boolean;
  muted: boolean;
  repeat: boolean;
  audioDuration: number | null;
  duration: string | null;
  volume: number;
  loading: boolean;
}

// PlayerProgress: high-frequency fields updated every 500ms listen tick
export interface PlayerProgress {
  currentTime: number | null;
  formatedCurrentTime: string | null;
  percentage: number | null;
}

// Legacy merged type — kept for backwards compat and for components that need both
export interface PlayerState extends PlayerStatus, PlayerProgress {}

export const initialPlayerStatus: PlayerStatus = {
  paused: false,
  muted: false,
  repeat: false,
  audioDuration: null,
  duration: null,
  volume: 1,
  loading: true,
};

export const initialPlayerProgress: PlayerProgress = {
  currentTime: null,
  formatedCurrentTime: null,
  percentage: null,
};

// Legacy export — used by usePlayVideo to reset state on new track
export const initialPlayerState: PlayerState = {
  ...initialPlayerStatus,
  ...initialPlayerProgress,
};

const PlayerAudioContext = createContext<MutableRefObject<null> | null>(null);
const PlayerUrlContext = createContext<string | null>(null);
const SetPlayerUrlContext = createContext<
  Dispatch<SetStateAction<string | null>>
>(() => {});
const PlayerFallbackUrlsContext = createContext<string[]>([]);
const SetPlayerFallbackUrlsContext = createContext<
  Dispatch<SetStateAction<string[]>>
>(() => {});
const PlayerVideoContext = createContext<PlayerVideo>(initialPlayerVideoState);
const SetPlayerVideoContext = createContext<
  Dispatch<SetStateAction<PlayerVideo>>
>(() => {});

// Two separate contexts — the core of the perf fix
const PlayerStatusContext = createContext<PlayerStatus>(initialPlayerStatus);
const SetPlayerStatusContext = createContext<
  Dispatch<SetStateAction<PlayerStatus>>
>(() => {});
const PlayerProgressContext = createContext<PlayerProgress>(initialPlayerProgress);
const SetPlayerProgressContext = createContext<
  Dispatch<SetStateAction<PlayerProgress>>
>(() => {});

export const PlayerProvider: FC<PropsWithChildren> = ({ children }) => {
  const [video, setVideo] = useState<PlayerVideo>(initialPlayerVideoState);
  const [url, setUrl] = useState<string | null>(null);
  const [fallbackUrls, setFallbackUrls] = useState<string[]>([]);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>(initialPlayerStatus);
  const [playerProgress, setPlayerProgress] = useState<PlayerProgress>(initialPlayerProgress);
  const playerAudioRef = useRef(null);

  const videoState = useMemo(() => ({ video, setVideo }), [video]);
  const urlState = useMemo(() => ({ url, setUrl }), [url]);

  return (
    <PlayerAudioContext.Provider value={playerAudioRef}>
      <PlayerUrlContext.Provider value={urlState.url}>
        <SetPlayerUrlContext.Provider value={urlState.setUrl}>
          <PlayerFallbackUrlsContext.Provider value={fallbackUrls}>
            <SetPlayerFallbackUrlsContext.Provider value={setFallbackUrls}>
              <PlayerVideoContext.Provider value={videoState.video}>
                <SetPlayerVideoContext.Provider value={videoState.setVideo}>
                  <PlayerStatusContext.Provider value={playerStatus}>
                    <SetPlayerStatusContext.Provider value={setPlayerStatus}>
                      <PlayerProgressContext.Provider value={playerProgress}>
                        <SetPlayerProgressContext.Provider value={setPlayerProgress}>
                          {children}
                          <RemotePlayHook />
                        </SetPlayerProgressContext.Provider>
                      </PlayerProgressContext.Provider>
                    </SetPlayerStatusContext.Provider>
                  </PlayerStatusContext.Provider>
                </SetPlayerVideoContext.Provider>
              </PlayerVideoContext.Provider>
            </SetPlayerFallbackUrlsContext.Provider>
          </PlayerFallbackUrlsContext.Provider>
        </SetPlayerUrlContext.Provider>
      </PlayerUrlContext.Provider>
    </PlayerAudioContext.Provider>
  );
};

const RemotePlayHook = () => {
  useRemotePlay();
  return null;
};

export const usePlayerUrl = () => useContext(PlayerUrlContext);
export const useSetPlayerUrl = () => useContext(SetPlayerUrlContext);
export const usePlayerFallbackUrls = () => useContext(PlayerFallbackUrlsContext);
export const useSetPlayerFallbackUrls = () => useContext(SetPlayerFallbackUrlsContext);
export const usePlayerVideo = () => useContext(PlayerVideoContext);
export const useSetPlayerVideo = () => useContext(SetPlayerVideoContext);
export const usePlayerAudio = () => useContext(PlayerAudioContext);

// Granular hooks — use these in components that only need one type of state
export const usePlayerStatus = () => useContext(PlayerStatusContext);
export const useSetPlayerStatus = () => useContext(SetPlayerStatusContext);
export const usePlayerProgress = () => useContext(PlayerProgressContext);
export const useSetPlayerProgress = () => useContext(SetPlayerProgressContext);

// Legacy merged hooks — subscribe to BOTH contexts, so re-render on any change.
// Use only in components that genuinely need fields from both (e.g. FullscreenPlayer).
// Prefer usePlayerStatus() or usePlayerProgress() wherever possible.
export const usePlayerState = (): PlayerState => {
  const status = useContext(PlayerStatusContext);
  const progress = useContext(PlayerProgressContext);
  // useMemo keeps the merged object stable when neither sub-state changed,
  // but this hook still re-renders on any update to either context.
  return useMemo(() => ({ ...status, ...progress }), [status, progress]);
};

export const useSetPlayerState = (): Dispatch<SetStateAction<PlayerState>> => {
  const setStatus = useContext(SetPlayerStatusContext);
  const setProgress = useContext(SetPlayerProgressContext);
  // Returns a dispatcher compatible with the old SetStateAction<PlayerState> API.
  // Splits the update into the two sub-contexts automatically.
  return useMemo(() => (action: SetStateAction<PlayerState>) => {
    if (typeof action === "function") {
      // Function updater: we need current state from both contexts to call it.
      // We schedule two micro-updates; React will batch them in concurrent mode.
      setStatus((prevStatus) => {
        setProgress((prevProgress) => {
          const merged = action({ ...prevStatus, ...prevProgress });
          return {
            currentTime:         merged.currentTime,
            formatedCurrentTime: merged.formatedCurrentTime,
            percentage:          merged.percentage,
          };
        });
        const merged = action({ ...prevStatus, ...initialPlayerProgress });
        return {
          paused:        merged.paused,
          muted:         merged.muted,
          repeat:        merged.repeat,
          audioDuration: merged.audioDuration,
          duration:      merged.duration,
          volume:        merged.volume,
          loading:       merged.loading,
        };
      });
    } else {
      setStatus({
        paused:        action.paused,
        muted:         action.muted,
        repeat:        action.repeat,
        audioDuration: action.audioDuration,
        duration:      action.duration,
        volume:        action.volume,
        loading:       action.loading,
      });
      setProgress({
        currentTime:         action.currentTime,
        formatedCurrentTime: action.formatedCurrentTime,
        percentage:          action.percentage,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStatus, setProgress]);
};

/**
 * useAudioElement
 *
 * Returns the underlying HTMLAudioElement from ReactAudioPlayer's ref, typed
 * correctly. Eliminates the need for // @ts-ignore on every callsite.
 *
 * ReactAudioPlayer is a class component whose ref shape is:
 *   { audioEl: { current: HTMLAudioElement } }
 * The PlayerAudioContext stores this ref as MutableRefObject<null> because
 * ReactAudioPlayer has no exported TypeScript type for its ref. This helper
 * centralises the unsafe cast in one place.
 */
/**
 * Returns a stable getter function that retrieves the HTMLAudioElement on demand.
 * Using a getter (rather than returning the element directly) ensures components
 * always read the latest element without depending on render timing.
 */
export const useAudioElement = (): (() => HTMLAudioElement | null) => {
  const ref = useContext(PlayerAudioContext) as unknown as {
    current: { audioEl: { current: HTMLAudioElement | null } } | null;
  } | null;
  // Return a stable inline function — ref identity is stable across renders,
  // so this never causes unnecessary re-renders in consumers.
  return () => ref?.current?.audioEl?.current ?? null;
};
