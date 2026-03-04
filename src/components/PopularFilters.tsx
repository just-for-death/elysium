import { Select } from "@mantine/core";
import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";
import { countriesCode } from "../utils/countriesCode";

interface PopularFiltersProps {
  country: string | null;
  onChange: (country: string | null) => void;
}

export const PopularFilters: FC<PopularFiltersProps> = memo(({ country, onChange }) => {
  const { t } = useTranslation();

  return (
    <Select
      searchable
      value={country}
      onChange={onChange}
      data={countriesCode}
      placeholder={t("search.filter.region") as string}
    />
  );
});
