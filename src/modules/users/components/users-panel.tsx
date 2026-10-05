"use client";

import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, inputClass, SelectField } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { type Role, ROLE_LABELS } from "@/lib/auth/permissions";
import { createUser, setUserActive, updateUserRole } from "../actions";
import type { UserRow } from "../data";
import { type Actor, assignableRoles, checkCanManage, MIN_PASSWORD_LENGTH } from "../domain/rules";

interface DistributorOption {
  id: string;
  name: string;
}

const roleOptions = (roles: Role[]) => roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

function NewUserForm({ roles, distributors }: { roles: Role[]; distributors: DistributorOption[] }) {
  const [role, setRole] = useState<Role>(roles[roles.length - 1]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={(fd) =>
        start(async () => {
          const res = await createUser({
            email: String(fd.get("email") ?? ""),
            password: String(fd.get("password") ?? ""),
            role,
            distributorId: role === "partner" ? String(fd.get("distributorId") ?? "") : null,
          });
          if (!res.ok) return setError(res.error);
          setError(null);
          ref.current?.reset();
        })
      }
      className="space-y-3"
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_160px_1fr_auto] xl:items-end">
        <Field label="Email del nuevo usuario" name="email" type="email" autoComplete="off" required />
        <Field label="Contraseña inicial" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
        <SelectField label="Rol" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} options={roleOptions(roles)} />
        {role === "partner" ? (
          <SelectField label="Distribuidor" name="distributorId" required placeholder="— Selecciona —" options={distributors.map((d) => ({ value: d.id, label: d.name }))} />
        ) : (
          <span className="hidden xl:block" />
        )}
        <Button type="submit" disabled={pending}>Crear usuario</Button>
      </div>
      <p className={`text-[11px] ${error ? "text-red-300" : "text-slate-500"}`}>
        {error ?? `La cuenta queda activa con esa contraseña (mínimo ${MIN_PASSWORD_LENGTH} caracteres): comunícala al usuario por un canal seguro.`}
      </p>
    </form>
  );
}

function UserRowEditor({ user, roles, distributors }: { user: UserRow; roles: Role[]; distributors: DistributorOption[] }) {
  const [role, setRole] = useState<Role | "">(user.role ?? "");
  const [distributorId, setDistributorId] = useState(user.distributor?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = role !== (user.role ?? "") || (role === "partner" && distributorId !== (user.distributor?.id ?? ""));

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      const res = await action();
      setError(res.ok ? null : res.error);
    });

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label={`Rol de ${user.email ?? user.id}`} className={`${inputClass} w-40`}>
          {user.role === null && <option value="">Sin acceso</option>}
          {roleOptions(roles).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {role === "partner" && (
          <select value={distributorId} onChange={(e) => setDistributorId(e.target.value)} aria-label={`Distribuidor de ${user.email ?? user.id}`} className={`${inputClass} w-48`}>
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
      </div>
      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}

/**
 * "Usuarios" in Settings. What it offers follows the same pure rules the
 * Server Actions enforce (domain/rules.ts): the actions are the real gate.
 */
export function UsersPanel({ actor, users, distributors }: { actor: Actor; users: UserRow[]; distributors: DistributorOption[] }) {
  const roles = assignableRoles(actor.role);
  return (
    <div className="space-y-5">
      <NewUserForm roles={roles} distributors={distributors} />
      <Table>
        <thead><tr><Th>Email</Th><Th>Rol</Th><Th>Distribuidor</Th><Th>Estado</Th><Th>Gestión</Th></tr></thead>
        <tbody>
          {users.map((u) => {
            const manageable = checkCanManage(actor, { id: u.id, role: u.role }).ok;
            return (
              <tr key={u.id}>
                <Td>
                  {u.email ?? "—"}
                  {u.id === actor.id && <span className="ml-2 text-xs text-slate-500">(tú)</span>}
                </Td>
                <Td>{u.role ? <Badge tone={u.role === "owner" ? "mint" : "slate"}>{ROLE_LABELS[u.role]}</Badge> : <span className="text-slate-500">Sin acceso</span>}</Td>
                <Td className="text-slate-400">{u.distributor?.name ?? "—"}</Td>
                <Td>
                  {u.role === null ? <span className="text-slate-600">—</span> : u.active ? <span className="text-xs text-mint-400">Activo</span> : <span className="text-xs text-yellow-300">Desactivado</span>}
                </Td>
                <Td className="whitespace-normal">
                  {manageable ? <UserRowEditor key={`${u.role}-${u.distributor?.id}-${u.active}`} user={u} roles={roles} distributors={distributors} /> : <span className="text-xs text-slate-600">—</span>}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
