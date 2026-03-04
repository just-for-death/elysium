import type { Instance } from "./Instance";

export type RemoteDeviceType = "desktop" | "tablet" | "mobile";

export interface RemoteDevice {
  id: string;
  name: string;
  type: "desktop" | "tablet" | "mobile";
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  instances: Instance[];
  currentInstance: Instance | null;
  defaultInstance: Instance | null;
  customInstances: Instance[];
  videoMode: boolean;
  deviceId: string;
  devices: RemoteDevice[];
  sponsorBlock: boolean;
  sponsorBlockCategories: string[];
  analytics: boolean;
  exportFileName: string | null;
  exportLastDate: string | null;
  // Invidious account
  invidiousSid: string | null;
  invidiousUsername: string | null;
  invidiousLoginInstance: string | null;
  /** Maps local playlist DB ID → Invidious playlist ID for live sync */
  invidiousPlaylistMappings: Record<number, string>;
  /** When true, new local playlists are automatically created on Invidious */
  invidiousAutoPush: boolean;
  // ListenBrainz scrobbling
  listenBrainzToken: string | null;
  listenBrainzUsername: string | null;
  listenBrainzEnabled: boolean;
  listenBrainzPlayingNow: boolean;
  /** Percentage of track duration to listen before scrobbling (default: 50) */
  listenBrainzScrobblePercent: number;
  /** Cap in seconds: scrobble is triggered no later than this many seconds in (default: 240 = 4 min). 0 = no cap. */
  listenBrainzScrobbleMaxSeconds: number;
  // ── Gotify push notifications ────────────────────────────────────────────────
  gotifyUrl: string | null;
  gotifyToken: string | null;
  gotifyEnabled: boolean;
  // ── Multi-device sync ─────────────────────────────────────────────────────────
  /** Auto-sync enabled */
  syncEnabled: boolean;
  /** Minutes between automatic syncs */
  syncInterval: number;
  /** ISO timestamp of last successful sync */
  lastSyncAt: string;
  /** Linked devices (paired by code) */
  linkedDevices: LinkedDevice[];
}

export interface LinkedDevice {
  /** The 8-char permanent code of the remote device */
  code: string;
  /** User-given name for this device */
  name: string;
  /** linux | ipad | android | other */
  platform: string;
  /** ISO timestamp when pairing was added */
  pairedAt: string;
  /** ISO timestamp of last successful sync with this device */
  lastSyncAt: string;
}
