/**
 * The invitation only works if three things agree: the email template links to
 * the app's set-password page with the token hash, config.toml points Supabase
 * at that template, and the page accepts exactly that link. Read from disk so
 * an edit to any of them is caught here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/auth/routes";
import { tomlValue } from "@/lib/auth/supabase-config";
import { LINK_TYPES, parsePasswordLink, passwordLinkPath } from "../set-password";

const SUPABASE = path.join(process.cwd(), "supabase");
const config = readFileSync(path.join(SUPABASE, "config.toml"), "utf8");
const HASH = "3f9a1c0b7d2e4f6a8b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c";

describe("auth email templates", () => {
  for (const type of LINK_TYPES) {
    describe(type, () => {
      const contentPath = tomlValue(config, `auth.email.template.${type}`, "content_path");
      const template = () => readFileSync(path.join(process.cwd(), JSON.parse(contentPath!)), "utf8");
      /** The href of the template with Supabase's Go-template variables filled in. */
      const renderedLink = () => {
        const href = template().match(/<a href="([^"]+)"/)?.[1];
        return href?.replace("{{ .SiteURL }}", "http://127.0.0.1:3000").replace("{{ .TokenHash }}", HASH);
      };

      it("is registered in config.toml with a subject and an existing file", () => {
        expect(contentPath).toBe(`"./supabase/templates/${type}.html"`);
        expect(tomlValue(config, `auth.email.template.${type}`, "subject")).toMatch(/^".+"$/);
        expect(template().length).toBeGreaterThan(100);
      });

      it("links to the app's set-password page with the token hash, on the site URL", () => {
        const link = renderedLink();
        expect(link).toBe(`http://127.0.0.1:3000${passwordLinkPath({ tokenHash: HASH, type })}`);
      });

      it("is a link the page accepts and the proxy lets through without a session", () => {
        const url = new URL(renderedLink()!);
        expect(isPublicPath(url.pathname)).toBe(true);
        expect(parsePasswordLink(Object.fromEntries(url.searchParams))).toEqual({ tokenHash: HASH, type });
      });

      it("does not use Supabase's own verify link, which would spend the token on open", () => {
        const body = template().replace(/<!--[\s\S]*?-->/g, "");
        expect(body).not.toContain("{{ .ConfirmationURL }}");
        expect(body).not.toContain("{{ .Token }}");
        expect(body.match(/<a /g)).toHaveLength(1);
      });
    });
  }

  it("keeps the site URL the links are built on", () => {
    expect(tomlValue(config, "auth", "site_url")).toMatch(/^"https?:\/\/[^"]+"$/);
  });
});
