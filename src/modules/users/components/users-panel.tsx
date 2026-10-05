"use client";

import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, inputClass, SelectField } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { type Role, ROLE_LABELS } from "@/lib/auth/permissions";
import { deleteUser, inviteUser, setUserActive, updateUserRole, type UserResult } from "../actions";
import type { UserRow } from "../data";
import { type Actor, assignableRoles, checkCanManage, checkDeleteUser } from "../domain/rules";

interface DistributorOption {
  id: string;
  name: string;
}

const roleOptions = (roles: Role[]) => roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

function InviteUserForm({ roles, distributors }: { roles: Role[]; distributors: DistributorOption[] }) {
  const [role, setRole] = useState<Role>(roles[roles.length - 1]);
  const [feedback, setFeedback] = useState<UserResult | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={(fd) =>
        start(async () => {
          const res = await inviteUser({
            email: String(fd.get("email") ?? ""),
            role,
            distributorId: role === "partner" ? String(fd.get("distributorId") ?? "") : null,
          });
          setFeedback(res);
          if (res.ok) ref.current?.reset();
        })
      }
      className="space-y-3"
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.6fr_180px_1fr_auto] xl:items-end">
        <Field label="Email del nuevo usuario" name="email" type="email" autoComplete="off" required />
        <SelectField label="Rol" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} options={roleOptions(roles)} />
        {role === "partner" ? (
          <SelectField label="Distribuidor" name="distributorId" required placeholder="— Selecciona —" options={distributors.map((d) => ({ value: d.id, label: d.name }))} />
        ) : (
          <span className="hidden xl:block" />
        )}
        <Button type="submit" disabled={pending}>{pending ? "Enviando…" : "Invitar"}</Button>
      </div>
      <p role="status" className={`text-[11px] ${feedback ? (feedback.ok ? "text-mint-400" : "text-red-300") : "text-slate-500"}`}>
        {feedback
          ? feedback.ok
            ? (feedback.notice ?? "Invitación enviada.")
            : feedback.error
          : "El usuario recibe un email con un enlace para crear su propia contraseña; el rol queda asignado desde ahora."}
      </p>
    </form>
  );
}

function UserRowEditor({ user, roles, distributors, canEdit, canDelete }: { user: UserRow; roles: Role[]; distributors: DistributorOption[]; canEdit: boolean; canDelete: boolean }) {
  const [role, setRole] = useState<Role | "">(user.role ?? "");
  const [distributorId, setDistributorId] = useState(user.distributor?.id ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = role !== (user.role ?? "") || (role === "partner" && distributorId !== (user.distributor?.id ?? ""));
  const who = user.email ?? user.id;

  const run = (action: () => Promise<UserResult>) =>
    start(async () => {
      const res = await action();
      setError(res.ok ? null : res.error);
      if (!res.ok) setConfirmingDelete(false);
    });

  if (confirmingDelete) {
    return (
      <div role="group" aria-label={`Confirmar la eliminación de ${who}`} className="space-y-2">
        <p className="text-xs text-slate-300">
          ¿Eliminar definitivamente a <span className="font-semibold">{who}</span>? Pierde el acceso y su cuenta se borra; los scorings y operaciones que creó se conservan.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="danger" disabled={pending} onClick={() => run(() => deleteUser({ userId: user.id }))}>
            {pending ? "Eliminando…" : "Sí, eliminar"}
          </Button>
          <Button type="button" variant="ghost" disabled={pending} autoFocus onClick={() => setConfirmingDelete(false)}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label={`Rol de ${who}`} className={`${inputClass} w-40`}>
              {user.role === null && <option value="">Sin acceso</option>}
              {roleOptions(roles).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {role === "partner" && (
              <select value={distributorId} onChange={(e) => setDistributorId(e.target.value)} aria-label={`Distribuidor de ${who}`} className={`${inputClass} w-48`}>
                <option value="">— Distribuidor —</option>
                {distributors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            {changed && role !== "" && (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => updateUserRole({ userId: user.id, role, distributorId: role === "partner" ? distributorId : null }))}
              >
                Guardar
              </Button>
            )}
            {user.role !== null && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setUserActive({ userId: user.id, active: !user.active }))}
                className="text-xs text-slate-400 hover:text-mint-400 hover:underline disabled:opacity-50"
              >
                {user.active ? "Desactivar" : "Reactivar"}
              </button>
            )}
          </>
        )}
        {canDelete && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmingDelete(true)}
            aria-label={`Eliminar a ${who}`}
            className="text-xs text-red-300 hover:underline disabled:opacity-50"
          >
            Eliminar
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}

function Status({ user }: { user: UserRow }) {
  if (user.role === null) return <span className="text-slate-600">—</span>;
  if (!user.active) return <span className="text-xs text-yellow-300">Desactivado</span>;
  if (user.invitePending) return <span className="text-xs text-slate-400">Invitación pendiente</span>;
  return <span className="text-xs text-mint-400">Activo</span>;
}

/**
 * "Usuarios y roles" in Settings. What it offers follows the same pure rules
 * the Server Actions enforce (domain/rules.ts): the actions are the real gate.
 */
export function UsersPanel({ actor, users, distributors }: { actor: Actor; users: UserRow[]; distributors: DistributorOption[] }) {
  const roles = assignableRoles(actor.role);
  return (
    <div className="space-y-5">
      <InviteUserForm roles={roles} distributors={distributors} />
      <Table>
        <thead><tr><Th>Email</Th><Th>Rol</Th><Th>Distribuidor</Th><Th>Estado</Th><Th>Gestión</Th></tr></thead>
        <tbody>
          {users.map((u) => {
            const canEdit = checkCanManage(actor, { id: u.id, role: u.role }).ok;
            const canDelete = checkDeleteUser(actor, { id: u.id, role: u.role, email: u.email }).ok;
            return (
              <tr key={u.id}>
                <Td>
                  {u.email ?? "—"}
                  {u.id === actor.id && <span className="ml-2 text-xs text-slate-500">(tú)</span>}
                </Td>
                <Td>{u.role ? <Badge tone={u.role === "owner" ? "mint" : "slate"}>{ROLE_LABELS[u.role]}</Badge> : <span className="text-slate-500">Sin acceso</span>}</Td>
                <Td className="text-slate-400">{u.distributor?.name ?? "—"}</Td>
                <Td><Status user={u} /></Td>
                <Td className="whitespace-normal">
                  {canEdit || canDelete ? (
                    <UserRowEditor key={`${u.role}-${u.distributor?.id}-${u.active}`} user={u} roles={roles} distributors={distributors} canEdit={canEdit} canDelete={canDelete} />
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
