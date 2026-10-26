/**
 * The server environment: fail-fast validation, the SITE_URL rules, and the
 * guarantees that keep secrets server-side (no NEXT_PUBLIC_ variable, one env
 * module, never imported by a client component, .env.example in sync).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseServerEnv, SERVER_ENV_KEYS } from "../env";

const ROOT = process.cwd();
const VALID = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_value-never-printed",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_value",
  SITE_URL: "https://app.tecfys.com",
};

const errorOf = (source: Record<string, string | undefined>) => {
  try {
    parseServerEnv(source);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected parseServerEnv to throw");
};

describe("parseServerEnv", () => {
  it("accepts the required variables and leaves the integrations optional", () => {
    const env = parseServerEnv(VALID);
    expect(env.SITE_URL).toBe("https://app.tecfys.com");
    expect(env.HOLDED_API_KEY).toBeUndefined();
    expect(env.INFORMA_USERNAME).toBeUndefined();
  });

  it("names every missing required variable in one error", () => {
    const message = errorOf({});
    for (const key of ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_PUBLISHABLE_KEY", "SITE_URL"]) expect(message).toContain(key);
    expect(message).toMatch(/^Invalid server environment/);
  });

  it("treats an empty value as missing, and ignores empty optional ones", () => {
    expect(errorOf({ ...VALID, SUPABASE_SECRET_KEY: "  " })).toContain("SUPABASE_SECRET_KEY is missing");
    expect(parseServerEnv({ ...VALID, SIGNATURIT_API_URL: "", HOLDED_API_KEY: "" }).SIGNATURIT_API_URL).toBeUndefined();
  });

  it("never prints a value, only names and reasons", () => {
    const message = errorOf({ ...VALID, SITE_URL: "http://app.tecfys.com", SUPABASE_URL: "not a url sb_secret_value" });
    expect(message).toContain("SITE_URL");
    expect(message).toContain("SUPABASE_URL");
    expect(message).not.toContain("sb_secret_value");
    expect(message).not.toContain("app.tecfys.com");
  });
});

describe("SITE_URL", () => {
  const site = (value: string) => parseServerEnv({ ...VALID, SITE_URL: value }).SITE_URL;

  it("supports each deployment's origin, normalised without a trailing slash", () => {
    expect(site("https://app.tecfys.com")).toBe("https://app.tecfys.com");
    expect(site("https://staging.tecfys.com/")).toBe("https://staging.tecfys.com");
    expect(site(" HTTPS://Staging.Tecfys.com ")).toBe("https://staging.tecfys.com");
    expect(site("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(site("http://localhost:3100")).toBe("http://localhost:3100");
  });

  it("requires https outside localhost", () => {
    expect(errorOf({ ...VALID, SITE_URL: "http://app.tecfys.com" })).toContain("SITE_URL must use https");
  });

  it("rejects anything that is not a bare origin", () => {
    for (const value of ["app.tecfys.com", "https://app.tecfys.com/auth", "https://app.tecfys.com?x=1", "https://u:p@app.tecfys.com", "ftp://app.tecfys.com"]) {
      expect(errorOf({ ...VALID, SITE_URL: value })).toContain("SITE_URL");
    }
  });
});

// ---------------------------------------------------------------------------
// Secrets stay server-side
// ---------------------------------------------------------------------------
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [full] : [];
  });
const CODE = [...sourceFiles(path.join(ROOT, "src")), ...sourceFiles(path.join(ROOT, "scripts")), path.join(ROOT, "next.config.ts")]
  .filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`))
  .map((file) => ({ file: path.relative(ROOT, file), text: readFileSync(file, "utf8") }));
const exampleKeys = readFileSync(path.join(ROOT, ".env.example"), "utf8")
  .split(/\r?\n/)
  .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
  .map((line) => line.slice(0, line.indexOf("=")));

describe("secrets never reach the browser", () => {
  it("no code reads or declares a NEXT_PUBLIC_ variable", () => {
    expect(CODE.filter(({ text }) => text.includes("NEXT_PUBLIC_")).map(({ file }) => file)).toEqual([]);
    expect(exampleKeys.filter((key) => key.startsWith("NEXT_PUBLIC_"))).toEqual([]);
  });

  it("the app reads process.env only through src/lib/env.ts (plus the runtime check in instrumentation)", () => {
    const readers = CODE.filter(({ file, text }) => file.startsWith(`src${path.sep}`) && /process\.env\b/.test(text)).map(({ file }) => file.split(path.sep).join("/"));
    expect(readers.sort()).toEqual(["src/instrumentation.ts", "src/lib/env.ts"]);
    const instrumentation = CODE.find(({ file }) => file.endsWith("instrumentation.ts"))!.text;
    expect([...instrumentation.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1])).toEqual(["NEXT_RUNTIME"]);
  });

  it("no client component imports the env module", () => {
    const clientImporters = CODE.filter(({ text }) => /^\s*["']use client["']/.test(text) && text.includes("@/lib/env")).map(({ file }) => file);
    expect(clientImporters).toEqual([]);
  });

  it(".env.example lists exactly the variables the server reads", () => {
    expect([...exampleKeys].sort()).toEqual([...SERVER_ENV_KEYS].sort());
  });

  it(".env.example holds no value for a secret", () => {
    const lines = readFileSync(path.join(ROOT, ".env.example"), "utf8").split(/\r?\n/).filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line));
    expect(lines.filter((line) => !line.endsWith("="))).toEqual([]);
  });
});
