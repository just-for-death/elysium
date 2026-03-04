import { Box, Text, UnstyledButton } from "@mantine/core";
import { memo } from "react";
import { useStableNavigate } from "../providers/Navigate";

export const Logo = memo(() => {
  const navigate = useStableNavigate();

  return (
    <UnstyledButton
      onClick={() => navigate("/")}
      style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none" }}
    >
      <Box
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #2ab5a5 0%, #0a5e65 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 2px 16px rgba(42,181,165,0.4)",
          transition: "transform 0.22s cubic-bezier(0.34,1.02,0.64,1), box-shadow 0.22s ease",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 10.5C2 9.12 3.12 8 4.5 8C5.88 8 7 9.12 7 10.5C7 11.88 5.88 13 4.5 13C3.12 13 2 11.88 2 10.5Z" fill="white" fillOpacity="0.9"/>
          <path d="M7 10.5V3.5L14 2V9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M9 9.5C9 8.12 10.12 7 11.5 7C12.88 7 14 8.12 14 9.5C14 10.88 12.88 12 11.5 12C10.12 12 9 10.88 9 9.5Z" fill="white" fillOpacity="0.9"/>
        </svg>
      </Box>
      <Text
        style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontWeight: 800,
          fontSize: "19px",
          letterSpacing: "-0.03em",
          lineHeight: 1,
          background: "linear-gradient(135deg, #f0fafa 0%, #6dddd1 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        Elysium
      </Text>
    </UnstyledButton>
  );
});
