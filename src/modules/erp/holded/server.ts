import "server-only";
import { serverEnv } from "@/lib/env";
import { createHoldedClient, type HoldedClient } from "./client";

/** Whether HOLDED_API_KEY is set. The key itself never leaves the server. */
export const isHoldedConfigured = () => Boolean(serverEnv().HOLDED_API_KEY?.trim());

/** Holded client for the app, authenticated with the server env key. */
export function appHoldedClient(baseUrl: string): HoldedClient {
  return createHoldedClient({ apiKey: serverEnv().HOLDED_API_KEY ?? "", baseUrl });
}
