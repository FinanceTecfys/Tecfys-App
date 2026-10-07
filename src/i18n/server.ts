import { getTranslations } from "next-intl/server";
import type { Translate } from "./message";

/**
 * The translator for Server Components, Server Actions and route handlers when
 * the key is only known at run time (a validation key from a zod schema, a
 * message a domain function returned). A string that is not a key of the
 * catalogue is returned as it is: that is how a database or provider error
 * message passes through untouched.
 *
 * Code that knows its keys statically uses next-intl's getTranslations()
 * directly, which type-checks them.
 */
export async function getTranslate(): Promise<Translate> {
  const t = await getTranslations();
  return (key, values) => (t.has(key as never) ? t(key as never, values as never) : key);
}

/** Field errors of a failed zod parse ({ field: message }), each message translated from its key. */
export function fieldErrorsOf(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }, translate: Translate): Record<string, string> {
  return Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), translate(issue.message)]));
}
