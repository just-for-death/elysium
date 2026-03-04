import { Box, Flex } from "@mantine/core";
import { memo } from "react";

import { ColorScheme } from "./ColorScheme";
import classes from "./Header.module.css";
import { SearchBar } from "./SearchBar";
import { SearchFilters } from "./SearchFiltersMenu";

export const Header = memo(() => {
  return (
    <header className={classes.container}>
      <SearchBar />
      <Flex gap={8}>
        <SearchFilters />
        <Box visibleFrom="sm">
          <ColorScheme />
        </Box>
      </Flex>
    </header>
  );
});
