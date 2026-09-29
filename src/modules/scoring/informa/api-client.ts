/**
 * Typed client for the Informa D&B REST API v2 ("API configurable").
 *
 *   Base URL  https://services.informa.es/api/v2   (INFORMA_API_URL)
 *   Login     POST /login with headers `username` + `password` ->
 *             datosProducto.idSesion (campoCodificadoRespuesta.valor 0 = OK).
 *             The password only ever travels in these headers, never in a URL.
 *   Auth      get-product takes query params `username` + `session` - the mode
 *             Informa accepts in practice (a live test rejected headers).
 *   Report    GET /get-product?product=INFORME_MAYOR&cif=<cif>&formato=json&idioma=es&username=<user>&session=<session>
 *             (idioma is what makes Informa send the decoded `literal` of every
 *             campoCodificado*; without it only the codes come back).
 *   Session   short-lived. The client logs in when it has no session and, when
 *             get-product answers 10005 (session expired), logs in once more
 *             and retries the request exactly once; a second failure is
 *             surfaced, never looped. Concurrent callers share one login.
 *   Errors    every body carries campoCodificadoRespuesta { valor, literal }:
 *             0 = OK. A non-zero code can come with its HTTP status (401 / 404
 *             / 400 / 500 / 503) or, defensively, with a 200.
 *             The code is more precise than the status (a 404 can be an
 *             unknown CIF, a product not available, minimum requirements not
 *             met or a temporarily blocked company), so it wins when present.
 *             10005 (not in the manual's table) = session expired.
 *   Limits    the docs define no rate limit; a 429 (or 503, network error) is
 *             retried with backoff, honouring Retry-After.
 *
 * Deliberately free of `server-only` and of env access so the tests can build
 * it; the app builds one per configuration through informa/server.ts, which
 * keeps it (and so its session) in module memory. The password and every
 * session are never logged or returned: URLs are never put in messages and
 * every error leaving the client is passed through redact(). The response
 * echoes `parametrosCliente` (username and session), so the raw report must
 * not be forwarded to the browser or stored as-is.
 */

export const INFORMA_DEFAULT_BASE_URL = "https://services.informa.es/api/v2";
/** Informa's public demo company: free to query, used by "Probar conexión". */
export const INFORMA_DEMO_CIF = "A00000000";

/**
 * Only Informa hosts may be configured: the credentials are sent to this URL,
 * so any other host would leak them.
 */
export const isInformaHost = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "informa.es" || u.hostname.endsWith(".informa.es")) && !u.username && !u.password;
  } catch {
    return false;
  }
};

/** Informa response codes (campoCodificadoRespuesta.valor), from the user manual's error table. */
const RESPONSE_CODE_MESSAGES: Record<number, string> = {
  10000: "Informa no puede validar el usuario ahora mismo (Sistema de Gestión Comercial caído). Inténtalo más tarde",
  10001: "Informa rechaza las credenciales: usuario o sesión no válidos. Revisa INFORMA_USERNAME e INFORMA_PASSWORD",
  10002: "El usuario de Informa no tiene permiso para el producto INFORME_MAYOR",
  10003: "La contraseña del usuario de Informa ha caducado: hay que cambiarla en Informa",
  10005: "La sesión de Informa ha caducado y la renovación automática (POST /login) no lo ha resuelto: revisa INFORMA_USERNAME / INFORMA_PASSWORD o contacta con soporte de Informa",
  10006: "Error de comunicación interna en Informa",
  11000: "La fuente de datos de Informa no está disponible. Inténtalo más tarde",
  11001: "Informa no tiene disponible el informe para este CIF",
  11002: "El informe de esta empresa no cumple los requisitos mínimos definidos en Informa",
  11003: "El CIF no existe en la base de datos de Informa",
  11005: "Empresa bloqueada temporalmente en Informa por actualización de datos. Inténtalo más tarde",
  12000: "Informa rechaza los parámetros de la petición",
  12001: "Error interno del servidor de Informa",
};

