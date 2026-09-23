"use client";

import { useRef } from "react";
import { FileText, Paperclip, RefreshCw, X } from "lucide-react";
import { Label } from "@/components/ui/field";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES } from "../domain/attachments";

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Optional file attached to the operation (PDF or image). Held in the form's
 * state until submit; the server re-validates type and size from the bytes.
 */
export function AttachmentInput({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: File | null;
  onChange: (file: File | null) => void;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const tooBig = value !== null && value.size > MAX_ATTACHMENT_BYTES;
  const message = error ?? (tooBig ? "Supera el máximo de 8 MB" : undefined);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.files?.[0] ?? null);
    // Let the same file be picked again after removing it.
    e.target.value = "";
  }

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <input ref={input} id={id} type="file" accept={ATTACHMENT_ACCEPT} onChange={pick} className="sr-only" tabIndex={-1} />
      {value ? (
        <div className="flex items-center gap-1">
          <span className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-slate-100" title={value.name}>
            <FileText className="h-4 w-4 shrink-0 text-mint-400" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{value.name}</span>
            <span className="num shrink-0 text-[11px] text-slate-500">{fmtSize(value.size)}</span>
          </span>
          <button type="button" onClick={() => input.current?.click()} aria-label={`Sustituir ${label.toLowerCase()}`} title="Sustituir" className="rounded-md border border-ink-700 px-2.5 py-2 text-slate-400 hover:text-white">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onChange(null)} aria-label={`Quitar ${label.toLowerCase()}`} title="Quitar" className="rounded-md border border-ink-700 px-2.5 py-2 text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-mint-500/50 px-3 py-2 text-sm text-mint-400 transition hover:border-mint-500 hover:bg-mint-500/10"
        >
          <Paperclip className="h-4 w-4" aria-hidden /> Adjuntar
        </button>
      )}
      {message ? (
        <p className="mt-1 text-[11px] text-red-300">{message}</p>
      ) : (
        <p className="mt-1 text-[11px] text-slate-500">PDF o imagen, máx. 8 MB · opcional</p>
      )}
    </div>
  );
}
