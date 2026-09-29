import "server-only";
import { serverEnv } from "@/lib/env";
import { createInformaClient, INFORMA_DEFAULT_BASE_URL, isInformaHost, type InformaClient } from "./api-client";

/** Base URL the app will call: INFORMA_API_URL, or Informa's production URL. */
export const informaBaseUrl = () => (serverEnv().INFORMA_API_URL?.trim() || INFORMA_DEFAULT_BASE_URL).replace(/\/+$/, "");

/**
 * What Settings may show about the Informa connection. Only booleans and the
 * (non-secret) base URL: the username and session never leave the server.
 */
export function informaConfigStatus() {
  const env = serverEnv();
  const baseUrl = informaBaseUrl();
  return {
    baseUrl,
    baseUrlAllowed: isInformaHost(baseUrl),
    hasUsername: Boolean(env.INFORMA_USERNAME?.trim()),
    hasSession: Boolean(env.INFORMA_SESSION?.trim()),
  };
}

export const isInformaConfigured = () => {
  const s = informaConfigStatus();
  return s.baseUrlAllowed && s.hasUsername && s.hasSession;
};

/** Informa client for the app, authenticated with the server env credentials. */
export function appInformaClient(): InformaClient {
  const env = serverEnv();
  return createInformaClient({ username: env.INFORMA_USERNAME ?? "", session: env.INFORMA_SESSION ?? "", baseUrl: informaBaseUrl() });
}
