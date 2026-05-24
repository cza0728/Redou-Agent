import { createContext } from "react";
import { zh } from "./zh";
import type { Locale, Translations } from "./types";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translations;
}

export const I18nContext = createContext<I18nContextValue>({
  locale: "zh",
  setLocale: () => {},
  t: zh,
});
