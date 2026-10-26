"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClass, Label } from "@/components/ui/field";
import { reviewScoring } from "../actions";

export function ReviewForm({ scoringId }: { scoringId: string }) {
  const t = useTranslations("scoring.review");
  const [state, action, pending] = useActionState(reviewScoring, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={scoringId} />
      <div>
        <Label htmlFor="note">{t("note")}</Label>
        <textarea id="note" name="note" rows={3} required className={inputClass} placeholder={t("placeholder")} />
      </div>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" name="status" value="approved" disabled={pending}>{t("approve")}</Button>
        <Button type="submit" name="status" value="rejected" variant="danger" disabled={pending}>{t("reject")}</Button>
      </div>
    </form>
  );
}
