import { Flex } from "@mantine/core";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";

import { PageHeader } from "../components/PageHeader";
import { Popular } from "../components/Popular";
import { PopularFilters } from "../components/PopularFilters";

const getCountryCode = async (): Promise<string> => {
  const base = process.env.REACT_APP_API_URL ?? "";
  const url = base ? `${base}/api/countryCode` : `${window.location.origin}/api/countryCode`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data?.country ?? "US";
  } catch {
    return "US";
  }
};

export const PopularPage = memo(() => {
  const { t } = useTranslation();
  const [country, setCountry] = useState<string | null>(null);

  // Auto-detect user's country on first load
  useQuery("country-code-popular", getCountryCode, {
    enabled: !country,
    onSuccess: (cc: string) => setCountry(cc),
  });

  return (
    <div>
      <PageHeader title={t("page.most-populars.title")}>
        <Flex align="center" ml="auto" gap="md">
          <PopularFilters country={country} onChange={setCountry} />
        </Flex>
      </PageHeader>
      <Popular country={country} />
    </div>
  );
});
