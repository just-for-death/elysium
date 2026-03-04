import { Select } from "@mantine/core";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import {
  useSetTrendingFiltersValues,
  useTrendingFiltersValues,
} from "../providers/TrendingFilters";
import { countriesCode } from "../utils/countriesCode";

export type TrendingFilterType = "music";

export const TrendingFilters = memo(() => {
  const { t } = useTranslation();
  const trendingFiltersValues = useTrendingFiltersValues();
  const setTrendingFiltersValues = useSetTrendingFiltersValues();

  return (
    <>
      <Select
        searchable
        value={trendingFiltersValues.region}
        onChange={(value) =>
          setTrendingFiltersValues({
            ...trendingFiltersValues,
            region: value as string,
          })
        }
        data={countriesCode}
        placeholder={t("search.filter.region") as string}
      />
    </>
  );
});
