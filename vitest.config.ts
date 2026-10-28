import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Several tests scan the whole of src/ or supabase/; under a full parallel run on a loaded
    // machine they exceeded the 5 s default without anything being wrong.
    testTimeout: 20_000,
  },
});
