import { createContext } from "react";
import { BUILTIN_THEMES, defaultTheme } from "./presets";
import type { DashboardTheme } from "./types";

export interface ThemeContextValue {
  availableThemes: ThemeSummary[];
  setTheme: (name: string) => void;
  theme: DashboardTheme;
  themeName: string;
}

export interface ThemeSummary {
  description: string;
  label: string;
  name: string;
  definition?: DashboardTheme;
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: defaultTheme,
  themeName: "default",
  availableThemes: Object.values(BUILTIN_THEMES).map((t) => ({
    name: t.name,
    label: t.label,
    description: t.description,
  })),
  setTheme: () => {},
});
