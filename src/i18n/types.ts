import type { Locale } from "./config";
import type messages from "./messages/es.json";

/** The Spanish file is the source of truth: a key that is not in it does not type-check. */
export type Messages = typeof messages;

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
