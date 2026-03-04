import { MantineProvider as Provider, createTheme } from "@mantine/core";
import type { FC, PropsWithChildren } from "react";

const elysiumTheme = createTheme({
  fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', 'Fira Code', monospace",
  defaultRadius: "md",
  primaryColor: "teal",
  colors: {
    teal: [
      "#e6f9f8",
      "#c2efec",
      "#8dddd7",
      "#6dddd1",
      "#33d4c3",
      "#2ab5a5",
      "#239b8d",
      "#0a5e65",
      "#0a3d42",
      "#061e21",
    ],
  },
  breakpoints: {
    xs: "30em",
    sm: "50em",
    md: "48em",
    lg: "75em",
    xl: "90em",
  },
  other: {
    bgColor: "#0a1214",
    surfaceColor: "#0f1d21",
    accentColor: "#2ab5a5",
  },
  components: {
    Card: {
      defaultProps: { withBorder: false },
      styles: {
        root: {
          backgroundColor: "var(--sp-surface)",
          transition: "background 0.22s ease, transform 0.22s ease",
        },
      },
    },
    ActionIcon: {
      defaultProps: { variant: "transparent" },
      styles: {
        root: {
          color: "var(--sp-text-secondary)",
          transition: "color 0.15s ease, transform 0.15s ease",
        },
      },
    },
    Button: {
      defaultProps: { radius: "xl" },
      styles: {
        root: {
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontWeight: 600,
          letterSpacing: "0.01em",
          transition: "all 0.22s ease",
        },
      },
    },
    TextInput: {
      styles: {
        input: {
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          backgroundColor: "var(--sp-surface-hover)",
          borderColor: "var(--sp-border)",
          color: "var(--sp-text-primary)",
          transition: "border-color 0.2s ease, background 0.2s ease",
        },
      },
    },
    PasswordInput: {
      styles: {
        input: {
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          backgroundColor: "var(--sp-surface-hover)",
          borderColor: "var(--sp-border)",
          color: "var(--sp-text-primary)",
        },
      },
    },
    Slider: {
      styles: {
        thumb: { borderWidth: 0, width: 12, height: 12 },
        bar: { backgroundColor: "var(--sp-accent)" },
      },
    },
    Modal: {
      styles: {
        content: { backgroundColor: "#0f2228", border: "1px solid var(--sp-border)" },
        header: { backgroundColor: "#0f2228" },
        title: { fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, color: "var(--sp-text-primary)" },
      },
    },
    Menu: {
      styles: {
        dropdown: {
          backgroundColor: "#0f2228",
          border: "1px solid var(--sp-border)",
          backdropFilter: "blur(12px)",
        },
        item: {
          color: "var(--sp-text-secondary)",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontSize: "14px",
          transition: "background 0.15s ease, color 0.15s ease",
        },
        label: { color: "var(--sp-text-muted)", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase" },
      },
    },
    Tooltip: {
      styles: {
        tooltip: {
          backgroundColor: "#1d3540",
          color: "var(--sp-text-primary)",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          border: "1px solid var(--sp-border)",
        },
      },
    },
    Badge: {
      styles: {
        root: {
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontWeight: 600,
          letterSpacing: "0.05em",
        },
      },
    },
    Title: {
      styles: {
        root: {
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontWeight: 700,
          color: "var(--sp-text-primary)",
          letterSpacing: "-0.02em",
        },
      },
    },
    Text: {
      styles: {
        root: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
      },
    },
    Switch: {
      styles: {
        track: {
          backgroundColor: "var(--sp-surface-hover)",
          borderColor: "var(--sp-border)",
        },
        thumb: { borderColor: "var(--sp-border)" },
      },
    },
  },
});

export const MantineProvider: FC<PropsWithChildren> = ({ children }) => {
  return (
    <Provider defaultColorScheme="dark" theme={elysiumTheme}>
      {children}
    </Provider>
  );
};

