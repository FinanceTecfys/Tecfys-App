import { describe, expect, it, vi } from "vitest";
import { createInformaClient, InformaApiError, isInformaHost, redact } from "../api-client";
import sample from "./fixtures/informe-mayor-A00000000.json";

// The Informa API is mocked: these tests never reach services.informa.es.
type Reply = { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> } | Error;
type Call = { method: string; url: URL; headers: Record<string, string> };

const PASSWORD = "p@ss/w+rd=1";

function mockFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: new URL(String(input)), headers: (init?.headers ?? {}) as Record<string, string> });
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected extra request");
    if (reply instanceof Error) throw reply;
    const body = reply.raw ?? (reply.body === undefined ? null : JSON.stringify(reply.body));
    return new Response(body, { status: reply.status ?? 200, headers: { "content-type": "application/json", ...reply.headers } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

/** A client that already holds a session ("sess-secret"), unless initialSession is overridden. */
const client = (replies: Reply[], extra: Partial<Parameters<typeof createInformaClient>[0]> = {}) => {
  const m = mockFetch(replies);
  const sleep = vi.fn(async () => undefined);
  const api = createInformaClient({ username: " user-x ", password: ` ${PASSWORD} `, initialSession: " sess-secret ", fetch: m.fetch, sleep, ...extra });
  return { ...m, sleep, api };
};

/** Informa's error body: only the response code (manual, section 3). */
const errorBody = (valor: number, literal?: string) => ({ campoCodificadoRespuesta: { valor, tablaDecodificacion: "tablaCodigoRespuesta", literal } });
/** POST /login success, as in the manual. */
const loginBody = (idSesion: string) => ({
  campoCodificadoRespuesta: { valor: 0, tablaDecodificacion: "tablaCodigoRespuesta" },
  datosPeticion: { productoSolicitado: "login", parametrosCliente: { username: "user-x" } },
  datosProducto: { username: "user-x", idSesion, nombreCliente: "CLIENTE 1" },
});

const fail = (p: Promise<unknown>) => p.then(() => { throw new Error("expected a rejection"); }, (e: unknown) => e as InformaApiError);
const lower = (h: Record<string, string>) => Object.keys(h).map((k) => k.toLowerCase());
const isLogin = (c: Call) => c.method === "POST" && c.url.pathname.endsWith("/login");
const isProduct = (c: Call) => c.method === "GET" && c.url.pathname.endsWith("/get-product");

describe("createInformaClient - configuration", () => {
  it("refuses to build without username or password", () => {
    expect(() => createInformaClient({ username: "u", password: " " })).toThrow("INFORMA_PASSWORD");
    expect(() => createInformaClient({ username: "", password: "p" })).toThrow("INFORMA_USERNAME");
  });

  it("refuses a base URL outside informa.es, where the credentials would leak", () => {
    for (const baseUrl of ["https://evil.example/api/v2", "https://informa.es.evil.example", "http://services.informa.es/api/v2"]) {
      expect(() => createInformaClient({ username: "u", password: "p", baseUrl })).toThrow("informa.es");
    }
  });
});

describe("login()", () => {
  it("POSTs /login with username + password headers and uses the returned idSesion", async () => {
    const { api, calls } = client([{ body: loginBody("sess-new") }, { body: sample }], { initialSession: null });
    await api.login();
    await api.getReport("B12345678");

    const [login, product] = calls;
    expect(login.method).toBe("POST");
    expect(login.url.toString()).toBe("https://services.informa.es/api/v2/login");
    expect(login.headers).toMatchObject({ username: "user-x", password: PASSWORD });
    expect(product.url.searchParams.get("session")).toBe("sess-new");
  });

  it("returns nothing: the session is never handed to the caller", async () => {
    const { api } = client([{ body: loginBody("sess-new") }]);
    expect(await api.login()).toBeUndefined();
  });

  it("requires campoCodificadoRespuesta.valor === 0 and an idSesion", async () => {
    const noCode = client([{ body: { datosProducto: { idSesion: "x" } } }]);
    expect((await fail(noCode.api.login())).message).toContain("no confirmó el inicio de sesión");

    const codeOnOk = client([{ body: errorBody(10003, "Password expirada") }]);
    expect(await fail(codeOnOk.api.login())).toMatchObject({ code: 10003, message: expect.stringContaining("contraseña del usuario de Informa ha caducado") });

    const noSession = client([{ body: { campoCodificadoRespuesta: { valor: 0 }, datosProducto: { username: "user-x" } } }]);
    expect((await fail(noSession.api.login())).message).toBe("Informa no devolvió idSesion al iniciar sesión");
  });

  it("explains a bad password (401 + 10001) as a credentials error, without the password", async () => {
    const { api } = client([{ status: 401, body: errorBody(10001, `Usuario No Válido (${PASSWORD})`) }]);
    const err = await fail(api.login());
    expect(err).toBeInstanceOf(InformaApiError);
    expect(err).toMatchObject({ status: 401, code: 10001 });
    expect(err.message).toContain("rechaza el usuario o la contraseña al iniciar sesión");
    expect(err.message).not.toContain(PASSWORD);
    expect(err.message).not.toContain(encodeURIComponent(PASSWORD));
  });

  it("shares one login between concurrent requests that have no session", async () => {
    const { api, calls } = client([{ body: loginBody("sess-new") }, { body: sample }, { body: sample }], { initialSession: null });
    await Promise.all([api.getReport("A00000000"), api.getReport("A00000000")]);
    expect(calls.filter(isLogin)).toHaveLength(1);
    expect(calls.filter(isProduct).map((c) => c.url.searchParams.get("session"))).toEqual(["sess-new", "sess-new"]);
  });
});

describe("getReport() - session handling", () => {
  it("requests INFORME_MAYOR with the credentials in the query string, never the password", async () => {
    const { api, calls } = client([{ body: sample }]);
    expect(await api.getReport("B12345678")).toEqual(sample);
    expect(calls).toHaveLength(1);
    const { url, headers } = calls[0];
    expect(url.origin + url.pathname).toBe("https://services.informa.es/api/v2/get-product");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      product: "INFORME_MAYOR",
      cif: "B12345678",
      formato: "json",
      idioma: "es",
      username: "user-x",
      session: "sess-secret",
    });
    expect(lower(headers)).not.toContain("session");
    expect(lower(headers)).not.toContain("password");
    expect(url.toString()).not.toContain(encodeURIComponent(PASSWORD));
  });

  it("logs in first when there is no cached session", async () => {
    const { api, calls } = client([{ body: loginBody("sess-new") }, { body: sample }], { initialSession: null });
    await api.getReport("B12345678");
    expect(calls.map((c) => c.method + " " + c.url.pathname)).toEqual(["POST /api/v2/login", "GET /api/v2/get-product"]);
  });

  it("on 10005 logs in once, retries once and keeps the new session for later requests", async () => {
    const { api, calls } = client([
      { body: errorBody(10005, "Sesión caducada") },
      { body: loginBody("sess-new") },
      { body: sample },
      { body: sample },
    ]);
    expect(await api.getReport("B12345678")).toEqual(sample);
    await api.getReport("B87654321");

    expect(calls.map((c) => (isLogin(c) ? "login" : c.url.searchParams.get("session")))).toEqual(["sess-secret", "login", "sess-new", "sess-new"]);
  });

  it("surfaces a persistent 10005 after the re-login instead of looping", async () => {
    const { api, calls } = client([{ body: errorBody(10005) }, { body: loginBody("sess-new") }, { body: errorBody(10005) }]);
    const err = await fail(api.getReport("B12345678"));
    expect(err).toMatchObject({ status: 200, code: 10005 });
    expect(err.message).toContain("La sesión de Informa ha caducado");
    expect(err.message).not.toContain("rechaza");
    expect(calls).toHaveLength(3);
    expect(calls.filter(isLogin)).toHaveLength(1);
  });

  it("does not log in again when a session it just obtained is already expired", async () => {
    const { api, calls } = client([{ body: loginBody("sess-new") }, { body: errorBody(10005) }], { initialSession: null });
    expect(await fail(api.getReport("B12345678"))).toMatchObject({ code: 10005 });
    expect(calls).toHaveLength(2);
  });

  it("does not re-login for errors other than 10005", async () => {
    const { api, calls } = client([{ status: 401, body: errorBody(10002) }]);
    expect((await fail(api.getReport("B12345678"))).message).toContain("no tiene permiso para el producto INFORME_MAYOR");
    expect(calls).toHaveLength(1);
  });

  it("propagates a failed re-login as a credentials error", async () => {
    const { api } = client([{ body: errorBody(10005) }, { status: 401, body: errorBody(10001) }]);
    expect(await fail(api.getReport("B12345678"))).toMatchObject({ status: 401, code: 10001, message: expect.stringContaining("contraseña") });
  });

  it("ping() always logs in, then reads the demo company", async () => {
    const { api, calls } = client([{ body: loginBody("sess-new") }, { body: sample }]);
    await api.ping();
    expect(isLogin(calls[0])).toBe(true);
    expect(calls[1].url.searchParams.get("cif")).toBe("A00000000");
    expect(calls[1].url.searchParams.get("session")).toBe("sess-new");
  });
});

