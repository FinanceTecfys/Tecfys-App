import { describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_KIND_ORDER,
  ATTACHMENT_KINDS,
  attachmentSlots,
  attachmentStoragePath,
  type AttachmentDownloadDeps,
  type AttachmentUploadDeps,
  downloadFileName,
  isAttachmentKind,
  MAX_ATTACHMENT_BYTES,
  OPERATION_FORM_KINDS,
  readAttachments,
  sanitizeFileName,
  serveAttachment,
  sniffAttachmentType,
  type StoredAttachment,
  storeAttachment,
  toAttachmentRow,
  validateAttachment,
} from "../attachments";

const bytes = (...head: number[]) => new Uint8Array([...head, ...new Array(32).fill(0x20)]);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

const PDF = bytes(...ascii("%PDF-1.7"));
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = bytes(...ascii("RIFF"), 0x10, 0, 0, 0, ...ascii("WEBP"));
const WAV = bytes(...ascii("RIFF"), 0x10, 0, 0, 0, ...ascii("WAVE"));
const GIF = bytes(...ascii("GIF89a"));
const HTML = bytes(...ascii("<html><script>"));

const CONTRACT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("sniffAttachmentType", () => {
  it("recognises PDF and the accepted image types from their magic bytes", () => {
    expect(sniffAttachmentType(PDF)).toBe("application/pdf");
    expect(sniffAttachmentType(JPEG)).toBe("image/jpeg");
    expect(sniffAttachmentType(PNG)).toBe("image/png");
    expect(sniffAttachmentType(WEBP)).toBe("image/webp");
  });

  it("rejects everything else, including RIFF files that are not WEBP", () => {
    for (const other of [WAV, GIF, HTML, new Uint8Array(0), new Uint8Array([0x25, 0x50])]) {
      expect(sniffAttachmentType(other)).toBeNull();
    }
  });
});

describe("validateAttachment", () => {
  it("takes the type from the bytes, never from the file name", () => {
    const disguised = validateAttachment("id_document", { name: "dni.pdf", size: HTML.length, bytes: HTML });
    expect(disguised).toEqual({ ok: false, error: "DNI / NIE del firmante: solo se admiten PDF, JPG, PNG o WEBP" });

    const renamed = validateAttachment("id_document", { name: "dni.pdf", size: PNG.length, bytes: PNG });
    expect(renamed.ok && renamed.value.mimeType).toBe("image/png");
  });

  it("rejects empty files and files over the limit, and accepts exactly the limit", () => {
    expect(validateAttachment("bank_certificate", { name: "c.pdf", size: 0, bytes: new Uint8Array(0) }).ok).toBe(false);

    const over = validateAttachment("bank_certificate", { name: "c.pdf", size: MAX_ATTACHMENT_BYTES + 1, bytes: PDF });
    expect(over).toEqual({ ok: false, error: "Certificado bancario: supera el máximo de 8 MB" });

    const atLimit = new Uint8Array(MAX_ATTACHMENT_BYTES);
    atLimit.set(PDF);
    const ok = validateAttachment("bank_certificate", { name: "c.pdf", size: atLimit.length, bytes: atLimit });
    expect(ok.ok && ok.value.size).toBe(MAX_ATTACHMENT_BYTES);
  });

  it("keeps a readable but safe original name", () => {
    expect(sanitizeFileName("C:\\Users\\ana\\DNI Muñoz.pdf")).toBe("DNI Muñoz.pdf");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName('a"b\r\nc.pdf')).toBe("abc.pdf");
    expect(sanitizeFileName("   ")).toBe("documento");
    expect(sanitizeFileName("x".repeat(300))).toHaveLength(200);
  });
});

