import {
  type Dispatch,
  type FC,
  type PropsWithChildren,
  type SetStateAction,
  createContext,
  useContext,
  useState,
} from "react";

const FullscreenPlayerContext = createContext<boolean>(false);
const SetFullscreenPlayerContext = createContext<Dispatch<SetStateAction<boolean>>>(() => {});

export const FullscreenPlayerProvider: FC<PropsWithChildren> = ({ children }) => {
  const [open, setOpen] = useState(false);
  return (
    <FullscreenPlayerContext.Provider value={open}>
      <SetFullscreenPlayerContext.Provider value={setOpen}>
        {children}
      </SetFullscreenPlayerContext.Provider>
    </FullscreenPlayerContext.Provider>
  );
};

export const useFullscreenPlayer = () => useContext(FullscreenPlayerContext);
export const useSetFullscreenPlayer = () => useContext(SetFullscreenPlayerContext);
