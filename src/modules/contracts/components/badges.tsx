import { Badge, type Tone } from "@/components/ui/badge";
import type { ContractStatus } from "../domain/schedule";

const LIFECYCLE: Record<ContractStatus, { label: string; tone: Tone }> = {
  Active: { label: "Activo", tone: "mint" },
  "On Track": { label: "En plazo", tone: "emerald" },
  Extended: { label: "Extendido", tone: "yellow" },
  Finished: { label: "Finalizado", tone: "slate" },
};

export function LifecycleBadge({ status }: { status: ContractStatus }) {
  return <Badge tone={LIFECYCLE[status].tone}>{LIFECYCLE[status].label}</Badge>;
}

const WORKFLOW: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Borrador", tone: "slate" },
  pending_signature: { label: "Pendiente de firma", tone: "orange" },
  signed: { label: "Firmado", tone: "mint" },
  cancelled: { label: "Anulado", tone: "red" },
};

export function WorkflowBadge({ status }: { status: string }) {
  const w = WORKFLOW[status] ?? { label: status, tone: "slate" as const };
  return <Badge tone={w.tone}>{w.label}</Badge>;
}
