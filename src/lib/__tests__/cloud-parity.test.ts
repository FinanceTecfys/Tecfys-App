/**
 * A cloud project gets ONLY the migrations (`supabase db push`): never seed.sql,
 * never the [storage.buckets.*] sections of config.toml. Anything the app needs
 * must therefore live in a migration. Read from disk so a new bucket declared
 * only in config.toml, or data added back to seed.sql, fails here.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SUPABASE = path.join(process.cwd(), "supabase");
const config = readFileSync(path.join(SUPABASE, "config.toml"), "utf8");
const migrations = readdirSync(path.join(SUPABASE, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(path.join(SUPABASE, "migrations", f), "utf8").replace(/--[^\n]*/g, ""))
  .join("\n");
const configBuckets = [...config.matchAll(/^\[storage\.buckets\.([\w-]+)\]/gm)].map((m) => m[1]);

describe("cloud parity", () => {
  it("finds the app's buckets in config.toml", () => {
    expect(configBuckets.sort()).toEqual(["contract-attachments", "informa-reports"]);
  });

  for (const bucket of configBuckets) {
    it(`creates the bucket "${bucket}" in a migration, private`, () => {
      const insert = migrations.match(new RegExp(`insert into storage\\.buckets[^;]*values \\(\\s*'${bucket}',\\s*'${bucket}',\\s*(\\w+)[^;]*;`));
      expect(insert, `no migration inserts storage bucket ${bucket}`).not.toBeNull();
      expect(insert![1]).toBe("false");
      expect(insert![0]).toMatch(/do update\s+set public = false/);
    });
  }

  it("keeps every bucket private in config.toml too", () => {
    for (const bucket of configBuckets) {
      const section = config.slice(config.indexOf(`[storage.buckets.${bucket}]`)).split(/\n\[/)[0];
      expect(section).toMatch(/^public = false$/m);
    }
  });

  it("puts the reference data the loan book needs in a migration, not in seed.sql", () => {
    expect(migrations).toMatch(/insert into contract_types \(code, label, billing_lag_months\) values/);
    expect(migrations).toMatch(/insert into asset_types \(name, cluster\) values/);
    const seed = readFileSync(path.join(SUPABASE, "seed.sql"), "utf8").replace(/--[^\n]*/g, "").trim();
    expect(seed).toBe("");
  });
});
