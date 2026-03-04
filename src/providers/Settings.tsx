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
import { useQuery } from "react-query";

import { db } from "../database";
import { getSettings } from "../database/utils";
import {
  fetchInvidiousInstances,
  filterAndParseInstances,
} from "../services/instances";
import type { Instance } from "../types/interfaces/Instance";
import type { RemoteDevice, Settings } from "../types/interfaces/Settings";
import {
  DEFAULT_INVIDIOUS_URI,
  getDefaultInstance,
  normalizeInstanceUri,
} from "../utils/invidiousInstance";
import { stringValueIsEmpty } from "../utils/stringValueIsEmpty";

const SettingsContext = createContext<null | {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
}>(null);

const rawSettings = getSettings();
const INITIAL_SETTINGS = {
  ...rawSettings,
  currentInstance:
    rawSettings.currentInstance ?? getDefaultInstance(),
};

export const SettingsProvider: FC<PropsWithChildren> = ({ children }) => {
  const exportFileName = useMemo(
    () =>
      stringValueIsEmpty(INITIAL_SETTINGS.exportFileName as string)
        ? null
        : INITIAL_SETTINGS.exportFileName,
    [],
  );
  const [settings, setSettings] = useState<Settings>({
    ...INITIAL_SETTINGS,
    exportFileName,
    instances: [],
  });

  const handleSuccess = useCallback(
    (data: any) => {
      if (settings.instances.length > 0) return;

      let instances: Instance[];
      try {
        instances = Array.isArray(data) ? filterAndParseInstances(data) : [];
      } catch {
        instances = [];
      }
      if (!instances.length) return;

      const currentInstance = (() => {
        // Prefer yt.ikiagi.loseyourip.com (user's preferred default)
        const preferred = instances.find(
          (i) =>
            i.domain === "yt.ikiagi.loseyourip.com" ||
            i.uri === DEFAULT_INVIDIOUS_URI,
        );
        if (preferred) return preferred;

        if (settings.defaultInstance) {
          if (settings.defaultInstance.custom) {
            return sanitizeInstance(settings.defaultInstance);
          }
          const isStillUp = instances.find(
            (i) => i.domain === settings.defaultInstance?.domain,
          );
          if (isStillUp) return sanitizeInstance(settings.defaultInstance);
        }

        const idx =
          instances.length === 1
            ? 0
            : generateRandomInteger(0, instances.length - 1);
        return instances[idx];
      })();

      setSettings((previousState) => ({
        ...previousState,
        instances,
        currentInstance,
      }));

      db.update("settings", { ID: 1 }, (row: any) => ({
        ...row,
        currentInstance,
      }));
      db.commit();
    },
    [settings.defaultInstance, settings.instances.length],
  );

  useQuery("instances", () => fetchInvidiousInstances(), {
    onSuccess: handleSuccess,
    enabled: settings.instances.length === 0,
  });

  const value = useMemo(
    () => ({
      settings,
      setSettings,
    }),
    [settings, setSettings],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () =>
  useContext(SettingsContext)?.settings as Settings;
export const useSetSettings = () =>
  useContext(SettingsContext)?.setSettings as Dispatch<
    SetStateAction<Settings>
  >;
export const useRemoteDevices = () =>
  useContext(SettingsContext)?.settings.devices as RemoteDevice[];

const generateRandomInteger = (min: number, max: number) =>
  Math.floor(min + Math.random() * (max - min + 1));

const sanitizeInstance = (instance: Instance): Instance => ({
  ...instance,
  uri: normalizeInstanceUri(instance.uri) || instance.uri,
});
