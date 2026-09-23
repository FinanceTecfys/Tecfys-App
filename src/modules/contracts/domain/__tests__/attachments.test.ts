import { describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_ACCEPT,
  attachmentStoragePath,
  type AttachmentDownloadDeps,
  downloadFileName,
  isAttachmentKind,
  MAX_ATTACHMENT_BYTES,
  readAttachments,
  sanitizeFileName,
  serveAttachment,
  sniffAttachmentType,
  type StoredAttachment,
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

  it("only knows the two kinds, and the file input accepts the same types", () => {
    expect(isAttachmentKind("id_document")).toBe(true);
    expect(isAttachmentKind("bank_certificate")).toBe(true);
    for (const bad of ["passport", "toString", "__proto__", "", null]) expect(isAttachmentKind(bad)).toBe(false);
    expect(ATTACHMENT_ACCEPT.split(",")).toEqual(expect.arrayContaining(["application/pdf", "image/jpeg", "image/png", "image/webp"]));
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
