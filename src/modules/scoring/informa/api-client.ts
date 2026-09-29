/**
 * Typed client for the Informa D&B REST API v2 ("API configurable").
 *
 *   Base URL  https://services.informa.es/api/v2   (INFORMA_API_URL)
 *   Auth      headers `username` + `session` (session id from POST /login).
 *             Sent as headers, not as the documented query params, so the
 *             session never lands in a URL or an access log.
 *   Report    GET /get-product?product=INFORME_MAYOR&cif=<cif>&formato=json&idioma=es
 *             (idioma is what makes Informa send the decoded `literal` of every
 *             campoCodificado*; without it only the codes come back).
 *   Errors    every body carries campoCodificadoRespuesta { valor, literal }:
 *             0 = OK. A non-zero code can come with its HTTP status (401 / 404
 *             / 400 / 500 / 503) or, defensively, with a 200.
 *             The code is more precise than the status (a 404 can be an
 *             unknown CIF, a product not available, minimum requirements not
 *             met or a temporarily blocked company), so it wins when present.
 *   Limits    the docs define no rate limit; a 429 (or 503, network error) is
 *             retried with backoff, honouring Retry-After.
 *
 * Deliberately free of `server-only` and of env access so the tests can build
 * it; the app builds it through informa/server.ts. The session is passed in
 * and never logged or returned: the response echoes `parametrosCliente`
 * (username, and session when sent as a query param), so the raw report must
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
  10001: "Informa rechaza el usuario o la sesión (INFORMA_USERNAME / INFORMA_SESSION). Si la sesión ha caducado, obtén una nueva con /login",
  10002: "El usuario de Informa no tiene permiso para el producto INFORME_MAYOR",
  10003: "La contraseña del usuario de Informa ha caducado: hay que cambiarla en Informa",
  10006: "Error de comunicación interna en Informa",
  11000: "La fuente de datos de Informa no está disponible. Inténtalo más tarde",
  11001: "Informa no tiene disponible el informe para este CIF",
  11002: "El informe de esta empresa no cumple los requisitos mínimos definidos en Informa",
  11003: "El CIF no existe en la base de datos de Informa",
  11005: "Empresa bloqueada temporalmente en Informa por actualización de datos. Inténtalo más tarde",
  12000: "Informa rechaza los parámetros de la petición",
  12001: "Error interno del servidor de Informa",
};

const STATUS_MESSAGES: Record<number, string> = {
  400: "Informa rechaza los parámetros de la petición",
  401: "Informa rechaza las credenciales o el usuario no tiene permiso para el producto",
  403: "Informa deniega el acceso",
  404: "Informa no encuentra la empresa o el informe no está disponible para ella",
  500: "Error interno del servidor de Informa",
  503: "El servicio de Informa no está disponible. Inténtalo más tarde",
};

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
  session: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries on 429 / 503 / network errors before giving up. */
  maxRetries?: number;
  /** Longest Retry-After we are willing to wait inside one request. */
  maxRetryWaitSeconds?: number;
}

export interface InformaClient {
  /** The largest report Informa has for the company (financiero > comercial > abreviado), as JSON. */
  getReport(cif: string): Promise<unknown>;
  /** Cheapest meaningful authenticated call: the demo company's report. */
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

function codeError(code: number, literal: string | null, status: number | null): InformaApiError {
  const base = RESPONSE_CODE_MESSAGES[code] ?? (status !== null ? STATUS_MESSAGES[status] : undefined) ?? "Informa devolvió un error";
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

export function createInformaClient(options: InformaClientOptions): InformaClient {
  const username = options.username.trim();
  const session = options.session.trim();
  if (!username || !session) throw new InformaApiError("Faltan INFORMA_USERNAME o INFORMA_SESSION en el entorno del servidor", null);
  const baseUrl = (options.baseUrl ?? INFORMA_DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!isInformaHost(baseUrl)) throw new InformaApiError("INFORMA_API_URL debe ser https y de un dominio informa.es", null);
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 2;
  const maxWait = options.maxRetryWaitSeconds ?? 30;

  async function getJson(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, { headers: { username, session, Accept: "application/json" }, cache: "no-store" });
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
        if (rc && rc.code !== 0) throw codeError(rc.code, rc.literal, res.status);
        return body;
      }

      if (res.status === 429 || res.status === 503) {
        const wait = retryAfterSeconds(res) ?? 2 ** attempt * 2;
        if (attempt < maxRetries && wait <= maxWait) { await sleep(wait * 1000); continue; }
        if (res.status === 429) {
          throw new InformaApiError(`Informa ha limitado las peticiones (429). Reintenta en ${wait} s`, 429, null, wait);
        }
      }

      const rc = responseCode(await readJson(res));
      if (rc && rc.code !== 0) throw codeError(rc.code, rc.literal, res.status);
      throw new InformaApiError(`${STATUS_MESSAGES[res.status] ?? "Error de la API de Informa"} (HTTP ${res.status})`, res.status);
    }
  }

  async function getReport(cif: string): Promise<unknown> {
    const body = await getJson("/get-product", { product: "INFORME_MAYOR", cif, formato: "json", idioma: "es" });
    if (!("datosProducto" in (body as object)) || !(body as { datosProducto?: unknown }).datosProducto) {
      throw new InformaApiError("La respuesta de Informa no contiene datosProducto", 200);
    }
    return body;
  }

  return {
    getReport,
    async ping() {
      await getReport(INFORMA_DEMO_CIF);
    },
  };
}