/** On /login, 10001 can only mean the username / password pair. */
const LOGIN_CODE_MESSAGES: Record<number, string> = {
  10001: "Informa rechaza el usuario o la contraseña al iniciar sesión. Revisa INFORMA_USERNAME e INFORMA_PASSWORD",
};

const STATUS_MESSAGES: Record<number, string> = {
  400: "Informa rechaza los parámetros de la petición",
  401: "Informa rechaza las credenciales o el usuario no tiene permiso para el producto",
  403: "Informa deniega el acceso",
  404: "Informa no encuentra la empresa o el informe no está disponible para ella",
  500: "Error interno del servidor de Informa",
  503: "El servicio de Informa no está disponible. Inténtalo más tarde",
};

const SESSION_EXPIRED = 10005;

export class InformaApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "InformaApiError";
  }
}

export interface InformaClientOptions {
  username: string;
  /** Portal password: sent only in the POST /login headers. */
  password: string;
  /** A session to try first (e.g. INFORMA_SESSION); replaced by a login when missing or expired. */
  initialSession?: string | null;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries on 429 / 503 / network errors before giving up. */
  maxRetries?: number;
  /** Longest Retry-After we are willing to wait inside one request. */
  maxRetryWaitSeconds?: number;
}

export interface InformaClient {
  /** POST /login and keep the new session in memory. Never returns it. */
  login(): Promise<void>;
  /** The largest report Informa has for the company (financiero > comercial > abreviado), as JSON. */
  getReport(cif: string): Promise<unknown>;
  /** "Probar conexión": a fresh login, then the demo company's report. */
  ping(): Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** campoCodificadoRespuesta.valor of a parsed body, or null when absent. */
export function responseCode(body: unknown): { code: number; literal: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const field = (body as { campoCodificadoRespuesta?: { valor?: unknown; literal?: unknown } }).campoCodificadoRespuesta;
  if (!field || typeof field !== "object") return null;
  const code = typeof field.valor === "number" ? field.valor : typeof field.valor === "string" ? Number(field.valor) : NaN;
  if (!Number.isFinite(code)) return null;
  return { code, literal: typeof field.literal === "string" && field.literal.trim() ? field.literal.trim() : null };
}

function codeError(code: number, literal: string | null, status: number | null, overrides: Record<number, string> = {}): InformaApiError {
  const base = overrides[code] ?? RESPONSE_CODE_MESSAGES[code] ?? (status !== null ? STATUS_MESSAGES[status] : undefined) ?? "Informa devolvió un error";
  return new InformaApiError(`${base} (código ${code}${literal && !base.includes(literal) ? `: ${literal}` : ""})`, status, code);
}

function retryAfterSeconds(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return secs;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
}

async function readJson(res: Response): Promise<unknown | undefined> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/** Replaces every occurrence of each secret (raw or URL-encoded) in a message. */
export function redact(text: string, ...secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    for (const form of new Set([secret, encodeURIComponent(secret), new URLSearchParams({ s: secret }).toString().slice(2)])) {
      out = out.split(form).join("***");
    }
  }
  return out;
}

interface Call {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  /** Code-specific messages for this endpoint (e.g. 10001 on /login). */
  codeMessages?: Record<number, string>;
}

