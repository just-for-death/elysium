import { AppShell, Box, Center, Divider, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import {
  IconCategory,
  IconChevronLeft,
  IconChevronRight,
  IconHeart,
  IconHistory,
  IconHome2,
  IconMusic,
  IconSearch,
  IconTrendingUp,
  IconUserHeart,
  IconUsers,
} from "@tabler/icons-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { useSearchUrl } from "../hooks/useSearchUrl";
import { useStableNavigate } from "../providers/Navigate";
import { useSidebarCollapsed, useSetSidebarCollapsed } from "../providers/SidebarCollapsed";
import { useTrendingUrl } from "../providers/TrendingFilters";
import { Logo } from "./Logo";
import { NavbarLink } from "./NavbarLink";
import classes from "./Navigation.module.css";
import { PlayerSpace } from "./Player";

const NAVIGATION_WIDTH = 232;
const NAVIGATION_COLLAPSED_WIDTH = 68;

export const Navigation = memo(() => {
  const { t } = useTranslation();
  const collapsed = useSidebarCollapsed();
  const setCollapsed = useSetSidebarCollapsed();

  return (
    <AppShell.Navbar
      aria-label="App navigation"
      w={{ base: collapsed ? NAVIGATION_COLLAPSED_WIDTH : NAVIGATION_WIDTH }}
      className={`${classes.navbar} ${collapsed ? classes.navbarCollapsed : ""}`}
      style={{ transition: "width 0.25s cubic-bezier(0.34, 1.02, 0.64, 1)" }}
    >
      <Box className={classes.logoSection}>
        {collapsed ? (
          <Center>
            <Tooltip label="Expand sidebar" position="right" withArrow>
              <UnstyledButton
                onClick={() => setCollapsed(false)}
                className={classes.collapseBtn}
                aria-label="Expand sidebar"
              >
                <Box className={classes.logoMark}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M2 10.5C2 9.12 3.12 8 4.5 8C5.88 8 7 9.12 7 10.5C7 11.88 5.88 13 4.5 13C3.12 13 2 11.88 2 10.5Z" fill="white" fillOpacity="0.9"/>
                    <path d="M7 10.5V3.5L14 2V9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M9 9.5C9 8.12 10.12 7 11.5 7C12.88 7 14 8.12 14 9.5C14 10.88 12.88 12 11.5 12C10.12 12 9 10.88 9 9.5Z" fill="white" fillOpacity="0.9"/>
                  </svg>
                </Box>
              </UnstyledButton>
            </Tooltip>
          </Center>
        ) : (
          <Box style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Logo />
            <Tooltip label="Collapse sidebar" position="right" withArrow>
              <UnstyledButton
                onClick={() => setCollapsed(true)}
                className={classes.collapseBtn}
                aria-label="Collapse sidebar"
              >
                <IconChevronLeft size={16} />
              </UnstyledButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      <AppShell.Section grow>
        {!collapsed && <Text className={classes.sectionLabel}>MENU</Text>}
        <Stack justify="flex-start" gap={2}>
          <NavbarLink icon={IconHome2} label={t("navigation.dashboard")} activePath="/" collapsed={collapsed} />
          <SearchLink collapsed={collapsed} />
          <TrendingLink collapsed={collapsed} />
          <NavbarLink icon={IconUsers} label={t("navigation.most-popular")} activePath="/most-popular" collapsed={collapsed} />
        </Stack>
        <Divider className={classes.divider} style={{ margin: collapsed ? "8px 12px" : undefined }} />
        {!collapsed && <Text className={classes.sectionLabel}>YOUR LIBRARY</Text>}
        <Stack justify="flex-start" gap={2}>
          <NavbarLink icon={IconHeart} label={t("navigation.favorites")} activePath="/favorites" collapsed={collapsed} />
          <NavbarLink icon={IconMusic} label={t("navigation.playlists")} activePath="/playlists" collapsed={collapsed} />
          <NavbarLink icon={IconUserHeart} label="Following" activePath="/following" collapsed={collapsed} />
          <NavbarLink icon={IconHistory} label={t("navigation.history")} activePath="/history" collapsed={collapsed} />
          <NavbarLink icon={IconCategory} label={t("genre.title")} activePath="/genres" collapsed={collapsed} />
        </Stack>
      </AppShell.Section>

      <AppShell.Section className={classes.bottomSection}>
        <Divider className={classes.divider} style={{ margin: collapsed ? "8px 12px" : undefined }} />
        {!collapsed && <PlayerSpace />}
      </AppShell.Section>

      {collapsed && (
        <Box style={{ padding: "8px 0 16px" }}>
          <Center>
            <Tooltip label="Expand" position="right" withArrow>
              <UnstyledButton onClick={() => setCollapsed(false)} className={classes.collapseBtn} aria-label="Expand sidebar">
                <IconChevronRight size={16} />
              </UnstyledButton>
            </Tooltip>
          </Center>
        </Box>
      )}
    </AppShell.Navbar>
  );
});

const SearchLink = memo(({ collapsed }: { collapsed: boolean }) => {
  const navigate = useStableNavigate();
  const url = useSearchUrl();
  const { t } = useTranslation();
  return <NavbarLink icon={IconSearch} label={t("navigation.search")} onClick={() => navigate(url)} activePath="/search" collapsed={collapsed} />;
});

const TrendingLink = memo(({ collapsed }: { collapsed: boolean }) => {
  const navigate = useStableNavigate();
  const url = useTrendingUrl();
  const { t } = useTranslation();
  return <NavbarLink icon={IconTrendingUp} label={t("navigation.trending")} onClick={() => navigate(url)} activePath="/trending" collapsed={collapsed} />;
});
