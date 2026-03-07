import {
  Accordion,
  Box,
  Divider,
  Flex,
  Group,
  SegmentedControl,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconBell,
  IconBrain,
  IconDatabase,
  IconDevices2,
  IconMicrophone2,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
  IconUser,
} from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ChangeLanguage } from "../components/ChangeLanguage";
import { ExportData } from "../components/ExportData";
import { GotifySettings } from "../components/GotifySettings";
import { ImportData } from "../components/ImportData";
import { InvidiousAccountSettings } from "../components/InvidiousAccountSettings";
import { ListenBrainzSettings } from "../components/ListenBrainzSettings";
import { AutoQueueSettings } from "../components/AutoQueueSettings";
import { PageHeader } from "../components/PageHeader";
import { PushNotificationSettings } from "../components/PushNotificationSettings";
import { SaveData } from "../components/SaveData";
import { SyncSettings } from "../components/SyncSettings";
import { SelectInvidiousInstance } from "../components/SelectInvidiousInstance";
import { SponsorBlockSettings } from "../components/SponsorBlockSettings";
import { SwitchPlausibleAnalytics } from "../components/SwitchPlausibleAnalytics";
import { SwitchVideoMode } from "../components/SwitchVideoMode";
import { useStorage } from "../hooks/useStorage";
import { useSettings } from "../providers/Settings";
import classes from "./Settings.module.css";

/* ── Shared row component ─────────────────────────────────────────────────── */
const SettingRow = ({
  icon,
  color,
  title,
  description,
}: {
  icon: React.ReactNode;
  color: string;
  title: string;
  description?: string;
}) => (
  <Group gap="md" wrap="nowrap">
    <ThemeIcon
      size={38}
      radius={10}
      style={{ background: color, flexShrink: 0 }}
    >
      {icon}
    </ThemeIcon>
    <div style={{ minWidth: 0, flex: 1 }}>
      <Text fw={600} size="sm" style={{ color: "var(--sp-text-primary)" }}>
        {title}
      </Text>
      {description && (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {description}
        </Text>
      )}
    </div>
  </Group>
);

/* ── Section label ────────────────────────────────────────────────────────── */
const SectionLabel = ({ label }: { label: string }) => (
  <Text
    size="xs"
    fw={700}
    c="dimmed"
    style={{
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      padding: "16px 4px 6px",
    }}
  >
    {label}
  </Text>
);

/* ── Main settings page ───────────────────────────────────────────────────── */
export const SettingsPage = memo(() => {
  const { t } = useTranslation();

  return (
    <Box className={classes.page}>
      <PageHeader title={t("page.settings.title")} />
      <Box className={classes.section}>
        <SectionLabel label="General" />
        <Box className={classes.accordionGroup}>
          <Accordion variant="default">
            <GeneralItem />
            <InvidiousAccountItem />
          </Accordion>
        </Box>

        <SectionLabel label="Playback" />
        <Box className={classes.accordionGroup}>
          <Accordion variant="default">
            <PlayerItem />
            <ScrobblingItem />
            <AIQueueItem />
          </Accordion>
        </Box>

        <SectionLabel label="System" />
        <Box className={classes.accordionGroup}>
          <Accordion variant="default">
            <NotificationsItem />
            <ImportExportDataItem />
            <SyncItem />
          </Accordion>
        </Box>

        <StorageCard />
        <DeviceUuidCard />
      </Box>
    </Box>
  );
});

const GeneralItem = memo(() => {
  const { t } = useTranslation("translation", { keyPrefix: "settings.general" });
  return (
    <Accordion.Item value="general">
      <Accordion.Control>
        <SettingRow
          icon={<IconSettings size={20} />}
          color="linear-gradient(135deg,#3a7bd5,#2ab5a5)"
          title={t("title")}
          description={t("description")}
        />
      </Accordion.Control>
      <Accordion.Panel>
        <Box mt="xs">
          <Text size="xs" fw={600} c="dimmed" mb={6} style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Instance
          </Text>
          <Text size="sm" c="dimmed" mb={10}>{t("invidious.description")}</Text>
          <SelectInvidiousInstance />
        </Box>
        <Divider my="md" style={{ borderColor: "rgba(255,255,255,0.06)" }} />
        <Box>
          <Text size="xs" fw={600} c="dimmed" mb={6} style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Language
          </Text>
          <ChangeLanguage />
        </Box>
        <AnalyticsItem />
      </Accordion.Panel>
    </Accordion.Item>
  );
});

