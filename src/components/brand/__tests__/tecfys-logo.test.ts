import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TECFYS_DISC, TECFYS_GLYPH, TECFYS_GLYPH_PATH } from "../tecfys-logo";

const svg = readFileSync(path.join(__dirname, "..", "tecfys-logo.svg"), "utf8");

describe("Tecfys logo SVG", () => {
  it("is a real vector: only a circle and a path, no embedded raster", () => {
    expect(svg).not.toMatch(/<image|data:|base64|xlink:href|href=/i);
    const elements = [...svg.matchAll(/<(\w+)[\s>/]/g)].map((m) => m[1]);
    expect(elements).toEqual(["svg", "title", "circle", "path"]);
    expect(svg).toContain('viewBox="0 0 100 100"');
  });

  it("the standalone file and the React component draw the same mark", () => {
    const d = svg.match(/<path[^>]* d="([^"]+)"/)?.[1];
    expect(d).toBe(TECFYS_GLYPH_PATH);
    expect(svg).toContain(`fill="${TECFYS_DISC}"`);
    expect(svg).toContain(`fill="${TECFYS_GLYPH}"`);
  });

  it("the glyph path is well-formed and stays inside the disc's box", () => {
    expect(TECFYS_GLYPH_PATH).toMatch(/^M[\d.\s MLCZ]+Z$/);
    // Two closed sub-paths: the glyph outline and the hole in its dot.
    expect(TECFYS_GLYPH_PATH.match(/M/g)).toHaveLength(2);
    const numbers = TECFYS_GLYPH_PATH.match(/\d+(?:\.\d+)?/g)!.map(Number);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(100);
  });
});