describe("readAttachments", () => {
  const file = (content: Uint8Array, name: string, type = "application/pdf") => new File([content.slice()], name, { type });

  it("treats a missing form or missing fields as nothing attached", async () => {
    expect(await readAttachments(undefined)).toEqual({ ok: true, attachments: [] });
    expect(await readAttachments(new FormData())).toEqual({ ok: true, attachments: [] });
  });

  it("reads both kinds and stores the sniffed type, not the browser's", async () => {
    const form = new FormData();
    form.set("id_document", file(JPEG, "dni.jpg", "application/pdf"));
    form.set("bank_certificate", file(PDF, "certificado.pdf"));
    const res = await readAttachments(form);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.attachments.map((a) => [a.kind, a.fileName, a.mimeType, a.size])).toEqual([
      ["id_document", "dni.jpg", "image/jpeg", JPEG.length],
      ["bank_certificate", "certificado.pdf", "application/pdf", PDF.length],
    ]);
  });

  it("returns a field error per invalid attachment, keyed by kind", async () => {
    const form = new FormData();
    form.set("id_document", file(GIF, "dni.gif", "image/gif"));
    form.set("bank_certificate", "not a file");
    const res = await readAttachments(form);
    expect(res).toEqual({
      ok: false,
      fieldErrors: {
        id_document: "DNI / NIE del firmante: solo se admiten PDF, JPG, PNG o WEBP",
        bank_certificate: "Certificado bancario: fichero no válido",
      },
    });
  });

  it("only reads the two kinds the operation form attaches", async () => {
    expect(OPERATION_FORM_KINDS).toEqual(["id_document", "bank_certificate"]);
    const form = new FormData();
    form.set("contract", file(PDF, "contrato.pdf"));
    form.set("extra", file(PDF, "anexo.pdf"));
    form.set("id_document", file(PDF, "dni.pdf"));
    const res = await readAttachments(form);
    expect(res.ok && res.attachments.map((a) => a.kind)).toEqual(["id_document"]);
  });

  it("refuses an oversized file without reading it", async () => {
    const big = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "big.pdf");
    const spy = vi.spyOn(big, "arrayBuffer");
    const form = new FormData();
    form.set("bank_certificate", big);
    const res = await readAttachments(form);
    expect(res.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("metadata", () => {
  it("maps a validated attachment to its table row", async () => {
    const res = validateAttachment("bank_certificate", { name: "Cert.pdf", size: PDF.length, bytes: PDF });
    if (!res.ok) throw new Error(res.error);
    const path = attachmentStoragePath(CONTRACT_ID, "bank_certificate", res.value.mimeType, "abc");
    expect(path).toBe(`${CONTRACT_ID}/bank_certificate-abc.pdf`);
    expect(toAttachmentRow(CONTRACT_ID, res.value, path)).toEqual({
      contract_id: CONTRACT_ID,
      kind: "bank_certificate",
      file_name: "Cert.pdf",
      mime_type: "application/pdf",
      size_bytes: PDF.length,
      storage_path: path,
    });
  });

  it("names downloads predictably, in ASCII", () => {
    expect(downloadFileName("id_document", "LB-00042", "image/png")).toBe("DNI_firmante_LB-00042.png");
    expect(downloadFileName("bank_certificate", "T/2026 01", "application/pdf")).toBe("Certificado_bancario_T_2026_01.pdf");
  });

  it("names the signed contract and the annex like the other documents", () => {
    expect(downloadFileName("contract", "LB-16535", "application/pdf")).toBe("Contrato_firmado_LB-16535.pdf");
    expect(downloadFileName("extra", "TCF-000042", "image/jpeg")).toBe("Anexo_TCF-000042.jpg");
    expect(attachmentStoragePath(CONTRACT_ID, "contract", "application/pdf", "abc")).toBe(`${CONTRACT_ID}/contract-abc.pdf`);
  });

  it("only knows the four kinds, and the file input accepts the same types", () => {
    expect(ATTACHMENT_KIND_ORDER).toEqual(["id_document", "bank_certificate", "contract", "extra"]);
    for (const kind of ATTACHMENT_KIND_ORDER) expect(isAttachmentKind(kind), kind).toBe(true);
    for (const bad of ["passport", "toString", "__proto__", "constructor", "Contract", "contract ", "", null, undefined, 3, ["contract"]]) expect(isAttachmentKind(bad)).toBe(false);
    expect(ATTACHMENT_ACCEPT.split(",")).toEqual(expect.arrayContaining(["application/pdf", "image/jpeg", "image/png", "image/webp"]));
  });
});

describe("attachmentSlots (the four document slots of a contract)", () => {
  const doc = (kind: string, name: string): StoredAttachment => ({ kind, file_name: name, mime_type: "application/pdf", size_bytes: 10, storage_path: `x/${kind}` });

  it("an imported loan-book contract starts with four empty slots", () => {
    const slots = attachmentSlots([]);
    expect(slots.map((s) => s.kind)).toEqual(["id_document", "bank_certificate", "contract", "extra"]);
    expect(slots.map((s) => s.label)).toEqual(["DNI / NIE del firmante", "Certificado bancario", "Contrato firmado", "Anexo / otro documento"]);
    expect(slots.every((s) => s.attachment === null)).toBe(true);
  });

  it("fills each slot with its stored document, whatever order the rows come in", () => {
    const slots = attachmentSlots([doc("extra", "anexo.pdf"), doc("id_document", "dni.pdf")]);
    expect(slots.map((s) => s.attachment?.file_name ?? null)).toEqual(["dni.pdf", null, null, "anexo.pdf"]);
  });

  it("is always exactly four slots: an unknown stored kind is not shown", () => {
    const slots = attachmentSlots([doc("passport", "x.pdf"), doc("contract", "contrato.pdf")]);
    expect(slots).toHaveLength(4);
    expect(slots.filter((s) => s.attachment).map((s) => s.kind)).toEqual(["contract"]);
  });

  it("every kind has a label, a download label and an ASCII file prefix", () => {
    for (const kind of ATTACHMENT_KIND_ORDER) {
      const { label, downloadLabel, filePrefix } = ATTACHMENT_KINDS[kind];
      expect(label.length, kind).toBeGreaterThan(0);
      expect(downloadLabel, kind).toMatch(/^Descargar /);
      expect(filePrefix, kind).toMatch(/^[A-Za-z_]+$/);
    }
  });
});

describe("storeAttachment (mocked storage)", () => {
  const file = (content: Uint8Array, name: string, type = "application/pdf") => new File([content.slice()], name, { type });

  function setup(over: Partial<AttachmentUploadDeps> = {}) {
    const bucket = new Map<string, Uint8Array>();
    const rows: Record<string, unknown>[] = [];
    const deps: AttachmentUploadDeps = {
      findContract: vi.fn(async (id: string) => ({ id })),
      hasAttachment: vi.fn(async () => false),
      upload: vi.fn(async (path, attachment) => {
        bucket.set(path, attachment.bytes);
        return null;
      }),
      insert: vi.fn(async (row) => {
        rows.push(row);
        return null;
      }),
      remove: vi.fn(async (path: string) => {
        bucket.delete(path);
      }),
      newId: () => "rand0m",
      ...over,
    };
    return { deps, bucket, rows };
  }

  it("stores each of the four kinds: the object in the bucket and its metadata row", async () => {
    for (const kind of ATTACHMENT_KIND_ORDER) {
      const { deps, bucket, rows } = setup();
      const res = await storeAttachment({ contractId: CONTRACT_ID, kind, file: file(PDF, "Documento firmado.pdf") }, deps);
      expect(res).toEqual({ ok: true, contractId: CONTRACT_ID, kind });
      const path = `${CONTRACT_ID}/${kind}-rand0m.pdf`;
      expect([...bucket.keys()]).toEqual([path]);
      expect(rows).toEqual([{ contract_id: CONTRACT_ID, kind, file_name: "Documento firmado.pdf", mime_type: "application/pdf", size_bytes: PDF.length, storage_path: path }]);
    }
  });

  it("stores the sniffed type, not the one the browser declared", async () => {
    const { deps, rows } = setup();
    await storeAttachment({ contractId: CONTRACT_ID, kind: "contract", file: file(PNG, "contrato.pdf", "application/pdf") }, deps);
    expect(rows[0]).toMatchObject({ mime_type: "image/png", storage_path: `${CONTRACT_ID}/contract-rand0m.png` });
  });

  it("refuses a malformed contract id or an unknown kind before any lookup", async () => {
    for (const params of [
      { contractId: "not-a-uuid", kind: "contract" },
      { contractId: `${CONTRACT_ID}/../x`, kind: "contract" },
      { contractId: null, kind: "contract" },
      { contractId: CONTRACT_ID, kind: "passport" },
      { contractId: CONTRACT_ID, kind: "toString" },
      { contractId: CONTRACT_ID, kind: null },
    ]) {
      const { deps } = setup();
      const res = await storeAttachment({ ...params, file: file(PDF, "c.pdf") }, deps);
      expect(res).toEqual({ ok: false, error: "Documento no válido" });
      expect(deps.findContract).not.toHaveBeenCalled();
      expect(deps.upload).not.toHaveBeenCalled();
    }
  });

  it("a contract outside the caller's scope reads as not found, and nothing is uploaded", async () => {
    const { deps, bucket } = setup({ findContract: vi.fn(async () => null) });
    const res = await storeAttachment({ contractId: CONTRACT_ID, kind: "contract", file: file(PDF, "c.pdf") }, deps);
    expect(res).toEqual({ ok: false, error: "Contrato no encontrado" });
    expect(deps.hasAttachment).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
    expect(bucket.size).toBe(0);
  });

  it("never replaces a document: a filled slot is refused", async () => {
    const { deps } = setup({ hasAttachment: vi.fn(async () => true) });
    const res = await storeAttachment({ contractId: CONTRACT_ID, kind: "contract", file: file(PDF, "c.pdf") }, deps);
    expect(res).toEqual({ ok: false, error: "Contrato firmado: el contrato ya tiene este documento" });
    expect(deps.hasAttachment).toHaveBeenCalledWith(CONTRACT_ID, "contract");
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it("applies the same type and size validation as the operation form", async () => {
    const big = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "big.pdf");
    const read = vi.spyOn(big, "arrayBuffer");
    const cases: [FormDataEntryValue | null, string][] = [
      [file(GIF, "contrato.gif", "image/gif"), "Contrato firmado: solo se admiten PDF, JPG, PNG o WEBP"],
      [file(HTML, "contrato.pdf"), "Contrato firmado: solo se admiten PDF, JPG, PNG o WEBP"],
      [big, "Contrato firmado: supera el máximo de 8 MB"],
      [new File([], "vacio.pdf"), "Contrato firmado: el fichero está vacío"],
      ["not a file", "Contrato firmado: fichero no válido"],
      [null, "Contrato firmado: selecciona un fichero"],
      ["", "Contrato firmado: selecciona un fichero"],
    ];
    for (const [entry, error] of cases) {
      const { deps } = setup();
      expect(await storeAttachment({ contractId: CONTRACT_ID, kind: "contract", file: entry }, deps), error).toEqual({ ok: false, error });
      expect(deps.upload).not.toHaveBeenCalled();
      expect(deps.insert).not.toHaveBeenCalled();
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("accepts a file of exactly the limit", async () => {
    const atLimit = new Uint8Array(MAX_ATTACHMENT_BYTES);
    atLimit.set(PDF);
    const { deps, rows } = setup();
    const res = await storeAttachment({ contractId: CONTRACT_ID, kind: "extra", file: file(atLimit, "anexo.pdf") }, deps);
    expect(res.ok).toBe(true);
    expect(rows[0]).toMatchObject({ size_bytes: MAX_ATTACHMENT_BYTES });
  });

  it("reports a storage failure and writes no row", async () => {
    const { deps } = setup({ upload: vi.fn(async () => "bucket unavailable") });
    const res = await storeAttachment({ contractId: CONTRACT_ID, kind: "extra", file: file(PDF, "a.pdf") }, deps);
    expect(res).toEqual({ ok: false, error: "No se pudo guardar el documento: bucket unavailable" });
    expect(deps.insert).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it("removes the uploaded object when the metadata row cannot be written (no orphan in the bucket)", async () => {
    const { deps, bucket } = setup({ insert: vi.fn(async () => "duplicate key value violates unique constraint") });
    const res = await storeAttachment({ contractId: CONTRACT_ID, kind: "extra", file: file(PDF, "a.pdf") }, deps);
    expect(res.ok).toBe(false);
    expect(deps.remove).toHaveBeenCalledWith(`${CONTRACT_ID}/extra-rand0m.pdf`);
    expect(bucket.size).toBe(0);
  });
});

describe("serveAttachment (mocked storage)", () => {
  const stored: StoredAttachment = {
    kind: "bank_certificate",
    file_name: "certificado original.pdf",
    mime_type: "application/pdf",
    size_bytes: PDF.length,
    storage_path: `${CONTRACT_ID}/bank_certificate-xyz.pdf`,
  };
  const deps = (over: Partial<AttachmentDownloadDeps> = {}): AttachmentDownloadDeps => ({
    find: vi.fn(async () => ({ contractNumber: "LB-00042", attachment: stored })),
    download: vi.fn(async () => new Blob([PDF.slice()], { type: "application/octet-stream" })),
    ...over,
  });

  it("streams the stored file as a no-store download with its stored type", async () => {
    const d = deps();
    const res = await serveAttachment({ id: CONTRACT_ID, kind: "bank_certificate" }, d);
    expect(res.status).toBe(200);
    expect(d.find).toHaveBeenCalledWith(CONTRACT_ID, "bank_certificate");
    expect(d.download).toHaveBeenCalledWith(stored.storage_path);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Length")).toBe(String(PDF.length));
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="Certificado_bancario_LB-00042.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    // Nothing about the bucket leaks to the client: no redirect, no storage path.
    expect([...res.headers.values()].join(" ")).not.toContain("xyz");
    expect(res.headers.get("Location")).toBeNull();
  });

  it("404s a malformed contract id or kind without touching the database or storage", async () => {
    for (const params of [
      { id: "not-a-uuid", kind: "id_document" },
      { id: `${CONTRACT_ID}/../x`, kind: "id_document" },
      { id: CONTRACT_ID, kind: "passport" },
      { id: CONTRACT_ID, kind: "../../informa-reports" },
    ]) {
      const d = deps();
      const res = await serveAttachment(params, d);
      expect(res.status).toBe(404);
      expect(d.find).not.toHaveBeenCalled();
      expect(d.download).not.toHaveBeenCalled();
    }
  });

  it("404s when the contract has no attachment of that kind", async () => {
    const d = deps({ find: vi.fn(async () => null) });
    const res = await serveAttachment({ id: CONTRACT_ID, kind: "id_document" }, d);
    expect(res.status).toBe(404);
    expect(d.download).not.toHaveBeenCalled();
  });

  it("502s when storage cannot return the object", async () => {
    const res = await serveAttachment({ id: CONTRACT_ID, kind: "bank_certificate" }, deps({ download: vi.fn(async () => null) }));
    expect(res.status).toBe(502);
  });
});
