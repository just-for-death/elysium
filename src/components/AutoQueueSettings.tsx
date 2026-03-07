import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Card,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconBrain,
  IconCheck,
  IconCompass,
  IconInfoCircle,
  IconMicrophone2,
  IconPlayerPlay,
  IconSparkles,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { memo, useState } from "react";

import { db } from "../database";
import { useSetSettings, useSettings } from "../providers/Settings";
import { testOllamaConnection } from "../services/ollama";
import { testLastfmApiKey } from "../services/autoQueue";
import type { QueueMode } from "../services/autoQueue";

const DEFAULT_OLLAMA_URL   = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2:3b";

const isRemoteOrigin =
  typeof window !== "undefined" &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1";

// ─── The three primary modes shown as cards ───────────────────────────────────

const PRIMARY_MODES = [
  {
    value: "discover" as QueueMode,
    label: "Discover",
    subtitle: "Random new music",
    description:
      "Pulls from Apple iTunes Top 50 + ListenBrainz global trending in parallel. " +
      "Both lists are shuffled and merged — fastest option, zero setup, no login needed.",
    icon: <IconCompass size={20} />,
    color: "pink",
    requiresLB: false,
    requiresOllama: false,
  },
  {
    value: "similar" as QueueMode,
    label: "Similar",
    subtitle: "Same artist · same vibe",
    description:
      "Finds tracks sonically close to what's playing using Last.fm (track.getSimilar, " +
      "artist.getSimilar, and same-artist top tracks — all in parallel). " +
      "Works for any artist worldwide including Bollywood, K-pop, and more. Requires a Last.fm API key.",
    icon: <IconPlayerPlay size={20} />,
    color: "teal",
    requiresLB: false,
    requiresOllama: false,
  },
  {
    value: "my_taste" as QueueMode,
    label: "My Taste",
    subtitle: "Personalised · AI-powered",
    description:
      "Analyses your ListenBrainz history — top artists, top tracks, recent listens, " +
      "and CF recommendations — then feeds the full picture to Ollama which picks the " +
      "best next song for your exact mood. Requires Ollama; LB token makes it much better.",
    icon: <IconUser size={20} />,
    color: "violet",
    requiresLB: true,
    requiresOllama: true,
  },
] as const;

// ─── Last.fm API Key sub-component (reused in Similar + My Taste) ────────────

