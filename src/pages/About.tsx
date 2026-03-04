import { Anchor, Space, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";

import pkg from "../../package.json";
import { PageHeader } from "../components/PageHeader";

export const AboutPage = () => {
  const { t } = useTranslation("translation", {
    keyPrefix: "page.about",
  });

  return (
    <div>
      <PageHeader title={t("title")} />
      <Text mt="sm" mb="xl">
        <strong>Elysium</strong> {t("description1")}
        <Anchor href="https://invidious.io/" target="_blank" ml={4}>
          Invidious
        </Anchor>{" "}
        {t("description2")}
      </Text>
      <Title order={3}>{t("version")}</Title>
      <Text mt="sm">{pkg.version}</Text>
      <Space h={28} />
      <Title order={3}>Author</Title>
      <Text mt="sm">Yashwin</Text>
    </div>
  );
};
