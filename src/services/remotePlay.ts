import { getSettings } from "../database/utils";
import { log } from "../utils/logger";

export interface PingRemotePlayResponse {
  deviceId: string;
  videoId: string;
}

export const pingRemotePlay = async (): Promise<PingRemotePlayResponse | null> => {
  const base = process.env.REACT_APP_API_URL ?? "";
  const deviceId = getSettings().deviceId ?? "";
  const url = `${base}/api/remotePlay?deviceUuid=${deviceId}`;
  try {
    const response = await fetch(url);
    const text = await response.text();
    if (!text) return null;
    try {
      const json = JSON.parse(text);
      return json?.data ?? null;
    } catch (err) {
      log.fetchError("pingRemotePlay (JSON parse)", url, response, text, err);
      return null;
    }
  } catch (err) {
    log.warn("pingRemotePlay failed", { url, err });
    return null;
  }
};

export interface SendToRemoteDevicePayload {
  deviceUuid: string;
  videoId: string;
}

export const sendToRemoteDevice = ({
  deviceUuid,
  videoId,
}: SendToRemoteDevicePayload) => {
  const base = process.env.REACT_APP_API_URL ?? "";
  return fetch(`${base}/api/remotePlay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deviceUuid,
      videoId,
    }),
  });
};

export const clearRemoteDevice = (deviceUuid: string) => {
  const base = process.env.REACT_APP_API_URL ?? "";
  return fetch(
    `${base}/api/clearRemotePlay?deviceUuid=${deviceUuid}`,
  );
};