const AnalyticsItem = memo(() => {
  if (process.env.REACT_APP_PLAUSIBLE_ANALYTICS !== "true") return null;
  return (
    <>
      <Divider my="md" style={{ borderColor: "rgba(255,255,255,0.06)" }} />
      <SwitchPlausibleAnalytics />
    </>
  );
});

const PlayerItem = memo(() => {
  const { t } = useTranslation("translation", { keyPrefix: "settings.player" });
  return (
    <Accordion.Item value="player">
      <Accordion.Control>
        <SettingRow
          icon={<IconPlayerPlay size={20} />}
          color="linear-gradient(135deg,#e85d04,#f48c06)"
          title={t("title")}
          description={t("description")}
        />
      </Accordion.Control>
      <Accordion.Panel>
        <Box mt="xs">
          <Text size="xs" fw={600} c="dimmed" mb={6} style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("video.mode.title")}
          </Text>
          <SwitchVideoMode />
        </Box>
        <Divider my="md" style={{ borderColor: "rgba(255,255,255,0.06)" }} />
        <Box>
          <Text size="xs" fw={600} c="dimmed" mb={6} style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("sponsorBlock.title")}
          </Text>
          <SponsorBlockSettings />
        </Box>
      </Accordion.Panel>
    </Accordion.Item>
  );
});

const InvidiousAccountItem = memo(() => {
  const settings = useSettings();
  const isLoggedIn = !!settings.invidiousSid && !!settings.invidiousUsername;
  return (
    <Accordion.Item value="invidious-account">
      <Accordion.Control>
        <SettingRow
          icon={<IconUser size={20} />}
          color="linear-gradient(135deg,#7209b7,#3a0ca3)"
          title="Invidious Account"
          description={isLoggedIn ? `Logged in as ${settings.invidiousUsername}` : "Log in to sync playlists"}
        />
      </Accordion.Control>
      <Accordion.Panel>
        <Box mt="xs">
          <InvidiousAccountSettings />
        </Box>
      </Accordion.Panel>
    </Accordion.Item>
  );
});

const ScrobblingItem = memo(() => (
  <Accordion.Item value="scrobbling">
    <Accordion.Control>
      <SettingRow
        icon={<IconMicrophone2 size={20} />}
        color="linear-gradient(135deg,#d00000,#e85d04)"
        title="Scrobbling"
        description="ListenBrainz scrobbling"
      />
    </Accordion.Control>
    <Accordion.Panel>
      <Box mt="xs">
        <ListenBrainzSettings />
      </Box>
    </Accordion.Panel>
  </Accordion.Item>
));

const AIQueueItem = memo(() => {
  const settings = useSettings();
  const queueMode: string = (settings as any).queueMode ?? "off";
  const legacyOllama = settings.ollamaEnabled && !!settings.ollamaUrl;
  const effectiveMode = queueMode !== "off" ? queueMode : legacyOllama ? "ollama" : "off";
  const modeLabel: Record<string, string> = {
    off: "Auto-queue off",
    invidious: "YouTube recommendations",
    apple_charts: "Apple Charts",
    listenbrainz: "ListenBrainz trending",
    lastfm_similar: "Last.fm similar tracks",
    ollama: "Ollama AI",
  };
  return (
    <Accordion.Item value="ai-queue">
      <Accordion.Control>
        <SettingRow
          icon={<IconBrain size={20} />}
          color="linear-gradient(135deg,#7b2ff7,#2ab5a5)"
          title="Auto Queue"
          description={effectiveMode === "off" ? "Automatically queue next songs" : `Active: ${modeLabel[effectiveMode] ?? effectiveMode}`}
        />
      </Accordion.Control>
      <Accordion.Panel>
        <Box mt="xs">
          <AutoQueueSettings />
        </Box>
      </Accordion.Panel>
    </Accordion.Item>
  );
});

const NotificationsItem = memo(() => (
  <Accordion.Item value="notifications">
    <Accordion.Control>
      <SettingRow
        icon={<IconBell size={20} />}
        color="linear-gradient(135deg,#0077b6,#0096c7)"
        title="Notifications"
        description="Push notifications and new release alerts"
      />
    </Accordion.Control>
    <Accordion.Panel>
      <Box mt="xs">
        <PushNotificationSettings />
        <Divider my="md" style={{ borderColor: "rgba(255,255,255,0.06)" }} />
        <GotifySettings />
      </Box>
    </Accordion.Panel>
  </Accordion.Item>
));

