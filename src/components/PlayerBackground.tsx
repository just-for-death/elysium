import { Box } from "@mantine/core";
import { memo } from "react";

import { usePlayerVideo } from "../providers/Player";
import classes from "./PlayerBackground.module.css";

const hexToRgba = (hex: string, alpha: string): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const PlayerBackground = memo(() => {
  const { primaryColor } = usePlayerVideo();

  return (
    <Box
      className={classes.background}
      style={{
        backgroundColor: hexToRgba(primaryColor?.color as string, "0.8"),
      }}
    />
  );
});
