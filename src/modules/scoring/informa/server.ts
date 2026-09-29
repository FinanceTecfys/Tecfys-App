import "server-only";
import { serverEnv } from "@/lib/env";
import { createInformaClient, INFORMA_DEFAULT_BASE_URL, isInformaHost, type InformaClient } from "./api-client";

/** Base URL the app will call: INFORMA_API_URL, or Informa's production URL. */
export const informaBaseUrl = () => (serverEnv().INFORMA_API_URL?.trim() || INFORMA_DEFAULT_BASE_URL).replace(/\/+$/, "");

/**
 * What Settings may show about the Informa connection. Only booleans and the
 * (non-secret) base URL: the username, password and session never leave the server.
 */
export function informaConfigStatus() {
  const env = serverEnv();
  const baseUrl = informaBaseUrl();
  return {
    baseUrl,
    baseUrlAllowed: isInformaHost(baseUrl),
    hasUsername: Boolean(env.INFORMA_USERNAME?.trim()),
    hasPassword: Boolean(env.INFORMA_PASSWORD?.trim()),
  };
}

export const isInformaConfigured = () => {
  const s = informaConfigStatus();
  return s.baseUrlAllowed && s.hasUsername && s.hasPassword;
};

/**
 * One client per configuration, kept in module memory for the life of the
 * server process: it holds the Informa session obtained by POST /login, so
 * requests reuse it and only log in again when it is missing or expired.
 * INFORMA_SESSION, if set, is just the first session to try.
 */
let cached: { key: string; client: InformaClient } | null = null;

/** Informa client for the app, authenticated with the server env credentials. */
export function appInformaClient(): InformaClient {
  const env = serverEnv();
  const baseUrl = informaBaseUrl();
  const username = env.INFORMA_USERNAME ?? "";
  const password = env.INFORMA_PASSWORD ?? "";
  const key = JSON.stringify([baseUrl, username, password]);
  if (cached?.key !== key) {
    cached = { key, client: createInformaClient({ username, password, initialSession: env.INFORMA_SESSION, baseUrl }) };
  }
  return cached.client;
}
