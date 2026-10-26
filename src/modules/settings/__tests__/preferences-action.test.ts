import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * updatePreferences against an in-memory profiles table: every role may save
 * its own language and theme, only valid values are stored, and only ever on
 * the session user's own row. No real Supabase.
 */
type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  user: null as { id: string; role: string; partnerDistributorId: string | null; language: string; theme: string } | null,
  capabilities: [] as string[],
  profiles: [] as Record<string, unknown>[],
  updates: [] as { values: Record<string, unknown>; filters: [string, unknown][] }[],
  cookies: [] as { name: string; value: string; options: Record<string, unknown> }[],
  revalidated: [] as unknown[][],
  dbError: null as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => void state.revalidated.push(args) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (name: string, value: string, options: Row) => void state.cookies.push({ name, value, options }) }),
}));
// The action translates its errors; here a message is its key.
vi.mock("next-intl/server", () => ({ getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}` }));
vi.mock("@/lib/supabase/auth", () => ({
  requireRole: vi.fn(async (capability: string) => {
    state.capabilities.push(capability);
    if (!state.user) throw new Error("NEXT_REDIRECT /login");
    return state.user;
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  db: () => ({
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      const filters: [string, unknown][] = [];
      let values: Row = {};
      const query = {
        update: (v: Row) => ((values = v), query),
        eq: (column: string, value: unknown) => (filters.push([column, value]), query),
        select: async () => {
          state.updates.push({ values, filters });
          if (state.dbError) return { data: null, error: { message: state.dbError } };
          const hit = state.profiles.filter((r) => filters.every(([c, v]) => r[c] === v));
          hit.forEach((r) => Object.assign(r, values));
          return { data: hit.map((r) => ({ user_id: r.user_id })), error: null };
        },
      };
      return query;
    },
  }),
}));

import { CAPABILITIES } from "@/lib/auth/permissions";
import { LOCALES } from "@/i18n/config";
import { documentAttributes, resolvePreferences, THEMES } from "@/lib/theme";
import { updatePreferences } from "../actions";
import { preferencesSchema } from "../domain/preferences";

const user = (role: string, id = `user-${role}`) => ({ id, role, partnerDistributorId: null, language: "es", theme: "green" });
const profileOf = (id: string) => state.profiles.find((p) => p.user_id === id)!;

beforeEach(() => {
  state.user = user("partner");
  state.capabilities = [];
  state.updates = [];
  state.cookies = [];
  state.revalidated = [];
  state.dbError = null;
  state.profiles = ["owner", "admin", "sales", "partner"].map((role) => ({ user_id: `user-${role}`, role, active: true, language: "es", theme: "green" }));
});

describe("preferencesSchema", () => {
  it("accepts every language and theme the app has, and nothing else", () => {
    for (const language of LOCALES) for (const theme of THEMES) expect(preferencesSchema.safeParse({ language, theme }).success, `${language} ${theme}`).toBe(true);
    for (const bad of [
      { language: "fr", theme: "green" }, { language: "es", theme: "dark" }, { language: "", theme: "" }, { language: "ES", theme: "green" },
      { language: "es" }, { theme: "blue" }, {}, { language: null, theme: null }, { language: ["es"], theme: "green" },
    ]) {
      expect(preferencesSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("keeps only the two preferences: no other profile column can ride along", () => {
    expect(preferencesSchema.parse({ language: "en", theme: "blue", role: "owner", active: false, user_id: "user-owner" })).toEqual({ language: "en", theme: "blue" });
  });
});

describe("updatePreferences", () => {
  it("asks for preferences.manage, a capability every role holds", async () => {
    await updatePreferences({ language: "en", theme: "blue" });
    expect(state.capabilities).toEqual(["preferences.manage"]);
    expect(CAPABILITIES).toContain("preferences.manage");

    state.user = null;
    await expect(updatePreferences({ language: "en", theme: "blue" })).rejects.toThrow("NEXT_REDIRECT");
    expect(state.updates).toHaveLength(1);
  });

  it("every role saves its own language and theme", async () => {
    for (const role of ["owner", "admin", "sales", "partner"]) {
      state.user = user(role);
      expect(await updatePreferences({ language: "en", theme: "blue" }), role).toEqual({ ok: true });
      expect(profileOf(`user-${role}`)).toMatchObject({ language: "en", theme: "blue", role, active: true });
    }
  });

  it("writes the session user's row only, whatever the request carries", async () => {
    state.user = user("partner");
    const smuggled = { language: "en", theme: "blue", user_id: "user-owner", role: "owner", active: false } as unknown as { language: string; theme: string };
    expect(await updatePreferences(smuggled)).toEqual({ ok: true });
    expect(state.updates).toEqual([{ values: { language: "en", theme: "blue" }, filters: [["user_id", "user-partner"]] }]);
    expect(profileOf("user-partner")).toMatchObject({ language: "en", theme: "blue", role: "partner", active: true });
    for (const other of ["owner", "admin", "sales"]) expect(profileOf(`user-${other}`), other).toMatchObject({ language: "es", theme: "green", role: other, active: true });
  });

  it("the stored theme is what the page gets as data-theme, and the stored language as lang", async () => {
    await updatePreferences({ language: "en", theme: "blue" });
    expect(documentAttributes(resolvePreferences(profileOf("user-partner")))).toEqual({ lang: "en", "data-theme": "blue" });
    await updatePreferences({ language: "es", theme: "green" });
    expect(documentAttributes(resolvePreferences(profileOf("user-partner")))).toEqual({ lang: "es", "data-theme": "green" });
  });

  it("re-renders the whole app and remembers the language on this browser for the login page", async () => {
    await updatePreferences({ language: "en", theme: "green" });
    expect(state.revalidated).toEqual([["/", "layout"]]);
    expect(state.cookies).toHaveLength(1);
    expect(state.cookies[0]).toMatchObject({ name: "tecfys_lang", value: "en", options: { path: "/", httpOnly: true, sameSite: "lax" } });
  });

  it("refuses a language or theme it does not know, and stores nothing", async () => {
    for (const bad of [{ language: "fr", theme: "green" }, { language: "es", theme: "purple" }, { language: "", theme: "" }]) {
      expect(await updatePreferences(bad), JSON.stringify(bad)).toEqual({ ok: false, error: "preferences.errors.invalid" });
    }
    expect(state.updates).toEqual([]);
    expect(state.cookies).toEqual([]);
    expect(state.revalidated).toEqual([]);
    expect(profileOf("user-partner")).toMatchObject({ language: "es", theme: "green" });
  });

  it("reports a failed write, or a user with no profile row, without touching the cookie", async () => {
    state.dbError = "connection refused";
    expect(await updatePreferences({ language: "en", theme: "blue" })).toEqual({ ok: false, error: "preferences.errors.notSaved" });

    state.dbError = null;
    state.user = user("sales", "user-without-profile");
    expect(await updatePreferences({ language: "en", theme: "blue" })).toEqual({ ok: false, error: "preferences.errors.notSaved" });
    expect(state.cookies).toEqual([]);
    expect(state.revalidated).toEqual([]);
  });
});
