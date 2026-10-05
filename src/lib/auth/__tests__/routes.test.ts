import { describe, expect, it } from "vitest";
import { config } from "@/proxy";
import type { Role } from "../permissions";
import { authDecision, HOME_PATH, isPublicPath, landingPath, LOGIN_PATH, loginRedirectPath, NO_ACCESS_PATH, safeNextPath, SET_PASSWORD_PATH } from "../routes";

describe("isPublicPath", () => {
  it("only the login page and the set-password page of an invitation are public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/")).toBe(true);
    expect(SET_PASSWORD_PATH).toBe("/auth/set-password");
    expect(isPublicPath("/auth/set-password")).toBe(true);
    expect(isPublicPath("/auth/set-password/")).toBe(true);
    for (const p of ["/", "/contracts", "/contracts/export", "/loginx", "/login/extra", "/scoring/new", "/api/anything", "/auth", "/auth/", "/auth/set-password/x", "/auth/other", "/settings/auth/set-password"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});

describe("safeNextPath (no open redirect)", () => {
  it("keeps same-origin paths with their query", () => {
    expect(safeNextPath("/contracts?client=B1&pending=1")).toBe("/contracts?client=B1&pending=1");
    expect(safeNextPath("/contracts/7c9e6679-7425-40de-944b-e07fc1f90ae7")).toBe("/contracts/7c9e6679-7425-40de-944b-e07fc1f90ae7");
  });

  it("sends anything off-site, malformed or looping back to the dashboard", () => {
    for (const bad of [
      null, undefined, "", "contracts", "https://evil.example/x", "//evil.example", "///evil.example",
      "/\\evil.example", "\\\\evil.example", "javascript:alert(1)", "http:/evil.example", "/login", "/login?next=/x", "/auth/set-password?token_hash=abc&type=invite",
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe(HOME_PATH);
    }
  });
});

describe("loginRedirectPath", () => {
  it("remembers where the user was going, except the dashboard itself", () => {
    expect(loginRedirectPath("/")).toBe(LOGIN_PATH);
    expect(loginRedirectPath("/contracts", "?status=Active")).toBe("/login?next=%2Fcontracts%3Fstatus%3DActive");
  });
});

describe("authDecision", () => {
  // The pre-RBAC cases run as the owner, who can open every route.
  const decide = (pathname: string, authenticated: boolean, search = "") =>
    authDecision({ pathname, search, authenticated, role: authenticated ? "owner" : null });

  it("redirects every private route to /login without a session", () => {
    for (const p of ["/", "/contracts", "/contracts/export", "/contracts/x/attachments/id_document", "/portfolio", "/settings", "/scoring/new"]) {
      const d = decide(p, false);
      expect(d.action, p).toBe("redirect");
      expect(d.action === "redirect" && d.location.startsWith(LOGIN_PATH), p).toBe(true);
    }
    expect(decide("/contracts", false, "?q=alfa")).toEqual({ action: "redirect", location: "/login?next=%2Fcontracts%3Fq%3Dalfa" });
  });

  it("lets a signed-in user through everywhere but /login", () => {
    for (const p of ["/", "/contracts", "/contracts/export", "/settings"]) expect(decide(p, true)).toEqual({ action: "next" });
  });

  it("shows /login to anonymous users and sends signed-in users into the app", () => {
    expect(decide("/login", false)).toEqual({ action: "next" });
    expect(decide("/login", true)).toEqual({ action: "redirect", location: HOME_PATH });
    expect(decide("/login", true, "?next=%2Fcontracts%3Fq%3Dalfa")).toEqual({ action: "redirect", location: "/contracts?q=alfa" });
    expect(decide("/login", true, "?next=https%3A%2F%2Fevil.example")).toEqual({ action: "redirect", location: HOME_PATH });
  });

  it("round-trips: the next= a redirect writes is the destination after login", () => {
    const out = decide("/contracts", false, "?client=B1&country=es&country=pt");
    if (out.action !== "redirect") throw new Error("expected redirect");
    const search = out.location.slice(out.location.indexOf("?"));
    expect(decide("/login", true, search)).toEqual({ action: "redirect", location: "/contracts?client=B1&country=es&country=pt" });
  });
});

describe("authDecision by role", () => {
  const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const decide = (pathname: string, role: Role | null, search = "") => authDecision({ pathname, search, authenticated: true, role });

  it("sends a partner to /scoring/new from every route it cannot use, by direct URL", () => {
    for (const p of ["/", "/contracts", "/contracts/export", "/portfolio", "/pipeline", "/pipeline?partner=x", "/erp", "/settings", "/unknown"]) {
      const [pathname, search = ""] = p.split("?");
      expect(decide(pathname, "partner", search && `?${search}`), p).toEqual({ action: "redirect", location: "/scoring/new" });
    }
  });

  it("lets a partner run scoring and create operations", () => {
    for (const p of ["/scoring", "/scoring/new", `/scoring/${ID}`, "/contracts/new", `/contracts/${ID}`, `/contracts/${ID}/draft`]) {
      expect(decide(p, "partner"), p).toEqual({ action: "next" });
    }
  });

  it("sends sales to the dashboard from settings and ERP, and lets it into the rest", () => {
    for (const p of ["/settings", "/erp"]) expect(decide(p, "sales"), p).toEqual({ action: "redirect", location: "/" });
    for (const p of ["/", "/contracts", "/portfolio", "/pipeline", "/scoring/new", "/contracts/new"]) expect(decide(p, "sales"), p).toEqual({ action: "next" });
  });

  it("lets owner and admin through everywhere", () => {
    for (const role of ["owner", "admin"] as const) {
      for (const p of ["/", "/contracts", "/portfolio", "/pipeline", "/erp", "/settings", "/scoring/new"]) expect(decide(p, role), `${role} ${p}`).toEqual({ action: "next" });
    }
  });

  it("a signed-in user with no active role gets no page, and no redirect loop on /login", () => {
    for (const p of ["/", "/scoring/new", "/contracts", "/settings"]) expect(decide(p, null), p).toEqual({ action: "redirect", location: NO_ACCESS_PATH });
    expect(decide("/login", null, "?error=no-access")).toEqual({ action: "next" });
  });

  it("after login a role lands on `next` only if it may open it, else on its home", () => {
    expect(decide("/login", "partner")).toEqual({ action: "redirect", location: "/scoring/new" });
    expect(decide("/login", "partner", "?next=%2Fcontracts")).toEqual({ action: "redirect", location: "/scoring/new" });
    expect(decide("/login", "partner", "?next=%2Fsettings")).toEqual({ action: "redirect", location: "/scoring/new" });
    expect(decide("/login", "partner", `?next=%2Fscoring%2F${ID}`)).toEqual({ action: "redirect", location: `/scoring/${ID}` });
    expect(decide("/login", "sales", "?next=%2Fsettings")).toEqual({ action: "redirect", location: "/" });
    expect(decide("/login", "sales", "?next=%2Fcontracts%3Fq%3Dalfa")).toEqual({ action: "redirect", location: "/contracts?q=alfa" });
    expect(landingPath("partner", "https://evil.example")).toBe("/scoring/new");
    expect(landingPath("owner", null)).toBe("/");
  });
});

describe("authDecision on the set-password page (invitation link)", () => {
  const LINK = "?token_hash=3f9a1c0b7d2e4f6a8b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c&type=invite";
  const decide = (authenticated: boolean, role: Role | null, search: string) => authDecision({ pathname: SET_PASSWORD_PATH, search, authenticated, role });

  it("lets an invited user through with no session, GET and the form POST alike", () => {
    expect(decide(false, null, LINK)).toEqual({ action: "next" });
    expect(decide(false, null, "")).toEqual({ action: "next" });
  });

  it("shows the link even when someone is signed in on this browser: the link's owner takes over", () => {
    for (const role of ["owner", "admin", "sales", "partner"] as const) expect(decide(true, role, LINK), role).toEqual({ action: "next" });
    // Right after the token is verified the invited user has a session and a role; a retry must still post.
    expect(decide(true, "partner", LINK)).toEqual({ action: "next" });
  });

  it("sends a signed-in user with no link into the app, like /login", () => {
    expect(decide(true, "owner", "")).toEqual({ action: "redirect", location: "/" });
    expect(decide(true, "partner", "")).toEqual({ action: "redirect", location: "/scoring/new" });
    expect(decide(true, "sales", "?type=invite")).toEqual({ action: "redirect", location: "/" });
  });

  it("a signed-in user with no active role still sees the page (no redirect loop)", () => {
    expect(decide(true, null, LINK)).toEqual({ action: "next" });
    expect(decide(true, null, "")).toEqual({ action: "next" });
  });

  it("is never a post-login destination", () => {
    expect(safeNextPath(`${SET_PASSWORD_PATH}${LINK}`)).toBe(HOME_PATH);
    expect(landingPath("owner", `${SET_PASSWORD_PATH}${LINK}`)).toBe("/");
  });
});

describe("proxy matcher", () => {
  // Next compiles the matcher as a full-path regular expression.
  const [pattern] = config.matcher;
  const runs = (path: string) => new RegExp(`^${pattern}$`).test(path);

  it("runs on every page, route handler and server action path", () => {
    for (const p of ["/", "/login", "/auth/set-password", "/contracts", "/contracts/export", "/contracts/x/draft", "/contracts/x/attachments/bank_certificate", "/scoring/new"]) {
      expect(runs(p), p).toBe(true);
    }
  });

  it("skips Next's assets and static images", () => {
    for (const p of ["/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/brand/logo.svg", "/x.png", "/a/b.webp"]) {
      expect(runs(p), p).toBe(false);
    }
  });
});
