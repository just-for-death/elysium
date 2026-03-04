import { ActionIcon, Menu } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";

import { usePlayerUrl, usePlayerVideo } from "../providers/Player";

interface ButtonDownloadProps {
  iconSize?: number;
}

export const ButtonDownload: FC<ButtonDownloadProps> = memo(({ iconSize }) => {
  const { video } = usePlayerVideo();
  const playerUrl = usePlayerUrl();
  const { t } = useTranslation();

  if (!video) return null;

  const formats = video.adaptiveFormats ?? [];
  const handleDownload = () => {
    if (playerUrl) window.open(playerUrl, "_blank");
  };

  return (
    <Menu>
      <Menu.Target>
        <ActionIcon color="transparent" title={t("download.sound")}>
          <IconDownload size={iconSize} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown mah={400} style={{ overflow: "auto" }}>
        {formats.map((format, index) => (
          <Menu.Item
            key={format.type ?? format.itag ?? format.index ?? `format-${index}`}
            onClick={() => handleDownload()}
          >
            <span>
              {(format.type ?? "audio/mpeg")
                .replace(";", ",")
                .replace('="', ": ")
                .replace('"', "")}
            </span>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
});