describe("secrets never leak", () => {
  it("never puts the password in any URL, only in the login headers", async () => {
    const { api, calls } = client([{ body: errorBody(10005) }, { body: loginBody("sess-new") }, { body: sample }]);
    await api.getReport("B12345678");
    for (const c of calls) {
      expect(c.url.toString()).not.toContain(PASSWORD);
      expect(c.url.toString()).not.toContain(encodeURIComponent(PASSWORD));
      if (!isLogin(c)) expect(lower(c.headers)).not.toContain("password");
    }
  });

  it("redacts the old and the renewed session from errors echoing the URL", async () => {
    const url = (s: string) => `https://services.informa.es/api/v2/get-product?cif=B1&username=user-x&session=${s}`;
    const { api } = client(
      [{ body: errorBody(10005) }, { body: loginBody("sess-new") }, new Error(`request to ${url("sess-new")} failed, previous ${url("sess-secret")}`)],
      { maxRetries: 0 },
    );
    const err = await fail(api.getReport("B1"));
    expect(err.message).toContain("session=***");
    expect(err.message).not.toContain("sess-new");
    expect(err.message).not.toContain("sess-secret");
  });

  it("redacts a session echoed in Informa's own literal", async () => {
    const { api } = client([{ status: 401, body: errorBody(10001, "Sesión sess-secret no válida") }]);
    const err = await fail(api.getReport("B1"));
    expect(err).toMatchObject({ status: 401, code: 10001 });
    expect(err.message).not.toContain("sess-secret");
  });
});

