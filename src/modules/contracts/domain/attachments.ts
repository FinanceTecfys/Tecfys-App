/**
 * Contract documents: four slots any contract can hold, app-created or
 * imported from the loan book - the signatory's ID document, the bank
 * certificate, the signed contract itself and one optional annex. The first
 * two can be attached with "Nueva operación"; all four from the contract page.
 * Pure - no Supabase, no Next - so the validation, the metadata mapping, the
 * upload and the download response are unit-tested with a mocked storage.
 *
 * The server never trusts the browser: the type is sniffed from the file's
 * first bytes (the client's MIME type and extension are ignored) and the
 * detected type is what gets stored and served back.
 */

export const ATTACHMENT_KINDS = {
  id_document: { label: "DNI / NIE del firmante", downloadLabel: "Descargar DNI / NIE del firmante", filePrefix: "DNI_firmante" },
  bank_certificate: { label: "Certificado bancario", downloadLabel: "Descargar certificado bancario", filePrefix: "Certificado_bancario" },
  contract: { label: "Contrato firmado", downloadLabel: "Descargar contrato firmado", filePrefix: "Contrato_firmado" },
  extra: { label: "Anexo / otro documento", downloadLabel: "Descargar anexo", filePrefix: "Anexo" },
} as const;

export type AttachmentKind = keyof typeof ATTACHMENT_KINDS;

/** The four slots, in the order the contract page shows them. */
export const ATTACHMENT_KIND_ORDER = Object.keys(ATTACHMENT_KINDS) as AttachmentKind[];

/** The kinds the operation form attaches; the others are uploaded from the contract page. */
export const OPERATION_FORM_KINDS = ["id_document", "bank_certificate"] as const satisfies readonly AttachmentKind[];

export const isAttachmentKind = (value: unknown): value is AttachmentKind =>
  typeof value === "string" && Object.hasOwn(ATTACHMENT_KINDS, value);

export const ATTACHMENT_BUCKET = "contract-attachments";

/**
 * 8 MB per file: the two files of the operation form together, and each
 * single upload from the contract page, stay under the 20 MB Server Action
 * body limit of next.config.ts. Mirrors the bucket and the table check constraint.
 */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export const ATTACHMENT_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type AttachmentMime = keyof typeof ATTACHMENT_TYPES;

/** `accept` attribute of the file inputs: a convenience only, re-checked server-side. */
export const ATTACHMENT_ACCEPT = [...Object.keys(ATTACHMENT_TYPES), ".pdf", ".jpg", ".jpeg", ".png", ".webp"].join(",");

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

/** Detect the real type from the magic bytes; null for anything not accepted. */
export function sniffAttachmentType(bytes: Uint8Array): AttachmentMime | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"; // RIFF....WEBP
  return null;
}

export interface ValidAttachment {
  kind: AttachmentKind;
  fileName: string;
  mimeType: AttachmentMime;
  size: number;
  bytes: Uint8Array;
}

export type AttachmentValidation = { ok: true; value: ValidAttachment } | { ok: false; error: string };

/** Keep the original name readable but safe to store and to echo in a header. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200);
  return clean || "documento";
}

export function validateAttachment(kind: AttachmentKind, file: { name: string; size: number; bytes: Uint8Array }): AttachmentValidation {
  const label = ATTACHMENT_KINDS[kind].label;
  if (file.size === 0 || file.bytes.length === 0) return { ok: false, error: `${label}: el fichero está vacío` };
  if (file.size > MAX_ATTACHMENT_BYTES || file.bytes.length > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `${label}: supera el máximo de 8 MB` };
  }
  const mimeType = sniffAttachmentType(file.bytes);
  if (!mimeType) return { ok: false, error: `${label}: solo se admiten PDF, JPG, PNG o WEBP` };
  return { ok: true, value: { kind, fileName: sanitizeFileName(file.name), mimeType, size: file.bytes.length, bytes: file.bytes } };
}

/**
 * Read and validate the optional attachments of the operation form. A missing
 * or empty field is simply "not attached"; any other problem is an error for
 * that field, keyed like the form's field errors.
 */
