import { Indicator } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconCategory,
  IconDots,
  IconHistory,
  IconHome2,
  IconSettings,
  IconTrendingUp,
  IconUserHeart,
  IconUsers,
  IconWifi,
} from "@tabler/icons-react";
import { memo, useCallback, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { usePresenceContext } from "../providers/Presence";
import { useStableNavigate } from "../providers/Navigate";
import classes from "./MobileNavigation.module.css";

// ── Compact tab ────────────────────────────────────────────────────────────────

interface TabProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

const Tab = memo(({ icon, label, active, onClick }: TabProps) => (
  <button className={classes.tab} data-active={active} onClick={onClick} aria-label={label}>
    {icon}
    <span className={classes.label}>{label}</span>
  </button>
));

// ── "More" bottom sheet ────────────────────────────────────────────────────────

interface SheetItem {
  icon: React.ReactNode;
  label: string;
  path: string;
}

const MoreSheet = memo(({ onClose, activePath }: { onClose: () => void; activePath: string }) => {
  const navigate = useStableNavigate();
  const { t } = useTranslation();

  const go = useCallback((path: string) => {
    navigate(path);
    onClose();
  }, [navigate, onClose]);

  const items: SheetItem[] = [
    { icon: <IconUsers size={20} />,    label: t("navigation.most-popular"), path: "/most-popular" },
    { icon: <IconCategory size={20} />, label: t("genre.title"),             path: "/genres"       },
    { icon: <IconUserHeart size={20} />,label: "Following",                  path: "/following"    },
    { icon: <IconSettings size={20} />, label: t("navigation.settings"),     path: "/settings"     },
  ];

  return (
    <>
      {/* Overlay */}
      <div className={classes.sheetOverlay} onClick={onClose} />
      {/* Sheet */}
      <div className={classes.sheet} role="menu">
        <div className={classes.sheetHandle} />
        {items.map((item) => (
          <button
            key={item.path}
            className={classes.sheetItem}
            data-active={activePath === item.path}
            onClick={() => go(item.path)}
            role="menuitem"
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
});

// ── Main export ────────────────────────────────────────────────────────────────

export const MobileNavigationContainer = memo(() => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const navigate  = useStableNavigate();
  const location  = useLocation();
  const { t }     = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);

  const { wsConnected, devicePresences } = usePresenceContext();
  const devices    = Object.values(devicePresences);
  const anyOnline  = devices.some((d) => d.online);
  const anyPlaying = devices.some((d) => d.online && d.presence && !d.presence.paused);
  const hasDevices = devices.length > 0;

  const path = location.pathname;
  // "More" tab is active if current path belongs to one of its sheet items
  const moreActive = ["/most-popular", "/genres", "/following", "/settings"].includes(path);

  const go = useCallback((p: string) => {
    setMoreOpen(false);
    navigate(p);
  }, [navigate]);

  if (!isMobile) return null;

  return (
    <>
      {moreOpen && (
        <MoreSheet activePath={path} onClose={() => setMoreOpen(false)} />
      )}

      <nav className={classes.bar} aria-label="Mobile navigation">

        {/* Home */}
        <Tab
          icon={<IconHome2 size={22} stroke={path === "/" ? 2 : 1.5} />}
          label={t("navigation.dashboard")}
          active={path === "/"}
          onClick={() => go("/")}
        />

        {/* Trending */}
        <Tab
          icon={<IconTrendingUp size={22} stroke={path === "/trending" ? 2 : 1.5} />}
          label={t("navigation.trending")}
          active={path === "/trending"}
          onClick={() => go("/trending")}
        />

        {/* History */}
        <Tab
          icon={<IconHistory size={22} stroke={path === "/history" ? 2 : 1.5} />}
          label={t("navigation.history")}
          active={path === "/history"}
          onClick={() => go("/history")}
        />

        {/* Devices — navigates to /devices page for full remote control */}
        <Tab
          icon={
            hasDevices ? (
              <Indicator
                color={anyPlaying ? "teal" : anyOnline ? "blue" : "gray"}
                processing={anyPlaying}
                size={7}
                offset={2}
              >
                <IconWifi size={22} stroke={path === "/devices" ? 2 : 1.5} />
              </Indicator>
            ) : (
              <IconWifi size={22} stroke={path === "/devices" ? 2 : 1.5} />
            )
          }
          label="Devices"
          active={path === "/devices"}
          onClick={() => go("/devices")}
        />

        {/* More */}
        <Tab
          icon={<IconDots size={22} stroke={moreActive ? 2 : 1.5} />}
          label="More"
          active={moreActive || moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        />

      </nav>
    </>
  );
});
