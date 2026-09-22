import { cn } from "@/lib/utils";

export const inputClass =
  "w-full rounded-md border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-mint-500 disabled:opacity-60";

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[11px] uppercase tracking-[0.14em] text-slate-400">
      {children}
    </label>
  );
}

export function Field({
  label,
  hint,
  error,
  suffix,
  className,
  id,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; suffix?: string }) {
  const inputId = id ?? input.name;
  return (
    <div className={className}>
      <Label htmlFor={inputId}>{label}</Label>
      <div className="relative">
        <input id={inputId} className={cn(inputClass, input.type === "number" && "num", suffix && "pr-10")} {...input} />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{suffix}</span>}
      </div>
      {error ? (
        <p className="mt-1 text-[11px] text-red-300">{error}</p>
      ) : (
        hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  options,
  placeholder,
  error,
  className,
  id,
  ...select
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: string;
}) {
  const selectId = id ?? select.name;
  return (
    <div className={className}>
      <Label htmlFor={selectId}>{label}</Label>
      <select id={selectId} className={inputClass} {...select}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
