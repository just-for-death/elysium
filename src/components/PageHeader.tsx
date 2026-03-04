import { Flex, Space, Title } from "@mantine/core";
import type { FC, ReactNode } from "react";

import { ButtonHistoryBack } from "./ButtonHistoryBack";

interface PageHeaderProps {
  title: string;
  canGoBack?: boolean;
  children?: ReactNode;
}

export const PageHeader: FC<PageHeaderProps> = ({
  title,
  canGoBack = false,
  children,
}) => {
  return (
    <Flex gap={20} align="center" mb="xl" style={{ paddingTop: 24 }}>
      {canGoBack ? <ButtonHistoryBack /> : null}
      <Title
        order={1}
        style={{
          fontFamily: "Plus Jakarta Sans, sans-serif",
          fontWeight: 700,
          fontSize: "clamp(1.5rem, 4vw, 2.5rem)",
          color: "#ffffff",
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        {title}
      </Title>
      <Space h={28} />
      {children ?? null}
    </Flex>
  );
};

