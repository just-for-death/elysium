/**
 * PresenceProvider
 *
 * Wraps usePresence() and exposes its values via context so any component
 * (sidebar, settings, etc.) can read live device presence without prop-drilling.
 */

import {
  createContext,
  useContext,
  type FC,
  type PropsWithChildren,
} from "react";

import { usePresence } from "../hooks/usePresence";
import type { DevicePresence } from "../hooks/usePresence";

interface PresenceContextValue {
  myCode:          string;
  wsConnected:     boolean;
  devicePresences: Record<string, DevicePresence>;
  pushInstantSync: () => void;
  sendVideoDelete: (playlistSyncId: string, playlistTitle: string, videoId: string) => void;
}

const PresenceContext = createContext<PresenceContextValue>({
  myCode:          "",
  wsConnected:     false,
  devicePresences: {},
  pushInstantSync: () => {},
  sendVideoDelete: () => {},
});

export const PresenceProvider: FC<PropsWithChildren> = ({ children }) => {
  const value = usePresence();
  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
};

export const usePresenceContext = () => useContext(PresenceContext);
