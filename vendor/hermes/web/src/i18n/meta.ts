import type { Locale } from "./types";

export const LOCALE_META: Record<
  Locale,
  { name: string; shortName: string }
> = {
  zh: { name: "\u4e2d\u6587", shortName: "\u4e2d" },
  en: { name: "English", shortName: "EN" },
};