type ImportExportTab = "import" | "export" | "save";
const ImportExportDataItem = memo(() => {
  const [type, setType] = useState<ImportExportTab>("import");
  const { t } = useTranslation("translation", { keyPrefix: "settings.data" });
  return (
    <Accordion.Item value="data">
      <Accordion.Control>
        <SettingRow
          icon={<IconDatabase size={20} />}
          color="linear-gradient(135deg,#2d6a4f,#40916c)"
          title={t("title")}
          description={t("description")}
        />
      </Accordion.Control>
      <Accordion.Panel>
        <Box mt="sm">
          <SegmentedControl
            fullWidth
            data={[
              { label: t("import"), value: "import" },
              { label: t("export"), value: "export" },
              { label: t("save"),   value: "save"   },
            ]}
            onChange={(v) => setType(v as ImportExportTab)}
            styles={{
              root: { background: "rgba(255,255,255,0.05)", borderRadius: 8 },
            }}
          />
          <Box mt="md">
            {type === "import" && <ImportData />}
            {type === "export" && <ExportData />}
            {type === "save"   && <SaveData />}
          </Box>
        </Box>
      </Accordion.Panel>
    </Accordion.Item>
  );
});

const SyncItem = memo(() => (
  <Accordion.Item value="sync">
    <Accordion.Control>
      <SettingRow
        icon={<IconRefresh size={20} />}
        color="linear-gradient(135deg,#2ab5a5,#0a5e65)"
        title="Device Sync"
        description="Sync your data across multiple devices"
      />
    </Accordion.Control>
    <Accordion.Panel>
      <Box mt="xs">
        <SyncSettings />
      </Box>
    </Accordion.Panel>
  </Accordion.Item>
));

/* ── Info cards ───────────────────────────────────────────────────────────── */
const StorageCard = memo(() => {
  const storage = useStorage();
  const { t } = useTranslation();
  const hasUsage = useMemo(() => !!(storage?.usage && storage.usage > 0), [storage]);
  const pct = Number(storage?.percentageUsed ?? 0);
  if (!storage) return null;
  return (
    <Box
      mt="md"
      p="md"
      style={{
        background: "var(--sp-surface)",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <Flex align="center" gap="sm" mb="sm">
        <ThemeIcon size={32} radius={8} style={{ background: "linear-gradient(135deg,#2ab5a5,#0a5e65)" }}>
          <IconDatabase size={16} />
        </ThemeIcon>
        <Text fw={600} size="sm" style={{ color: "var(--sp-text-primary)" }}>Storage</Text>
      </Flex>
      <Box
        style={{
          height: 6, borderRadius: 3,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
          marginBottom: 8,
        }}
      >
        <Box
          style={{
            height: "100%",
            width: `${Math.min(pct, 100)}%`,
            borderRadius: 3,
            background: pct > 80 ? "#e85d04" : "var(--sp-accent)",
            transition: "width 0.4s ease",
          }}
        />
      </Box>
      <Flex justify="space-between">
        <Text size="xs" c="dimmed">Used: <strong style={{ color: "var(--sp-text-primary)" }}>{pct}%{hasUsage ? ` (${storage.formatedUsage})` : ""}</strong></Text>
        <Text size="xs" c="dimmed">Available: <strong style={{ color: "var(--sp-text-primary)" }}>{storage.formatedQuota}</strong></Text>
      </Flex>
    </Box>
  );
});

const DeviceUuidCard = memo(() => {
  const settings = useSettings();
  const { t } = useTranslation();
  return (
    <Box
      mt="sm"
      p="md"
      style={{
        background: "var(--sp-surface)",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <Flex align="center" gap="sm" mb={6}>
        <ThemeIcon size={32} radius={8} style={{ background: "linear-gradient(135deg,#555,#333)" }}>
          <IconDevices2 size={16} />
        </ThemeIcon>
        <Text fw={600} size="sm" style={{ color: "var(--sp-text-primary)" }}>
          {t("settings.general.device.uuid")}
        </Text>
      </Flex>
      <Text
        size="xs"
        style={{
          color: "var(--sp-text-muted)",
          fontFamily: "monospace",
          wordBreak: "break-all",
          lineHeight: 1.6,
        }}
      >
        {settings.deviceId}
      </Text>
    </Box>
  );
});
