import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "../permissions";

/**
 * The server gate must be present on every entry point, even when the UI
 * hides the control. This reads the sources: each page and route handler of
 * the app, and each exported Server Action, has to call requireRole() with a
 * known capability before anything else happens.
 */
const SRC = path.join(process.cwd(), "src");

function files(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : files(full, match);
    return match(entry.name) ? [full] : [];
  });
}

const rel = (file: string) => path.relative(SRC, file).replaceAll("\\", "/");
const GUARD = /await requireRole\("([^"]+)"\)/;
/** Line endings normalised: a Windows checkout has CRLF. */
const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

describe("server-side enforcement is wired everywhere", () => {
  it("every page and route handler of the app asks for a capability", () => {
    const entries = files(path.join(SRC, "app", "(app)"), (name) => name === "page.tsx" || name === "route.ts");
    expect(entries.length).toBeGreaterThanOrEqual(12);
    for (const file of entries) {
      const capability = read(file).match(GUARD)?.[1];
      expect(capability, rel(file)).toBeDefined();
      expect(CAPABILITIES, rel(file)).toContain(capability);
    }
  });

  it("every Server Action starts with requireRole", () => {
    // Login and logout are the only actions that run without a role.
    const PUBLIC_ACTIONS = new Set(["modules/auth/actions.ts:signIn", "modules/auth/actions.ts:signOut"]);
    const actionFiles = files(path.join(SRC, "modules"), (name) => name === "actions.ts");
    expect(actionFiles.map(rel).sort()).toEqual([
      "modules/auth/actions.ts",
      "modules/catalog/actions.ts",
      "modules/contracts/actions.ts",
      "modules/erp/actions.ts",
      "modules/scoring/actions.ts",
      "modules/users/actions.ts",
    ]);

    let checked = 0;
    for (const file of actionFiles) {
      const source = read(file);
      expect(source.startsWith('"use server";'), rel(file)).toBe(true);
      const actions = [...source.matchAll(/^export async function (\w+)\(/gm)];
      expect(actions.length, rel(file)).toBeGreaterThan(0);
      actions.forEach((match, i) => {
        const name = `${rel(file)}:${match[1]}`;
        if (PUBLIC_ACTIONS.has(name)) return;
        const body = source.slice(match.index, actions[i + 1]?.index ?? source.length);
        // The guard is the first statement: nothing is parsed, read or written before it.
        const firstStatement = body.slice(body.indexOf("{\n") + 2).trimStart().split("\n")[0];
        const capability = firstStatement.match(GUARD)?.[1];
        expect(capability, `${name} -> ${firstStatement}`).toBeDefined();
        expect(CAPABILITIES, name).toContain(capability);
        checked++;
      });
    }
    expect(checked).toBeGreaterThanOrEqual(17);
  });

  it("no Server Action exports anything but async functions and types", () => {
    for (const file of files(path.join(SRC, "modules"), (name) => name === "actions.ts")) {
      const exports = [...read(file).matchAll(/^export (?!async function |type |interface )(.*)$/gm)].map((m) => m[1]);
      expect(exports, rel(file)).toEqual([]);
    }
  });
});
