import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { type SettingsTab, settingsTabHref } from "../domain/tabs";

/**
 * Horizontal tab navigator of Settings. Each tab is a link to ?tab=<key>: the
 * server renders the chosen tab, so it works on refresh, as a deep link and
 * without JavaScript. Links are reachable with Tab and activated with Enter;
 * the active one is announced with aria-current.
 *
 * `tabs` are the ones the user's role may open (settingsTabsFor): the others
 * are not rendered at all.
 */
export async function SettingsTabs({ tabs, active }: { tabs: SettingsTab[]; active: SettingsTab }) {
  const t = await getTranslations("settings");
  return (
    <nav aria-label={t("tabsAriaLabel")} className="mb-6 border-b border-ink-700">
      <ul className="-mb-px flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const current = tab === active;
          return (
            <li key={tab}>
              <Link
                href={settingsTabHref(tab)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "block rounded-t-md border-b-2 px-4 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint-500",
                  current
                    ? "border-mint-500 bg-mint-500/10 text-mint-400"
                    : "border-transparent text-slate-400 hover:border-ink-600 hover:bg-ink-800 hover:text-slate-100",
                )}
              >
                {t(`tabs.${tab}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
