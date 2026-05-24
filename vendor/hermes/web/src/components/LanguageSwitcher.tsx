import { useEffect, useRef, useState } from "react";
import { Check, Languages } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Typography } from "@/components/NouiTypography";
import { LOCALE_META, useI18n, type Locale } from "@/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = LOCALE_META[locale] ?? LOCALE_META.zh;
  const allLocales = Object.entries(LOCALE_META) as Array<
    [Locale, typeof current]
  >;

  return (
    <div ref={containerRef} className="relative inline-flex">
      <Button
        ghost
        onClick={() => setOpen((v) => !v)}
        title={t.language.switchTo}
        aria-label={t.language.switchTo}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="px-2 py-1 normal-case tracking-normal font-normal text-xs text-muted-foreground hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <Languages className="h-3.5 w-3.5" />
          <Typography
            mondwest
            className="hidden sm:inline tracking-wide uppercase text-[0.65rem]"
          >
            {current.shortName}
          </Typography>
        </span>
      </Button>

      {open && (
        <div
          role="listbox"
          aria-label={t.language.switchTo}
          className="absolute right-0 top-full z-50 mt-1 min-w-[9rem] rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {allLocales.map(([code, meta]) => {
            const selected = code === locale;
            return (
              <button
                key={code}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setLocale(code);
                  setOpen(false);
                }}
                className={
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground " +
                  (selected
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground")
                }
              >
                <span className="w-5 text-[0.68rem] uppercase">
                  {meta.shortName}
                </span>
                <span className="truncate">{meta.name}</span>
                {selected && <Check className="ml-auto h-3 w-3" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