const LastfmKeySection = memo(({
  lastfmKey,
  onChange,
}: {
  lastfmKey: string;
  onChange: (key: string) => void;
}) => {
  const [testing, setTesting]   = useState(false);
  const [status, setStatus]     = useState<"idle" | "ok" | "fail">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleTest = async () => {
    setTesting(true);
    setStatus("idle");
    const result = await testLastfmApiKey(lastfmKey.trim());
    setTesting(false);
    if (result.ok) {
      setStatus("ok");
      showNotification({
        title: "Last.fm",
        message: `API key valid — confirmed via artist lookup`,
        color: "green",
        icon: <IconCheck size={16} />,
      });
    } else {
      setStatus("fail");
      setErrorMsg(result.error ?? "Invalid key");
      showNotification({
        title: "Last.fm",
        message: result.error ?? "API key invalid",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  return (
    <Box>
      <Text size="xs" fw={600} c="dimmed" mb={6} style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Last.fm API Key <Text span size="xs" c="dimmed">(optional fallback)</Text>
      </Text>
      <Group gap="xs" align="flex-start">
        <TextInput
          style={{ flex: 1 }}
          placeholder="Paste your Last.fm API key"
          value={lastfmKey}
          onChange={(e) => {
            onChange(e.currentTarget.value);
            setStatus("idle");
          }}
          size="sm"
          rightSection={
            status === "ok" ? (
              <IconCheck size={16} color="var(--mantine-color-green-5)" />
            ) : status === "fail" ? (
              <IconX size={16} color="var(--mantine-color-red-5)" />
            ) : null
          }
          error={status === "fail" ? errorMsg : undefined}
        />
        <Button
          size="sm"
          variant="light"
          color="red"
          loading={testing}
          disabled={!lastfmKey.trim()}
          leftSection={<IconMicrophone2 size={16} />}
          onClick={handleTest}
        >
          Test
        </Button>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        Required for Similar mode. Free at{" "}
        <a
          href="https://www.last.fm/api/account/create"
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--mantine-color-blue-4)" }}
        >
          last.fm/api/account/create
        </a>
      </Text>
    </Box>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────

export const AutoQueueSettings = memo(() => {
  const settings = useSettings();
  const setSettings = useSetSettings();

  // Derive effective mode — map legacy ollama → my_taste
  const rawSaved: string = (settings as any).queueMode ?? "off";
  const savedMode: QueueMode =
    rawSaved === "ollama" ? "my_taste" : (rawSaved as QueueMode);

  const [mode, setMode]         = useState<QueueMode>(savedMode);
  const [ollamaUrl, setOllamaUrl]     = useState<string>((settings as any).ollamaUrl   ?? DEFAULT_OLLAMA_URL);
  const [ollamaModel, setOllamaModel] = useState<string>((settings as any).ollamaModel ?? DEFAULT_OLLAMA_MODEL);
  const [lastfmKey, setLastfmKey]     = useState<string>((settings as any).lastfmQueueApiKey ?? "");
  const [testing, setTesting]   = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);

  const lbToken    = settings.listenBrainzToken;
  const lbUsername = settings.listenBrainzUsername;
  const hasLB = !!(lbToken && lbUsername);

  const save = (patch: Record<string, unknown>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    db.update("settings", { ID: 1 }, (row: any) => ({ ...row, ...patch }));
    db.commit();
  };

  const handleModeSelect = (value: QueueMode) => {
    setMode(value);
    save({
      queueMode: value,
      ollamaEnabled: value === "my_taste" || value === "ollama",
    });
  };

  const handleLastfmChange = (key: string) => {
    setLastfmKey(key);
    save({ lastfmQueueApiKey: key.trim() });
  };

  const handleTestOllama = async () => {
    setTesting(true);
    setOllamaConnected(null);
    const trimmed = ollamaUrl.trim() || DEFAULT_OLLAMA_URL;
    const result = await testOllamaConnection(trimmed);
    setTesting(false);

    if (result.ok) {
      setOllamaConnected(true);
      setAvailableModels(result.models);
      const preferred = ["llama3.2:3b", "qwen2.5:3b", "llama3.2:1b", "qwen2.5:1.5b", "gemma2:2b"];
      const best = result.models.includes(ollamaModel)
        ? ollamaModel
        : preferred.find((m) => result.models.includes(m)) ?? result.models[0] ?? ollamaModel;
      setOllamaModel(best);
      save({ ollamaUrl: trimmed, ollamaModel: best });
      showNotification({
        title: "Ollama",
        message: `Connected — ${result.models.length} model${result.models.length !== 1 ? "s" : ""} available`,
        color: "green",
        icon: <IconCheck size={16} />,
      });
    } else {
      setOllamaConnected(false);
      showNotification({
        title: "Ollama",
        message: isRemoteOrigin
          ? "Could not connect. Set OLLAMA_ORIGINS=* on your Ollama host and use its LAN IP."
          : "Could not connect. Make sure Ollama is running.",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  const modelOptions =
    availableModels.length > 0
      ? availableModels.map((m) => ({ value: m, label: m }))
      : [{ value: ollamaModel, label: ollamaModel }];

  const isPrimary = PRIMARY_MODES.some((m) => m.value === mode);

  return (
    <Stack gap="md">

      {/* ── Off toggle ── */}
      <Group justify="space-between" align="center">
        <Box>
          <Text size="sm" fw={500}>Auto Queue</Text>
          <Text size="xs" c="dimmed">Automatically queue the next track when one is about to end</Text>
        </Box>
        <Badge
          color={mode === "off" ? "gray" : "green"}
          variant="light"
          size="sm"
          style={{ cursor: "pointer" }}
          onClick={() => handleModeSelect(mode === "off" ? "discover" : "off")}
        >
          {mode === "off" ? "Off" : "On"}
        </Badge>
      </Group>

      {mode !== "off" && (
        <>
          <Divider style={{ borderColor: "rgba(255,255,255,0.06)" }} />

          {/* ── Three primary mode cards ── */}
          <Box>
            <Text size="xs" fw={600} c="dimmed" mb={8} style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Queue Mode
            </Text>
            <Stack gap="xs">
              {PRIMARY_MODES.map((m) => {
                const isSelected = mode === m.value;
                const needsLBWarning = m.requiresLB && !hasLB;
                return (
                  <Card
                    key={m.value}
                    padding="sm"
                    radius="md"
                    withBorder
                    style={{
                      cursor: "pointer",
                      borderColor: isSelected
                        ? `var(--mantine-color-${m.color}-6)`
                        : "rgba(255,255,255,0.07)",
                      background: isSelected
                        ? `color-mix(in srgb, var(--mantine-color-${m.color}-9) 30%, transparent)`
                        : "rgba(255,255,255,0.02)",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                    onClick={() => handleModeSelect(m.value)}
                  >
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      <ThemeIcon
                        color={m.color}
                        variant={isSelected ? "filled" : "light"}
                        size="lg"
                        radius="md"
                        style={{ flexShrink: 0, marginTop: 2 }}
                      >
                        {m.icon}
                      </ThemeIcon>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" align="center">
                          <Text size="sm" fw={600}>{m.label}</Text>
                          <Text size="xs" c="dimmed">— {m.subtitle}</Text>
                          {isSelected && (
                            <Badge color={m.color} variant="light" size="xs" ml="auto">Active</Badge>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed" mt={2} style={{ lineHeight: 1.5 }}>
                          {m.description}
                        </Text>
                        {needsLBWarning && isSelected && (
                          <Text size="xs" c="yellow" mt={4}>
                            ⚠ No ListenBrainz token — add one in ListenBrainz settings for personalised results.
                          </Text>
                        )}
                      </Box>
                    </Group>
                  </Card>
                );
              })}
            </Stack>
          </Box>

          {/* ── My Taste: Ollama config + LB status + Last.fm fallback ── */}
          {mode === "my_taste" && (
            <>
              <Divider style={{ borderColor: "rgba(255,255,255,0.06)" }} />

              <Text size="xs" fw={600} c="dimmed" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Ollama — AI Engine
              </Text>

              {isRemoteOrigin && (
                <Alert icon={<IconInfoCircle size={16} />} color="yellow" variant="light">
                  <Text size="xs">
                    Set <code>OLLAMA_ORIGINS=*</code> on your Ollama host and use its LAN IP, not <code>localhost</code>.
                  </Text>
                </Alert>
              )}

              {/* ListenBrainz status — shows what data Ollama will receive */}
              {!hasLB ? (
                <Alert icon={<IconSparkles size={16} />} color="violet" variant="light">
                  <Text size="xs">
                    Add your <strong>ListenBrainz token</strong> in the ListenBrainz settings section —
                    Ollama will use your top artists, top tracks, recent listens, and CF recommendations
                    for much more accurate, taste-matched suggestions.
                  </Text>
                </Alert>
              ) : (
                <Alert icon={<IconCheck size={16} />} color="green" variant="light">
                  <Text size="xs">
                    ListenBrainz connected as <strong>{lbUsername}</strong> — Ollama will use your{" "}
                    <strong>top artists</strong>, <strong>top tracks</strong>,{" "}
                    <strong>recent listens</strong>, and <strong>CF recommendations</strong>{" "}
                    to match every suggestion to your exact taste.
                  </Text>
                </Alert>
              )}

              {/* Ollama URL */}
              <Box>
                <Text size="xs" fw={600} c="dimmed" mb={6} style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Ollama URL
                </Text>
                <Group gap="xs" align="flex-end">
                  <TextInput
                    style={{ flex: 1 }}
                    placeholder={DEFAULT_OLLAMA_URL}
                    value={ollamaUrl}
                    onChange={(e) => {
                      setOllamaUrl(e.currentTarget.value);
                      setOllamaConnected(null);
                    }}
                    size="sm"
                    error={
                      isRemoteOrigin && (ollamaUrl.includes("localhost") || ollamaUrl.includes("127.0.0.1"))
                        ? "Use your host's LAN IP, not localhost"
                        : undefined
                    }
                    rightSection={
                      ollamaConnected === true ? (
                        <IconCheck size={16} color="var(--mantine-color-green-5)" />
                      ) : ollamaConnected === false ? (
                        <IconX size={16} color="var(--mantine-color-red-5)" />
                      ) : null
                    }
                  />
                  <Button
                    size="sm"
                    variant="light"
                    loading={testing}
                    leftSection={<IconBrain size={16} />}
                    onClick={handleTestOllama}
                  >
                    Test
                  </Button>
                </Group>
              </Box>

              {/* Model selector */}
              <Box>
                <Text size="xs" fw={600} c="dimmed" mb={6} style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Model
                </Text>
                <Select
                  data={modelOptions}
                  value={ollamaModel}
                  onChange={(v) => {
                    if (!v) return;
                    setOllamaModel(v);
                    save({ ollamaModel: v });
                  }}
                  size="sm"
                  placeholder="Select model"
                  searchable={availableModels.length > 3}
                />
                {availableModels.length === 0 && (
                  <Text size="xs" c="dimmed" mt={4}>
                    Press <b>Test</b> to load available models from your Ollama instance.
                    Recommended: <code>llama3.2:3b</code> or <code>qwen2.5:3b</code> for GTX 1650.
                  </Text>
                )}
              </Box>

              {ollamaConnected !== null && (
                <Badge color={ollamaConnected ? "green" : "red"} variant="light" size="sm">
                  {ollamaConnected ? "Ollama connected & active" : "Ollama unreachable — suggestions disabled"}
                </Badge>
              )}

              <Divider style={{ borderColor: "rgba(255,255,255,0.06)" }} />

              {/* Last.fm key — also shown in My Taste as additional fallback */}
              <LastfmKeySection lastfmKey={lastfmKey} onChange={handleLastfmChange} />
            </>
          )}

          {/* ── Similar: optional Last.fm key for fallback ── */}
          {mode === "similar" && (
            <>
              <Divider style={{ borderColor: "rgba(255,255,255,0.06)" }} />
              <LastfmKeySection lastfmKey={lastfmKey} onChange={handleLastfmChange} />
              {!hasLB && (
                <Alert icon={<IconInfoCircle size={16} />} color="teal" variant="light">
                  <Text size="xs">
                    Add your <strong>ListenBrainz token</strong> in ListenBrainz settings to blend your
                    personal taste into the Radio results.
                  </Text>
                </Alert>
              )}
            </>
          )}

          {/* ── Legacy mode selector (only shown when a legacy mode is active) ── */}
          {!isPrimary && (
            <>
              <Divider style={{ borderColor: "rgba(255,255,255,0.06)" }} />
              <Box>
                <Text size="xs" fw={600} c="dimmed" mb={6} style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Legacy Mode
                </Text>
                <Select
                  data={[
                    { value: "invidious",      label: "Invidious — YouTube up-next" },
                    { value: "apple_charts",   label: "Apple Charts only" },
                    { value: "listenbrainz",   label: "ListenBrainz trending only" },
                    { value: "lastfm_similar", label: "Last.fm similar (key required)" },
                    { value: "ollama",         label: "Ollama only (no rich context)" },
                  ]}
                  value={mode}
                  onChange={(v) => { if (v) handleModeSelect(v as QueueMode); }}
                  size="sm"
                />
                <Text size="xs" c="dimmed" mt={4}>
                  These are older modes kept for compatibility. We recommend the three options above.
                </Text>
              </Box>
            </>
          )}
        </>
      )}
    </Stack>
  );
});
