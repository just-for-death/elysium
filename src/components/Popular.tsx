import { Alert, Text } from "@mantine/core";
import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";

import { useSettings } from "../providers/Settings";
import { getPopuplars } from "../services/popular";
import { CardList } from "./CardList";
import { HorizontalGridList } from "./HorizontalGridList";

interface PopularProps {
  horizontal?: boolean;
  country?: string | null;
}

export const Popular: FC<PopularProps> = memo(({ horizontal, country = null }) => {
  const settings = useSettings();
  const currentInstance = settings?.currentInstance;
  const query = useQuery(
    ["most-popular", currentInstance?.uri, country],
    () => getPopuplars(currentInstance!, country),
    { enabled: Boolean(currentInstance?.uri) },
  );
  const { t } = useTranslation();

  if (!query.data) {
    return <Text>{t("loading")}</Text>;
  }

  if (query.error) {
    return <Text>{t("error")}</Text>;
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
      <HorizontalGridList data={query.data.slice(0, 10)} label="Most Popular" />
    );
  }

  return <CardList data={query.data} />;
});
