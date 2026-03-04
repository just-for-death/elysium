import { Badge, Space, Text } from "@mantine/core";
import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";

import pkg from "../../package.json";

interface AppVersionProps {
  align?: "left" | "center" | "right";
}

export const AppVersion: FC<AppVersionProps> = memo(({ align = "left" }) => {
  const { t } = useTranslation();

  return (
    <Text
      style={{ textAlign: align }}
      title={t("app.version")}
    >
      <Space h={4} />
      <Badge variant="light" size="xs">
        {pkg.version}
      </Badge>
    </Text>
  );
});
