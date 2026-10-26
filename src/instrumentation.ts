/**
 * Runs once when a server instance starts. Fail fast: a deployment with a
 * missing or invalid environment variable refuses to start, with an error that
 * names the variable, instead of failing later on the first request that needs it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverEnv } = await import("@/lib/env");
    serverEnv();
  }
}