export async function readAttachments(formData: FormData | undefined): Promise<
  { ok: true; attachments: ValidAttachment[] } | { ok: false; fieldErrors: Record<string, string> }
> {
  const attachments: ValidAttachment[] = [];
  const fieldErrors: Record<string, string> = {};
  if (!formData) return { ok: true, attachments };
  for (const kind of OPERATION_FORM_KINDS) {
    const result = await readAttachmentEntry(kind, formData.get(kind));
    if (result === null) continue;
    if (result.ok) attachments.push(result.value);
    else fieldErrors[kind] = result.error;
  }
  return Object.keys(fieldErrors).length ? { ok: false, fieldErrors } : { ok: true, attachments };
}

/** One form entry -> a validated attachment; null when nothing was attached. */
export async function readAttachmentEntry(kind: AttachmentKind, entry: FormDataEntryValue | null): Promise<AttachmentValidation | null> {
  if (entry === null || entry === "") return null;
  if (typeof entry === "string") return { ok: false, error: `${ATTACHMENT_KINDS[kind].label}: fichero no válido` };
  if (entry.size === 0 && entry.name === "") return null;
  // Never read more than the limit allows: an oversized file is refused by its declared size.
  if (entry.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: `${ATTACHMENT_KINDS[kind].label}: supera el máximo de 8 MB` };
  return validateAttachment(kind, { name: entry.name, size: entry.size, bytes: new Uint8Array(await entry.arrayBuffer()) });
}

/** Object key in the bucket: grouped by contract, random so it is never guessable. */
export function attachmentStoragePath(contractId: string, kind: AttachmentKind, mimeType: AttachmentMime, id: string): string {
  return `${contractId}/${kind}-${id}.${ATTACHMENT_TYPES[mimeType]}`;
}

export interface AttachmentRowInsert {
  contract_id: string;
  kind: AttachmentKind;
  file_name: string;
  mime_type: AttachmentMime;
  size_bytes: number;
  storage_path: string;
}