describe("getReport() - errors", () => {
  it("tells an unknown CIF (11003) from a product not available (11001), both 404", async () => {
    const { api } = client([{ status: 404, body: errorBody(11003) }, { status: 404, body: errorBody(11001) }]);
    expect(await fail(api.getReport("B00000001"))).toMatchObject({ status: 404, code: 11003, message: expect.stringContaining("El CIF no existe") });
    expect(await fail(api.getReport("B00000001"))).toMatchObject({ status: 404, code: 11001, message: expect.stringContaining("no tiene disponible el informe") });
  });

  it("falls back to the HTTP status when the error body is not JSON", async () => {
    const { api } = client([{ status: 404, raw: "<html>Not found</html>" }, { status: 400, raw: "" }, { status: 500, body: {} }]);
    expect((await fail(api.getReport("B1"))).message).toBe("Informa no encuentra la empresa o el informe no está disponible para ella (HTTP 404)");
    expect((await fail(api.getReport("B1"))).message).toBe("Informa rechaza los parámetros de la petición (HTTP 400)");
    expect(await fail(api.getReport("B1"))).toMatchObject({ status: 500, message: "Error interno del servidor de Informa (HTTP 500)" });
  });

  it("detects a logical error (campoCodificadoRespuesta != 0) inside a 200", async () => {
    const { api } = client([{ status: 200, body: { ...errorBody(11002, "Requisitos Mínimos No Cumplidos"), datosPeticion: {} } }]);
    const err = await fail(api.getReport("B12345678"));
    expect(err).toMatchObject({ status: 200, code: 11002 });
    expect(err.message).toContain("no cumple los requisitos mínimos");
  });

  it("accepts a string response code of 0", async () => {
    const { api } = client([{ body: { ...sample, campoCodificadoRespuesta: { valor: "0" } } }]);
    await expect(api.getReport("A00000000")).resolves.toBeTruthy();
  });

  it("waits out a rate limit (429 + Retry-After) and retries", async () => {
    const { api, sleep, calls } = client([{ status: 429, headers: { "retry-after": "3" } }, { body: sample }]);
    await expect(api.getReport("A00000000")).resolves.toEqual(sample);
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("gives up on a persistent rate limit with the wait in the error", async () => {
    const { api, calls } = client([{ status: 429, headers: { "retry-after": "5" } }, { status: 429, headers: { "retry-after": "5" } }], { maxRetries: 1 });
    const err = await fail(api.getReport("A00000000"));
    expect(err).toMatchObject({ status: 429, retryAfterSeconds: 5 });
    expect(err.message).toContain("Reintenta en 5 s");
    expect(calls).toHaveLength(2);
  });

  it("does not sleep through a Retry-After longer than the limit", async () => {
    const { api, sleep } = client([{ status: 429, headers: { "retry-after": "3600" } }]);
    expect(await fail(api.getReport("A00000000"))).toMatchObject({ status: 429, retryAfterSeconds: 3600 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a 503 and then reports the data source as unavailable (11000)", async () => {
    const { api, calls } = client([
      { status: 503, body: errorBody(11000) },
      { status: 503, body: errorBody(11000) },
      { status: 503, body: errorBody(11000) },
    ]);
    expect(await fail(api.getReport("A00000000"))).toMatchObject({ status: 503, code: 11000, message: expect.stringContaining("fuente de datos") });
    expect(calls).toHaveLength(3);
  });

  it("retries a network error, then gives a clear message", async () => {
    const ok = client([new Error("ECONNRESET"), { body: sample }]);
    await expect(ok.api.getReport("A00000000")).resolves.toEqual(sample);
    const ko = client([new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET")]);
    expect((await fail(ko.api.getReport("A00000000"))).message).toBe("No se pudo conectar con Informa (ECONNRESET)");
  });

  it("rejects malformed JSON on a 200", async () => {
    const { api } = client([{ raw: "{ not json" }]);
    expect(await fail(api.getReport("A00000000"))).toMatchObject({ status: 200, message: "Informa devolvió una respuesta que no es JSON" });
  });

  it("rejects a 200 without datosProducto", async () => {
    const { api } = client([{ body: { campoCodificadoRespuesta: { valor: 0 } } }]);
    expect((await fail(api.getReport("A00000000"))).message).toContain("datosProducto");
  });
});

describe("redact", () => {
  it("scrubs the raw and URL-encoded forms of every secret", () => {
    expect(redact("a s/k+y=1 b", "s/k+y=1")).toBe("a *** b");
    expect(redact("?session=s%2Fk%2By%3D1&x", "s/k+y=1")).toBe("?session=***&x");
    expect(redact("pw=p@ss/w+rd=1 s=abc", PASSWORD, "abc")).toBe("pw=*** s=***");
    expect(redact("nothing here", "", null, undefined)).toBe("nothing here");
  });
});

describe("isInformaHost", () => {
  it("accepts only https informa.es hosts without userinfo", () => {
    expect(isInformaHost("https://services.informa.es/api/v2")).toBe(true);
    expect(isInformaHost("https://informa.es")).toBe(true);
    expect(isInformaHost("http://services.informa.es")).toBe(false);
    expect(isInformaHost("https://services.informa.es.evil.com")).toBe(false);
    expect(isInformaHost("https://notinforma.es")).toBe(false);
    expect(isInformaHost("https://u:p@services.informa.es")).toBe(false);
    expect(isInformaHost("not a url")).toBe(false);
  });
});
