import type { TrendingFilters } from "../providers/TrendingFilters";
import type { CardVideo } from "../types/interfaces/Card";
import type { Instance } from "../types/interfaces/Instance";
import { getAppleTrending } from "./apple-charts";

export const getTrendings = async (
  _instance: Instance,
  params: TrendingFilters,
): Promise<CardVideo[]> => {
  // Apple iTunes RSS is country-specific — pass the selected region
  return getAppleTrending(params.region, 30, _instance?.uri);
};
