import { useTranslations } from "next-intl";
import { Badge, type Tone } from "@/components/ui/badge";
import type { ContractStatus } from "../domain/schedule";

const LIFECYCLE_TONE: Record<ContractStatus, Tone> = { Active: "mint", "On Track": "emerald", Extended: "yellow", Finished: "slate" };

export function LifecycleBadge({ status }: { status: ContractStatus }) {
  const t = useTranslations("contract.lifecycle");
  return <Badge tone={LIFECYCLE_TONE[status]}>{t(status)}</Badge>;
}

const WORKFLOW_TONE = { draft: "slate", pending_signature: "orange", signed: "mint", cancelled: "red" } as const satisfies Record<string, Tone>;
const isWorkflow = (status: string): status is keyof typeof WORKFLOW_TONE => Object.hasOwn(WORKFLOW_TONE, status);

export function WorkflowBadge({ status }: { status: string }) {
  const t = useTranslations("contract.workflow");
  return isWorkflow(status) ? <Badge tone={WORKFLOW_TONE[status]}>{t(status)}</Badge> : <Badge tone="slate">{status}</Badge>;
}
