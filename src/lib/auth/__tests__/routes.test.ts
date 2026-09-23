import { describe, expect, it } from "vitest";
import { config } from "@/proxy";
import { authDecision, HOME_PATH, isPublicPath, LOGIN_PATH, loginRedirectPath, safeNextPath } from "../routes";

describe("isPublicPath", () => {
  it("only the login page is public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/")).toBe(true);
    for (const p of ["/", "/contracts", "/contracts/export", "/loginx", "/login/extra", "/scoring/new", "/api/anything"]) {
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
      "/\\evil.example", "\\\\evil.example", "javascript:alert(1)", "http:/evil.example", "/login", "/login?next=/x",
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
  const decide = (pathname: string, authenticated: boolean, search = "") => authDecision({ pathname, search, authenticated });

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

describe("proxy matcher", () => {
  // Next compiles the matcher as a full-path regular expression.
  const [pattern] = config.matcher;
  const runs = (path: string) => new RegExp(`^${pattern}$`).test(path);

  it("runs on every page, route handler and server action path", () => {
    for (const p of ["/", "/login", "/contracts", "/contracts/export", "/contracts/x/draft", "/contracts/x/attachments/bank_certificate", "/scoring/new"]) {
      expect(runs(p), p).toBe(true);
    }
  });

  it("skips Next's assets and static images", () => {
    for (const p of ["/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/brand/logo.svg", "/x.png", "/a/b.webp"]) {
      expect(runs(p), p).toBe(false);
    }
  });
});
