import { Indicator } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconCategory,
  IconDots,
  IconHeart,
  IconHistory,
  IconHome2,
  IconPlaylist,
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
    { icon: <IconTrendingUp size={20} />, label: t("navigation.trending"),     path: "/trending"     },
    { icon: <IconUsers size={20} />,      label: t("navigation.most-popular"), path: "/most-popular" },
    { icon: <IconCategory size={20} />,   label: t("genre.title"),             path: "/genres"       },
    { icon: <IconUserHeart size={20} />,  label: "Following",                  path: "/following"    },
    { icon: <IconHistory size={20} />,    label: t("navigation.history"),      path: "/history"      },
    { icon: <IconWifi size={20} />,       label: "Devices",                    path: "/devices"      },
    { icon: <IconSettings size={20} />,   label: t("navigation.settings"),     path: "/settings"     },
  ];

  return (
    <>
      {/* Overlay */}
      <div className={classes.sheetOverlay} onClick={onClose} />
      {/* Sheet */}
      <div className={classes.sheet} role="menu">
        <div className={classes.sheetHandle} />
        <div className={classes.sheetTitle}>More</div>
        <div className={classes.sheetGrid}>
          {items.map((item) => (
            <button
              key={item.path}
              className={classes.sheetItem}
              data-active={activePath === item.path}
              onClick={() => go(item.path)}
              role="menuitem"
            >
              <span className={classes.sheetItemIcon}>{item.icon}</span>
              <span className={classes.sheetItemLabel}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
});

// ── Main export ────────────────────────────────────────────────────────────────

export const MobileNavigationContainer = memo(() => {
  // Show on mobile AND tablet (iPad) — hide only on large desktop
  const isDesktop = useMediaQuery("(min-width: 1024px)");
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
  const moreActive = [
    "/most-popular", "/genres", "/following",
    "/settings", "/trending", "/history", "/devices",
  ].includes(path);

  const go = useCallback((p: string) => {
    setMoreOpen(false);
    navigate(p);
  }, [navigate]);

  if (isDesktop) return null;

  // iPad uses a wider 6-tab layout; phone uses 5
  const isTablet = window.innerWidth >= 768;

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

        {/* Favorites */}
        <Tab
          icon={<IconHeart size={22} stroke={path === "/favorites" ? 2 : 1.5} />}
          label="Favorites"
          active={path === "/favorites"}
          onClick={() => go("/favorites")}
        />

        {/* Playlists */}
        <Tab
          icon={<IconPlaylist size={22} stroke={path === "/playlists" ? 2 : 1.5} />}
          label="Playlists"
          active={path === "/playlists"}
          onClick={() => go("/playlists")}
        />

        {/* Trending — only show on tablet where there's more room */}
        {isTablet && (
          <Tab
            icon={<IconTrendingUp size={22} stroke={path === "/trending" ? 2 : 1.5} />}
            label={t("navigation.trending")}
            active={path === "/trending"}
            onClick={() => go("/trending")}
          />
        )}

        {/* History — tablet only */}
        {isTablet && (
          <Tab
            icon={<IconHistory size={22} stroke={path === "/history" ? 2 : 1.5} />}
            label={t("navigation.history")}
            active={path === "/history"}
            onClick={() => go("/history")}
          />
        )}

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
