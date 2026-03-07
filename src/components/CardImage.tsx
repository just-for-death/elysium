import { Flex } from "@mantine/core";
import type { FC, ReactNode } from "react";

import classes from "./CardImage.module.css";
import { Image } from "./Image";
import { sanitizeThumbnailUrl } from "../utils/cleanVideoThumbnailsUrl";

interface CardImageProps {
  src: string;
  title: string;
  domain?: string;
  children?: ReactNode;
}

export const CardImage: FC<CardImageProps> = ({
  src,
  title,
  domain = "",
  children,
}) => {
  // sanitizeThumbnailUrl handles all cases:
  // - already-absolute URLs (no domain prepended)
  // - relative paths (domain prepended correctly)
  // - malformed double-URL artefacts stored in the DB (extracted and fixed)
  const safeSrc = sanitizeThumbnailUrl(src, domain);

  return (
    <Flex
      className={classes.imageContainer}
      align="flex-end"
      justify="flex-end"
    >
      <Image
        src={safeSrc}
        alt={title}
        className={classes.image}
        loading="lazy"
      />
      {children ?? null}
    </Flex>
  );
};
