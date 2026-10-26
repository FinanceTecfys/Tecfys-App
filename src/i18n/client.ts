import { useTranslations } from "next-intl";
import type { Translate } from "./message";

/**
 * The component-side counterpart of getTranslate(): a translator for keys only
 * known at run time (a message a domain function returned, a lifecycle hint).
 * An unknown key is shown as it is. It is a hook over next-intl's
 * useTranslations, so it works in client components and in (non-async) Server
 * Components alike. Components that know their keys use useTranslations(),
 * which type-checks them.
 */
export function useTranslate(): Translate {
  const t = useTranslations();
  return (key, values) => (t.has(key as never) ? t(key as never, values as never) : key);
}
