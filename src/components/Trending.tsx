import { Alert, Text } from "@mantine/core";
import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";

import { useSettings } from "../providers/Settings";
import { useTrendingFiltersValues } from "../providers/TrendingFilters";
import { getTrendings } from "../services/trending";
import { CardList } from "./CardList";
import { HorizontalGridList } from "./HorizontalGridList";

interface TrendingProps {
  horizontal?: boolean;
}

export const Trending: FC<TrendingProps> = memo(({ horizontal = false }) => {
  const settings = useSettings();
  const trendingFiltersValues = useTrendingFiltersValues();
  const currentInstance = settings?.currentInstance;
  const query = useQuery(
    [
      "trending",
      trendingFiltersValues.type,
      trendingFiltersValues.region,
      currentInstance?.uri,
    ],
    () => getTrendings(currentInstance!, trendingFiltersValues),
    {
      enabled:
        Boolean(trendingFiltersValues.region) && Boolean(currentInstance?.uri),
    },
  );
  const { t } = useTranslation();

  if (query.isError) {
    return <Text>{t("error")}</Text>;
  }

  if (query.isLoading || !query.data) {
    return <Text>{t("loading")}</Text>;
  }

  if (horizontal) {
    if (!query.data.length) {
      return (
        <Alert title={t("recently.play.alert.title")}>
          <Text>{t("recently.play.alert.message")}</Text>
        </Alert>
      );
    }
    return (
      <HorizontalGridList data={query.data.slice(0, 10)} label="Trending" />
    );
  }

  return <CardList data={query.data} label="Trending" />;
});