export function toAttachmentRow(contractId: string, attachment: ValidAttachment, storagePath: string): AttachmentRowInsert {
  return {
    contract_id: contractId,
    kind: attachment.kind,
    file_name: attachment.fileName,
    mime_type: attachment.mimeType,
    size_bytes: attachment.size,
    storage_path: storagePath,
  };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/** What the contract page and the download route read back from the table. */
export interface StoredAttachment {
  kind: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
}

export interface AttachmentSlot {
  kind: AttachmentKind;
  label: string;
  /** The stored document; null while the slot is empty. */
  attachment: StoredAttachment | null;
}

/**
 * The four document slots of a contract, always all of them and in a fixed
 * order: filled with what is stored, empty otherwise. An imported loan-book
 * contract simply starts with four empty slots.
 */
export function attachmentSlots(stored: readonly StoredAttachment[]): AttachmentSlot[] {
  return ATTACHMENT_KIND_ORDER.map((kind) => ({
    kind,
    label: ATTACHMENT_KINDS[kind].label,
    attachment: stored.find((a) => a.kind === kind) ?? null,
  }));
}

/**
 * Download name: "<prefix>_<contract number>.<ext>" - predictable for the
 * analyst, and ASCII so every browser honours it.
 */
export function downloadFileName(kind: AttachmentKind, contractNumber: string, mimeType: string): string {
  const ext = ATTACHMENT_TYPES[mimeType as AttachmentMime] ?? "bin";
  const number = contractNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${ATTACHMENT_KINDS[kind].filePrefix}_${number}.${ext}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AttachmentDownloadDeps {
  /** Contract number + the stored attachment of that kind; null when either is absent. */
  find: (contractId: string, kind: AttachmentKind) => Promise<{ contractNumber: string; attachment: StoredAttachment } | null>;
  /** The object from the private bucket; null when storage cannot return it. */
  download: (storagePath: string) => Promise<Blob | null>;
}

/**
 * Serve one attachment from the private bucket, streamed through the server.
 * The file is always sent as a download, with its stored (sniffed) type and
 * never cached; the bucket path and any URL to it stay on the server.
 */
export async function serveAttachment(params: { id: string; kind: string }, deps: AttachmentDownloadDeps): Promise<Response> {
  if (!UUID.test(params.id) || !isAttachmentKind(params.kind)) return new Response("Not found", { status: 404 });

  const found = await deps.find(params.id, params.kind);
  if (!found) return new Response("Not found", { status: 404 });

  const blob = await deps.download(found.attachment.storage_path);
  if (!blob) return new Response("The file could not be read from storage", { status: 502 });

  const name = downloadFileName(params.kind, found.contractNumber, found.attachment.mime_type);
  return new Response(blob.stream(), {
    headers: {
      "Content-Type": found.attachment.mime_type,
      "Content-Length": String(blob.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ---------------------------------------------------------------------------
// Upload into a slot (contract page)
// ---------------------------------------------------------------------------

export interface AttachmentUploadDeps {
  /** The contract, only if it exists AND is inside the caller's scope; null otherwise. */
  findContract: (contractId: string) => Promise<{ id: string } | null>;
  /** Whether the slot already holds a document. */
  hasAttachment: (contractId: string, kind: AttachmentKind) => Promise<boolean>;
  /** Put the object in the private bucket; an error message when storage refuses it. */
  upload: (storagePath: string, attachment: ValidAttachment) => Promise<string | null>;
  /** Write the metadata row; an error message when the database refuses it. */
  insert: (row: AttachmentRowInsert) => Promise<string | null>;
  remove: (storagePath: string) => Promise<void>;
  /** Random id of the object key. */
  newId: () => string;
}

export type AttachmentUploadResult = { ok: true; contractId: string; kind: AttachmentKind } | { ok: false; error: string };

/**
 * Store one document in an empty slot of a contract. Everything is checked
 * before a byte is written: the ids, the caller's access to the contract (a
 * contract outside its scope reads as not found), that the slot is empty, and
 * the file's real type and size. If the metadata row cannot be written the
 * uploaded object is removed, so the bucket never keeps an orphan.
 */
export async function storeAttachment(
  params: { contractId: unknown; kind: unknown; file: FormDataEntryValue | null },
  deps: AttachmentUploadDeps,
): Promise<AttachmentUploadResult> {
  const { contractId, kind } = params;
  if (typeof contractId !== "string" || !UUID.test(contractId) || !isAttachmentKind(kind)) return { ok: false, error: "Documento no válido" };

  const contract = await deps.findContract(contractId);
  if (!contract) return { ok: false, error: "Contrato no encontrado" };

  const label = ATTACHMENT_KINDS[kind].label;
  if (await deps.hasAttachment(contract.id, kind)) return { ok: false, error: `${label}: el contrato ya tiene este documento` };

  const file = await readAttachmentEntry(kind, params.file);
  if (file === null) return { ok: false, error: `${label}: selecciona un fichero` };
  if (!file.ok) return { ok: false, error: file.error };

  const path = attachmentStoragePath(contract.id, kind, file.value.mimeType, deps.newId());
  const uploadError = await deps.upload(path, file.value);
  if (uploadError) return { ok: false, error: `No se pudo guardar el documento: ${uploadError}` };

  const rowError = await deps.insert(toAttachmentRow(contract.id, file.value, path));
  if (rowError) {
    await deps.remove(path);
    return { ok: false, error: `No se pudo guardar el documento: ${rowError}` };
  }
  return { ok: true, contractId: contract.id, kind };
}
