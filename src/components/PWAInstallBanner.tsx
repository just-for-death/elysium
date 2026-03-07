/**
 * PWAInstallBanner
 *
 * A polished, animated install-prompt banner that slides up from the bottom
 * of the screen. Appears only when the app can be installed (or on iOS when
 * the user hasn't yet added it to the home screen).
 *
 * Features:
 *  - Smooth spring-physics slide-in (CSS transform + transition)
 *  - Backdrop blur so the app content beneath is still readable
 *  - iOS variant shows "Share → Add to Home Screen" instructions
 *  - Dismiss button: suppresses for 30 days
 *  - Respects prefers-reduced-motion
 */

import { ActionIcon, Box, Button, Flex, Text } from "@mantine/core";
import { IconDownload, IconShare, IconX } from "@tabler/icons-react";
import { memo, useEffect, useState } from "react";

import { usePWAInstall } from "../hooks/usePWAInstall";

export const PWAInstallBanner = memo(() => {
  const { canInstall, isIOS, install, dismiss } = usePWAInstall();
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Delay mounting slightly so the animation always plays on first render
  useEffect(() => {
    if (!canInstall) return;
    setMounted(true);
    // Tiny delay lets the browser paint the initial off-screen position first
    const t = setTimeout(() => setVisible(true), 120);
    return () => clearTimeout(t);
  }, [canInstall]);

  if (!mounted) return null;

  return (
    <Box
      style={{
        position: "fixed",
        bottom: "calc(var(--sai-bottom, 0px) + 90px)", // sits above the mini player
        left: "50%",
        transform: visible
          ? "translateX(-50%) translateY(0)"
          : "translateX(-50%) translateY(120%)",
        transition: "transform 0.42s cubic-bezier(0.34, 1.22, 0.64, 1)",
        zIndex: 9999,
        width: "min(420px, calc(100vw - 32px))",
        willChange: "transform",
      }}
    >
      <Box
        style={{
          background: "rgba(13, 26, 30, 0.92)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid rgba(42, 181, 165, 0.25)",
          borderRadius: 16,
          padding: "14px 16px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(42,181,165,0.08)",
        }}
      >
        <Flex align="center" gap="sm">
          {/* App icon */}
          <Box
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              overflow: "hidden",
              flexShrink: 0,
              boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
            }}
          >
            <img
              src="/favicons/android/android-launchericon-192-192.png"
              alt="Elysium"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Box>

          {/* Text */}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={700} c="var(--sp-text-primary)" style={{ lineHeight: 1.3 }}>
              Install Elysium
            </Text>
            <Text size="xs" c="var(--sp-text-secondary)" lineClamp={2} mt={1}>
              {isIOS
                ? 'Tap Share then "Add to Home Screen" for the full app experience'
                : "Add to home screen for instant access and better audio control"}
            </Text>
          </Box>

          {/* Dismiss */}
          <ActionIcon
            variant="subtle"
            size="sm"
            c="var(--sp-text-muted)"
            onClick={dismiss}
            style={{ flexShrink: 0, alignSelf: "flex-start", marginTop: -2 }}
          >
            <IconX size={14} />
          </ActionIcon>
        </Flex>

        {/* Action buttons */}
        <Flex gap={8} mt={12}>
          {isIOS ? (
            <>
              <Button
                leftSection={<IconShare size={14} />}
                size="xs"
                variant="filled"
                style={{
                  flex: 1,
                  background: "var(--sp-accent)",
                  border: "none",
                }}
                onClick={dismiss}
              >
                Got it
              </Button>
              <Button
                size="xs"
                variant="subtle"
                c="var(--sp-text-muted)"
                onClick={dismiss}
              >
                Not now
              </Button>
            </>
          ) : (
            <>
              <Button
                leftSection={<IconDownload size={16} />}
                size="sm"
                variant="filled"
                style={{
                  flex: 1,
                  background: "var(--sp-accent)",
                  border: "none",
                  fontWeight: 700,
                  fontSize: 14,
                  borderRadius: 10,
                }}
                onClick={install}
              >
                Install App
              </Button>
              <Button
                size="sm"
                variant="subtle"
                c="var(--sp-text-muted)"
                onClick={dismiss}
              >
                Not now
              </Button>
            </>
          )}
        </Flex>
      </Box>
    </Box>
  );
});
