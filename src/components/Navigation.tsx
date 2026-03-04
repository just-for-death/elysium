import { AppShell, Box, Center, Divider, Stack, Text } from "@mantine/core";
import {
  IconCategory,
  IconHeart,
  IconHistory,
  IconHome2,
  IconMusic,
  IconSearch,
  IconSettings,
  IconTrendingUp,
  IconUserHeart,
  IconUsers,
} from "@tabler/icons-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { useSearchUrl } from "../hooks/useSearchUrl";
import { useStableNavigate } from "../providers/Navigate";
import { useTrendingUrl } from "../providers/TrendingFilters";
import { DevicePresenceWidget } from "./DevicePresenceWidget";
import { Logo } from "./Logo";
import { NavbarLink } from "./NavbarLink";
import classes from "./Navigation.module.css";
import { PlayerSpace } from "./Player";

const NAVIGATION_WIDTH = 232;

export const Navigation = memo(() => {
  const { t } = useTranslation();

  return (
    <AppShell.Navbar
      aria-label="App navigation"
      w={{ base: NAVIGATION_WIDTH }}
      className={classes.navbar}
    >
      <Box className={classes.logoSection}>
        <Logo />
      </Box>
      <AppShell.Section grow>
        <Text className={classes.sectionLabel}>MENU</Text>
        <Stack justify="flex-start" gap={2}>
          <NavbarLink
            icon={IconHome2}
            label={t("navigation.dashboard")}
            activePath="/"
          />
          <SearchLink />
          <TrendingLink />
          <NavbarLink
            icon={IconUsers}
            label={t("navigation.most-popular")}
            activePath="/most-popular"
          />
        </Stack>
        <Divider className={classes.divider} />
        <Text className={classes.sectionLabel}>YOUR LIBRARY</Text>
        <Stack justify="flex-start" gap={2}>
          <NavbarLink
            icon={IconHeart}
            label={t("navigation.favorites")}
            activePath="/favorites"
          />
          <NavbarLink
            icon={IconMusic}
            label={t("navigation.playlists")}
            activePath="/playlists"
          />
          <NavbarLink
            icon={IconUserHeart}
            label="Following"
            activePath="/following"
          />
          <NavbarLink
            icon={IconHistory}
            label={t("navigation.history")}
            activePath="/history"
          />
          <NavbarLink
            icon={IconCategory}
            label={t("genre.title")}
            activePath="/genres"
          />
        </Stack>
      </AppShell.Section>
      <AppShell.Section className={classes.bottomSection}>
        <Divider className={classes.divider} />
        <Stack justify="flex-start" gap={2}>
          <DevicePresenceWidget />
          <NavbarLink
            icon={IconSettings}
            label={t("navigation.settings")}
            activePath="/settings"
          />
        </Stack>
        <PlayerSpace />
      </AppShell.Section>
    </AppShell.Navbar>
  );
});

const SearchLink = memo(() => {
  const navigate = useStableNavigate();
  const url = useSearchUrl();
  const { t } = useTranslation();

  return (
    <NavbarLink
      icon={IconSearch}
      label={t("navigation.search")}
      onClick={() => navigate(url)}
      activePath="/search"
    />
  );
});

const TrendingLink = memo(() => {
  const navigate = useStableNavigate();
  const url = useTrendingUrl();
  const { t } = useTranslation();

  return (
    <NavbarLink
      icon={IconTrendingUp}
      label={t("navigation.trending")}
      onClick={() => navigate(url)}
      activePath="/trending"
    />
  );
});

