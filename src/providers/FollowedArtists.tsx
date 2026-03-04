import {
  type Dispatch,
  type FC,
  type PropsWithChildren,
  type SetStateAction,
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

import { db } from "../database";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface FollowedArtist {
  ID?: number;
  artistId: string; // "am_artist:{id}" or YouTube channelId
  name: string;
  thumbnail: string;
  platform: "youtube" | "apple_music";
  itunesId?: string; // numeric iTunes artist ID (apple_music only)
  followedAt: string; // ISO date string
  lastSeenReleaseName?: string;
  lastSeenReleaseDate?: string;
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

export const getFollowedArtists = (): FollowedArtist[] => {
  try {
    if (!db.tableExists("followedArtists")) return [];
    return db.queryAll("followedArtists", { sort: [["followedAt", "DESC"]] });
  } catch {
    return [];
  }
};

export const addFollowedArtist = (artist: Omit<FollowedArtist, "ID">): void => {
  if (!db.tableExists("followedArtists")) return;
  const existing = db.queryAll("followedArtists", { query: { artistId: artist.artistId } });
  if (existing.length > 0) return;
  db.insert("followedArtists", artist);
  db.commit();
};

export const removeFollowedArtist = (artistId: string): void => {
  if (!db.tableExists("followedArtists")) return;
  db.deleteRows("followedArtists", { artistId });
  db.commit();
};

export const updateArtistLastSeen = (
  artistId: string,
  releaseName: string,
  releaseDate: string,
): void => {
  if (!db.tableExists("followedArtists")) return;
  db.update(
    "followedArtists",
    { artistId },
    (row: FollowedArtist) => ({
      ...row,
      lastSeenReleaseName: releaseName,
      lastSeenReleaseDate: releaseDate,
    }),
  );
  db.commit();
};

// ─── Context ──────────────────────────────────────────────────────────────────

const FollowedArtistsContext = createContext<FollowedArtist[]>([]);
const SetFollowedArtistsContext = createContext<
  Dispatch<SetStateAction<FollowedArtist[]>>
>(() => {});

// ─── Provider ─────────────────────────────────────────────────────────────────

export const FollowedArtistsProvider: FC<PropsWithChildren> = ({ children }) => {
  const [artists, setArtists] = useState<FollowedArtist[]>(getFollowedArtists());

  const value = useMemo(() => ({ artists, setArtists }), [artists]);

  return (
    <FollowedArtistsContext.Provider value={value.artists}>
      <SetFollowedArtistsContext.Provider value={value.setArtists}>
        {children}
      </SetFollowedArtistsContext.Provider>
    </FollowedArtistsContext.Provider>
  );
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

export const useFollowedArtists = () => useContext(FollowedArtistsContext);
export const useSetFollowedArtists = () => useContext(SetFollowedArtistsContext);
