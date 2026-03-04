import type { CardVideo } from "../types/interfaces/Card";
import type { Instance } from "../types/interfaces/Instance";
import { getApplePopular } from "./apple-charts";

export const getPopuplars = async (
  _instance: Instance,
  country: string | null = null,
): Promise<CardVideo[]> => {
  return getApplePopular(country, 30, _instance?.uri);
};
