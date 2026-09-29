import { describe, expect, it, vi } from "vitest";
import { createInformaClient, InformaApiError, isInformaHost, redact } from "../api-client";
import sample from "./fixtures/informe-mayor-A00000000.json";

// The Informa API is mocked: these tests never reach services.informa.es.
type Reply = { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> } | Error;

function mockFetch(replies: Reply[]) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: init?.headers as Record<string, string> });
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected extra request");
    if (reply instanceof Error) throw reply;
    const body = reply.raw ?? (reply.body === undefined ? null : JSON.stringify(reply.body));
    return new Response(body, { status: reply.status ?? 200, headers: { "content-type": "application/json", ...reply.headers } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const client = (replies: Reply[], extra: Partial<Parameters<typeof createInformaClient>[0]> = {}) => {
  const m = mockFetch(replies);
  const sleep = vi.fn(async () => undefined);
  return { ...m, sleep, api: createInformaClient({ username: " user-x ", session: " sess-secret ", fetch: m.fetch, sleep, ...extra }) };
};

/** Informa's error body: only the response code (manual, section 3). */
const errorBody = (valor: number, literal?: string) => ({ campoCodificadoRespuesta: { valor, tablaDecodificacion: "tablaCodigoRespuesta", literal } });

const fail = (p: Promise<unknown>) => p.then(() => { throw new Error("expected a rejection"); }, (e: unknown) => e as InformaApiError);

describe("createInformaClient", () => {
  it("refuses to build without username or session", () => {
    expect(() => createInformaClient({ username: "u", session: " " })).toThrow("INFORMA_SESSION");
    expect(() => createInformaClient({ username: "", session: "s" })).toThrow("INFORMA_USERNAME");
  });

  it("refuses a base URL outside informa.es, where the credentials would leak", () => {
    for (const baseUrl of ["https://evil.example/api/v2", "https://informa.es.evil.example", "http://services.informa.es/api/v2"]) {
      expect(() => createInformaClient({ username: "u", session: "s", baseUrl })).toThrow("informa.es");
    }
  });

  it("requests INFORME_MAYOR as JSON in Spanish, with the credentials in the query string, not in headers", async () => {
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
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("session");
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("username");
    expect(headers).not.toHaveProperty("Authorization");
  });

  it("ping() sends the credentials in the query string too", async () => {
    const { api, calls } = client([{ body: sample }]);
    await api.ping();
    expect(calls[0].url.searchParams.get("username")).toBe("user-x");
    expect(calls[0].url.searchParams.get("session")).toBe("sess-secret");
  });

  it("ping() fetches the demo company", async () => {
    const { api, calls } = client([{ body: sample }], { baseUrl: "https://services.informa.es/api/v2/" });
    await api.ping();
    expect(calls[0].url.searchParams.get("cif")).toBe("A00000000");
  });

  it("explains bad credentials (401 + code 10001) without echoing the session", async () => {
    const { api } = client([{ status: 401, body: errorBody(10001, "Usuario No Válido") }]);
    const err = await fail(api.getReport("B12345678"));
    expect(err).toBeInstanceOf(InformaApiError);
    expect(err).toMatchObject({ status: 401, code: 10001 });
    expect(err.message).toContain("rechaza las credenciales");
    expect(err.message).not.toContain("caducado");
    expect(err.message).toContain("código 10001: Usuario No Válido");
    expect(err.message).not.toContain("sess-secret");
  });

  it("explains a missing product permission (401 + code 10002)", async () => {
    const { api } = client([{ status: 401, body: errorBody(10002) }]);
    expect((await fail(api.getReport("B12345678"))).message).toContain("no tiene permiso para el producto INFORME_MAYOR");
  });

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

  it("reports an expired session (10005 on a 200) distinctly from bad credentials", async () => {
    const { api } = client([{ status: 200, body: errorBody(10005, "Sesión caducada") }]);
    const err = await fail(api.getReport("B12345678"));
    expect(err).toBeInstanceOf(InformaApiError);
    expect(err).toMatchObject({ status: 200, code: 10005 });
    expect(err.message).toContain("La sesión de Informa ha caducado");
    expect(err.message).toContain("POST /login");
    expect(err.message).not.toContain("rechaza las credenciales");
  });

  it("never puts the session in an error, even when fetch or Informa echo the URL", async () => {
    const leakyUrl = "https://services.informa.es/api/v2/get-product?cif=B1&username=user-x&session=sess-secret";
    const net = client([new Error(`request to ${leakyUrl} failed`)], { maxRetries: 0 });
    const netErr = await fail(net.api.getReport("B1"));
    expect(netErr.message).toContain("session=***");
    expect(netErr.message).not.toContain("sess-secret");

    const echo = client([{ status: 401, body: errorBody(10001, "Sesión sess-secret no válida") }]);
    const echoErr = await fail(echo.api.getReport("B1"));
    expect(echoErr).toMatchObject({ status: 401, code: 10001 });
    expect(echoErr.message).not.toContain("sess-secret");
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
  it("scrubs the raw and URL-encoded forms of the secret", () => {
    expect(redact("a s/k+y=1 b", "s/k+y=1")).toBe("a *** b");
    expect(redact("?session=s%2Fk%2By%3D1&x", "s/k+y=1")).toBe("?session=***&x");
    expect(redact("nothing here", "")).toBe("nothing here");
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
