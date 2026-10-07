"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type Locale, LOCALES } from "@/i18n/config";
import { type ThemeMode, THEMES } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { updatePreferences } from "../actions";

/** One labelled group of mutually exclusive options, as native radio buttons. */
function Choice<T extends string>({
  name,
  legend,
  hint,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  hint: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-[11px] uppercase tracking-[0.14em] text-slate-400">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md border px-3.5 py-2 text-sm transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-mint-500",
              option.value === value ? "border-mint-500 bg-mint-500/10 text-mint-400" : "border-ink-700 text-slate-300 hover:border-ink-600",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="h-4 w-4 accent-mint-500"
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">{hint}</p>
    </fieldset>
  );
}

/**
 * The user's own language and theme mode. Saving stores them on the profile
 * and refreshes the route, so the whole app - this form included - is rendered
 * again by the server in the new language and with the new data-theme.
 */
export function PreferencesForm({ language: initialLanguage, theme: initialTheme }: { language: Locale; theme: ThemeMode }) {
  const t = useTranslations("preferences");
  const router = useRouter();
  const [language, setLanguage] = useState<Locale>(initialLanguage);
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSaving] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startSaving(async () => {
      const res = await updatePreferences({ language, theme });
      if (!res.ok) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-6">
      <Choice
        name="language"
        legend={t("language.label")}
        hint={t("language.hint")}
        options={LOCALES.map((value) => ({ value, label: t(`languages.${value}`) }))}
        value={language}
        onChange={(value) => {
          setLanguage(value);
          setSaved(false);
        }}
      />
      <Choice
        name="theme"
        legend={t("theme.label")}
        hint={t("theme.hint")}
        options={THEMES.map((value) => ({ value, label: t(`themes.${value}`) }))}
        value={theme}
        onChange={(value) => {
          setTheme(value);
          setSaved(false);
        }}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="info">{t("saved")}</Alert>}
      <Button type="submit" disabled={saving}>
        {saving ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
