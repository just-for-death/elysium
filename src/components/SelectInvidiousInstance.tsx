import { Badge, Flex, Switch, Table } from "@mantine/core";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { db } from "../database";
import { useSetSettings, useSettings } from "../providers/Settings";
import type { Instance } from "../types/interfaces/Instance";
import type { Settings } from "../types/interfaces/Settings";
import { normalizeDomain, sanitizeInstanceFields } from "../utils/invidiousInstance";
import { ModalAddCustomInstance } from "./ModalAddCustomInstance";
import { ModalDeleteCustomInstance } from "./ModalDeleteCustomInstance";

export const SelectInvidiousInstance = memo(() => {
  const settings = useSettings();
  const { t } = useTranslation("translation", {
    keyPrefix: "settings.general",
  });

  const hasCustomInstances =
    settings.customInstances && settings.customInstances.length > 0;

  return (
    <Table role="list" aria-label="Invidious instances list" highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>
            <Flex align="center">
              {t("invidious.domain")}
              <ModalAddCustomInstance />
            </Flex>
          </Table.Th>
          <Table.Th style={{ width: 100 }}>{t("invidious.type")}</Table.Th>
          <Table.Th style={{ width: 120 }}>{t("invidious.actions")}</Table.Th>
          <Table.Th style={{ width: 120 }}>{t("invidious.default")}</Table.Th>
          {hasCustomInstances ? (
            <Table.Th style={{ width: 60 }}></Table.Th>
          ) : null}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {hasCustomInstances
          ? settings.customInstances.map((instance) => (
              <TableRow key={normalizeDomain(instance.domain)} instance={instance} custom />
            ))
          : null}
        {settings.instances.map((instance) => (
          <TableRow
            key={normalizeDomain(instance.domain)}
            instance={instance}
            lastCell={hasCustomInstances}
          />
        ))}
      </Table.Tbody>
    </Table>
  );
});

const TableRow = memo(
  ({
    instance,
    custom,
    lastCell,
  }: {
    instance: Instance;
    custom?: boolean;
    lastCell?: boolean;
  }) => {
    const settings = useSettings();
    const setSettings = useSetSettings();
    const { t } = useTranslation("translation", {
      keyPrefix: "settings.general",
    });

    // Normalize both sides so "https://foo.com" and "foo.com" compare equal
    const instanceDomain = normalizeDomain(instance.domain);
    const isCurrent = normalizeDomain(settings.currentInstance?.domain) === instanceDomain;
    const isDefault = normalizeDomain(settings.defaultInstance?.domain) === instanceDomain;

    const handleInstanceChange = (
      key: "currentInstance" | "defaultInstance",
      value: Instance | null,
    ) => {
      // Always sanitize before saving to avoid storing protocol prefix in domain
      const sanitized = value ? sanitizeInstanceFields(value) : null;
      db.update("settings", { ID: 1 }, (data: Settings) => ({
        ...data,
        [key]: sanitized,
      }));
      db.commit();
      setSettings((previousState) => ({
        ...previousState,
        [key]: sanitized,
      }));
    };

    // Display domain without protocol prefix
    const displayDomain = instanceDomain;

    return (
      <Table.Tr
        role="listitem"
        aria-label={displayDomain}
        aria-current={isCurrent}
      >
        <Table.Td>
          {instance.flag} {displayDomain}
          {isCurrent ? (
            <Badge size="xs" ml="xs" color="lime">
              {t("invidious.current")}
            </Badge>
          ) : null}
          {isDefault ? (
            <Badge size="xs" ml="xs">
              {t("invidious.default")}
            </Badge>
          ) : null}
          {custom ? (
            <Badge size="xs" ml="xs" color="grape">
              {t("invidious.custom")}
            </Badge>
          ) : null}
        </Table.Td>
        <Table.Td>{instance.type}</Table.Td>
        <Table.Td data-testid="use">
          <Switch
            checked={isCurrent}
            aria-label={t("invidious.use")}
            label={t("invidious.use")}
            onChange={() => handleInstanceChange("currentInstance", instance)}
          />
        </Table.Td>
        <Table.Td style={{ textAlign: "center" }}>
          <Switch
            checked={isDefault}
            aria-label={t("invidious.default")}
            onChange={() =>
              handleInstanceChange(
                "defaultInstance",
                isDefault ? null : instance,
              )
            }
          />
        </Table.Td>
        {lastCell || custom ? (
          <Table.Td>
            {custom ? (
              <ModalDeleteCustomInstance
                disabled={isCurrent || isDefault}
                instance={instance}
              />
            ) : null}
          </Table.Td>
        ) : null}
      </Table.Tr>
    );
  },
);
