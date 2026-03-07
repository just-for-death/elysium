import { getSettings } from "../database/utils";
import type { SponsorBlockSegment } from "../types/interfaces/SponsorBlock";

interface Data {
  segments: SponsorBlockSegment[];
}

export const getSponsorBlockSegments = async (
  videoId: string,
): Promise<Data> => {
  const { deviceId, sponsorBlockCategories } = getSettings();
  const categories = (sponsorBlockCategories ?? []).join(",");
  const params = new URLSearchParams({
    deviceId: deviceId ?? "",
    videoId,
    categories,
  });
  const base = process.env.REACT_APP_API_URL ?? "";
  const url = `${base}/api/sponsorBlock?${params}`;
  try {
    // 3s timeout — SponsorBlock must never delay audio starting
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { segments: [] };
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      return { segments: Array.isArray(data?.segments) ? data.segments : [] };
    } catch {
      return { segments: [] };
    }
  } catch {
    return { segments: [] };
  }
};
