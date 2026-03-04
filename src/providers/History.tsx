import {
  type FC,
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { db } from "../database";
import { getVideosHistory } from "../database/utils";
import type { CardVideo } from "../types/interfaces/Card";
import type { Video } from "../types/interfaces/Video";
import { formatedCardVideo } from "../utils/formatData";

const HistoryContext = createContext<CardVideo[]>([]);
const SetHistoryContext = createContext<(video: Video) => void>(() => {});
const RefreshHistoryContext = createContext<() => void>(() => {});

export const HistoryProvider: FC<PropsWithChildren> = ({ children }) => {
  const [history, setHistory] = useState<CardVideo[]>(getVideosHistory());

  const handleSetHistory = useCallback((video: Video) => {
    db.insert("history", formatedCardVideo(video));
    db.commit();
    setHistory(getVideosHistory());
  }, []);

  const handleRefreshHistory = useCallback(() => {
    setHistory(getVideosHistory());
  }, []);

  const value = useMemo(
    () => ({
      history,
      setHistory: handleSetHistory,
      refreshHistory: handleRefreshHistory,
    }),
    [history, handleSetHistory, handleRefreshHistory],
  );

  return (
    <HistoryContext.Provider value={value.history}>
      <SetHistoryContext.Provider value={value.setHistory}>
        <RefreshHistoryContext.Provider value={value.refreshHistory}>
          {children}
        </RefreshHistoryContext.Provider>
      </SetHistoryContext.Provider>
    </HistoryContext.Provider>
  );
};

export const useHistory = () => useContext(HistoryContext);
export const useSetHistory = () => useContext(SetHistoryContext);
export const useRefreshHistory = () => useContext(RefreshHistoryContext);
