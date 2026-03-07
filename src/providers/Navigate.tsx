import {
  type FC,
  type MutableRefObject,
  type PropsWithChildren,
  createContext,
  useContext,
  useEffect,
  useRef,
} from "react";
import { type NavigateFunction, useNavigate } from "react-router-dom";

const StableNavigateContext =
  createContext<MutableRefObject<NavigateFunction> | null>(null);

export const StableNavigateProvider: FC<PropsWithChildren> = ({ children }) => {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);

  // FIX: Keep ref in sync with the latest navigate function.
  // React Router recreates navigate on every render in some environments
  // (especially Android Chrome PWA after cold start / back-navigation).
  // Without this, navigateRef.current is stale and all navigate() calls
  // silently do nothing — causing the "playlists can't be opened" bug on Android.
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  return (
    <StableNavigateContext.Provider value={navigateRef}>
      {children}
    </StableNavigateContext.Provider>
  );
};

export const useStableNavigate = (): NavigateFunction => {
  const navigateRef = useContext(
    StableNavigateContext,
  ) as MutableRefObject<NavigateFunction>;

  if (navigateRef.current === null)
    throw new Error("StableNavigate context is not initialized");

  return navigateRef.current;
};
