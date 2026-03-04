import {
  getDefaultInstance,
  normalizeInstanceUri,
} from "../utils/invidiousInstance";
import { log } from "../utils/logger";
import type { Instance } from "../types/interfaces/Instance";

const INSTANCES_URL =
  "https://api.invidious.io/instances.json?sort_by=api,health";

export const fetchInvidiousInstances = async () => {
  try {
    const response = await fetch(INSTANCES_URL);
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      log.fetchError("fetchInvidiousInstances", INSTANCES_URL, response, text, parseErr);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (err) {
    log.warn("fetchInvidiousInstances failed", err);
    return [];
  }
};

export const filterAndParseInstances = (instances: any[]): Instance[] => {
  const parsed = instances
    .filter(([, instance]) => instance?.api === true)
    .map(([domain, instance]) => {
      const rawUri =
        instance.uri ||
        (instance.type && domain ? `${instance.type}://${domain}` : "");
      const uri = normalizeInstanceUri(rawUri);
      return {
        domain: domain || "",
        api: true,
        cors: instance.cors ?? false,
        flag: instance.flag ?? "🌐",
        monitor: instance.monitor ?? {},
        region: instance.region ?? "US",
        stats: instance.stats ?? {},
        type: instance.type === "https" ? "https" : "https",
        uri: uri || `https://${domain}`,
        custom: false,
      } as Instance;
    });

  // API often returns no api:true instances; ensure we always have our default
  const defaultInstance = getDefaultInstance();
  const hasDefault = parsed.some(
    (i) => i.domain === defaultInstance.domain || i.uri === defaultInstance.uri,
  );
  if (!hasDefault) {
    parsed.unshift(defaultInstance);
  }
  return parsed.length > 0 ? parsed : [defaultInstance];
};