export function createInformaClient(options: InformaClientOptions): InformaClient {
  const username = options.username.trim();
  const password = options.password.trim();
  if (!username || !password) throw new InformaApiError("Faltan INFORMA_USERNAME o INFORMA_PASSWORD en el entorno del servidor", null);
  const baseUrl = (options.baseUrl ?? INFORMA_DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!isInformaHost(baseUrl)) throw new InformaApiError("INFORMA_API_URL debe ser https y de un dominio informa.es", null);
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 2;
  const maxWait = options.maxRetryWaitSeconds ?? 30;

  let session: string | null = options.initialSession?.trim() || null;
  let pendingLogin: Promise<string> | null = null;
  /** Every session this client has held: all of them are scrubbed from errors. */
  const seenSessions = new Set<string>(session ? [session] : []);

  /** Any error leaving the client, with the password and sessions scrubbed from its message. */
  async function call(c: Call): Promise<Record<string, unknown>> {
    try {
      return await send(c);
    } catch (e) {
      const scrub = (text: string) => redact(text, password, ...seenSessions);
      if (e instanceof InformaApiError) throw new InformaApiError(scrub(e.message), e.status, e.code, e.retryAfterSeconds);
      throw new InformaApiError(scrub(`Error inesperado con Informa (${e instanceof Error ? e.message : String(e)})`), null);
    }
  }

  async function send({ method, path, query = {}, headers = {}, codeMessages }: Call): Promise<Record<string, unknown>> {
    // The URL may carry the session: it must never be logged or put in an error.
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, { method, headers: { Accept: "application/json", ...headers }, cache: "no-store" });
      } catch (e) {
        if (attempt < maxRetries) { await sleep(1000 * 2 ** attempt); continue; }
        throw new InformaApiError(`No se pudo conectar con Informa (${e instanceof Error ? e.message : String(e)})`, null);
      }

      if (res.ok) {
        const body = await readJson(res);
        if (body === undefined || body === null || typeof body !== "object") {
          throw new InformaApiError("Informa devolvió una respuesta que no es JSON", res.status);
        }
        const rc = responseCode(body);
        if (rc && rc.code !== 0) throw codeError(rc.code, rc.literal, res.status, codeMessages);
        return body as Record<string, unknown>;
      }

      if (res.status === 429 || res.status === 503) {
        const wait = retryAfterSeconds(res) ?? 2 ** attempt * 2;
        if (attempt < maxRetries && wait <= maxWait) { await sleep(wait * 1000); continue; }
        if (res.status === 429) {
          throw new InformaApiError(`Informa ha limitado las peticiones (429). Reintenta en ${wait} s`, 429, null, wait);
        }
      }

      const rc = responseCode(await readJson(res));
      if (rc && rc.code !== 0) throw codeError(rc.code, rc.literal, res.status, codeMessages);
      throw new InformaApiError(`${STATUS_MESSAGES[res.status] ?? "Error de la API de Informa"} (HTTP ${res.status})`, res.status);
    }
  }

  async function doLogin(): Promise<string> {
    const body = await call({ method: "POST", path: "/login", headers: { username, password }, codeMessages: LOGIN_CODE_MESSAGES });
    if (responseCode(body)?.code !== 0) throw new InformaApiError("Informa no confirmó el inicio de sesión (sin código de respuesta 0)", 200);
    const id = (body.datosProducto as { idSesion?: unknown } | undefined)?.idSesion;
    if (typeof id !== "string" || !id.trim()) throw new InformaApiError("Informa no devolvió idSesion al iniciar sesión", 200);
    const fresh = id.trim();
    seenSessions.add(fresh);
    session = fresh;
    return fresh;
  }

  /** One login at a time: concurrent callers wait for the same one. */
  function login(): Promise<string> {
    pendingLogin ??= doLogin().finally(() => {
      pendingLogin = null;
    });
    return pendingLogin;
  }

  /** get-product with the session; on 10005, one re-login and exactly one retry. */
  async function getProduct(query: Record<string, string>): Promise<Record<string, unknown>> {
    const request = (s: string) => call({ method: "GET", path: "/get-product", query: { ...query, username, session: s } });
    const current = session;
    if (!current) return request(await login());
    try {
      return await request(current);
    } catch (e) {
      if (!(e instanceof InformaApiError) || e.code !== SESSION_EXPIRED) throw e;
      // Another caller may already have renewed it; otherwise log in now.
      const renewed = session !== current && session ? session : await login();
      return request(renewed);
    }
  }

  async function getReport(cif: string): Promise<unknown> {
    const body = await getProduct({ product: "INFORME_MAYOR", cif, formato: "json", idioma: "es" });
    if (!body.datosProducto) throw new InformaApiError("La respuesta de Informa no contiene datosProducto", 200);
    return body;
  }

  return {
    async login() {
      await login();
    },
    getReport,
    async ping() {
      await login();
      await getReport(INFORMA_DEMO_CIF);
    },
  };
}
