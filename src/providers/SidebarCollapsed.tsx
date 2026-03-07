import {
  type Dispatch,
  type FC,
  type PropsWithChildren,
  type SetStateAction,
  createContext,
  useContext,
  useState,
} from "react";

const SidebarCollapsedContext = createContext<boolean>(false);
const SetSidebarCollapsedContext = createContext<Dispatch<SetStateAction<boolean>>>(() => {});

export const SidebarCollapsedProvider: FC<PropsWithChildren> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SidebarCollapsedContext.Provider value={collapsed}>
      <SetSidebarCollapsedContext.Provider value={setCollapsed}>
        {children}
      </SetSidebarCollapsedContext.Provider>
    </SidebarCollapsedContext.Provider>
  );
};

export const useSidebarCollapsed = () => useContext(SidebarCollapsedContext);
export const useSetSidebarCollapsed = () => useContext(SetSidebarCollapsedContext);
