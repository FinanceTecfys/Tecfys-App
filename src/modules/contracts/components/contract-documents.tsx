"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileDown, Upload } from "lucide-react";
import { uploadContractAttachment } from "../actions";
import { ATTACHMENT_ACCEPT, type AttachmentKind, MAX_ATTACHMENT_BYTES } from "../domain/attachments";

export interface DocumentSlot {
  kind: AttachmentKind;
  /** Original name of the stored file; null while the slot is empty. */
  fileName: string | null;
}

/**
 * The document slots of a contract: a download link for each stored document
 * and an upload button for each missing one. The file is sent straight to the
 * server action, which checks access, type and size before storing it in the
 * private bucket; downloads go through the streaming route.
 */
export function ContractDocuments({ contractId, slots }: { contractId: string; slots: DocumentSlot[] }) {
  const t = useTranslations("contract.documents");
  const tValidation = useTranslations("validation.attachment");
  const router = useRouter();
  const inputs = useRef<Partial<Record<AttachmentKind, HTMLInputElement | null>>>({});
  const [errors, setErrors] = useState<Partial<Record<AttachmentKind, string>>>({});
  const [uploading, setUploading] = useState<AttachmentKind | null>(null);
  const [, startUpload] = useTransition();

  function upload(kind: AttachmentKind, file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setErrors((prev) => ({ ...prev, [kind]: tValidation("tooLarge", { kind }) }));
      return;
    }
    const form = new FormData();
    form.set("contractId", contractId);
    form.set("kind", kind);
    form.set("file", file);
    setErrors((prev) => ({ ...prev, [kind]: undefined }));
    setUploading(kind);
    startUpload(async () => {
      try {
        const res = await uploadContractAttachment(form);
        if (res.ok) router.refresh();
        else setErrors((prev) => ({ ...prev, [kind]: res.error }));
      } catch {
        setErrors((prev) => ({ ...prev, [kind]: t("uploadFailed", { document: t(`kinds.${kind}`) }) }));
      } finally {
        setUploading(null);
      }
    });
  }

  return (
    <ul className="space-y-3">
      {slots.map(({ kind, fileName }) => (
        <li key={kind}>
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-slate-400">{t(`kinds.${kind}`)}</div>
          {fileName ? (
            <a
              href={`/contracts/${contractId}/attachments/${kind}`}
              title={fileName}
              className="flex items-center gap-2 rounded-md border border-mint-500/50 px-3 py-2 text-sm font-semibold text-mint-400 transition hover:bg-mint-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint-500"
            >
              <FileDown className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{fileName}</span>
              <span className="shrink-0 text-[11px] font-normal text-slate-400">{t("download")}</span>
            </a>
          ) : (
            <>
              <input
                ref={(el) => {
                  inputs.current[kind] = el;
                }}
                type="file"
                accept={ATTACHMENT_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  upload(kind, e.target.files?.[0]);
                  // Let the same file be picked again after an error.
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => inputs.current[kind]?.click()}
                disabled={uploading !== null}
                aria-label={t("uploadAria", { document: t(`kinds.${kind}`) })}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-ink-600 px-3 py-2 text-sm text-slate-300 transition hover:border-mint-500 hover:text-mint-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-4 w-4" aria-hidden />
                {uploading === kind ? t("uploading") : t("upload")}
              </button>
            </>
          )}
          {errors[kind] && <p role="alert" className="mt-1 text-[11px] text-red-300">{errors[kind]}</p>}
        </li>
      ))}
      <li className="text-[11px] text-slate-500">{t("limits")}</li>
    </ul>
  );
}
