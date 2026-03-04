import { Flex, Space, Title } from "@mantine/core";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { LinkSeeAll } from "../components/LinkSeeAll";
import { ListenBrainzRecommendations } from "../components/ListenBrainzRecommendations";
import { ListenBrainzStats } from "../components/ListenBrainzStats";
import { PageHeader } from "../components/PageHeader";
import { Popular } from "../components/Popular";
import { RecentFavorites } from "../components/RecentFavorites";
import { RecentlyPlay } from "../components/RecentlyPlay";
import { Trending } from "../components/Trending";
import { useVideoShareListener } from "../hooks/useVideoShareListener";
import { useCacheRecentTracks } from "../hooks/useCacheRecentTracks";
import { useTrendingFiltersValues } from "../providers/TrendingFilters";

export const DashboardPage = memo(() => {
  const { t } = useTranslation();
  const trendingFilters = useTrendingFiltersValues();

  useVideoShareListener();
  useCacheRecentTracks();

  return (
    <div>
      <PageHeader title={t("page.dashboard.title")} />
      <Space h={20} />
      <RecentlyPlay />
      <Space h={60} />
      <ListenBrainzRecommendations />
      <ListenBrainzStats />
      <RecentFavorites />
      <Space h={60} />
      <Flex align="baseline" gap={12}>
        <Title order={2}>{t("page.trending.title")}</Title>
        <LinkSeeAll to="/trending" />
      </Flex>
      <Space h="lg" />
      <Trending horizontal />
      <Space h={60} />
      <Flex align="baseline" gap={12}>
        <Title order={2}>{t("page.most-populars.title")}</Title>
        <LinkSeeAll to="/most-popular" />
      </Flex>
      <Space h="lg" />
      <Popular horizontal country={trendingFilters.region} />
    </div>
  );
});
