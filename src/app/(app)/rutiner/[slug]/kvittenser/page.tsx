import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { ROLE_LABEL, type Role } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * AC-5.6. Rapporten svarar pa den fraga en arbetsmiljoansvarig faktiskt har:
 * vem har inte last. Darfor ligger de okvitterade overst — den listan ar
 * arbetsuppgiften, de kvitterade ar bara kvittot.
 */
export default async function Kvittenser({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect(`/logga-in?nasta=/rutiner/${slug}/kvittenser`);

  const db = supabaseAdmin();
  const { data: d } = await db
    .from("document")
    .select("id, slug, title, version, requires_ack, audience_roles, owner_id, status")
    .eq("slug", slug)
    .maybeSingle();
  if (!d) notFound();

  const farSe = hasRole(user, "sales_manager", "admin", "ceo") || d.owner_id === user.employee.id;
  if (!farSe) redirect(`/rutiner/${slug}`);

  const malroller = (d.audience_roles ?? []) as Role[];

  const [{ data: anstallda }, { data: roller }, { data: kvittenser }] = await Promise.all([
    db.from("employee").select("id, first_name, last_name, email").eq("status", "active").order("first_name"),
    db.from("employee_role").select("employee_id, role"),
    db.from("document_ack").select("employee_id, acked_at, version").eq("document_id", d.id),
  ]);

  const rollerPer = new Map<string, Role[]>();
  for (const r of roller ?? []) {
    const lista = rollerPer.get(r.employee_id) ?? [];
    lista.push(r.role as Role);
    rollerPer.set(r.employee_id, lista);
  }

  const imalgrupp = (anstallda ?? []).filter((a) => {
    if (malroller.length === 0) return true;
    return (rollerPer.get(a.id) ?? []).some((r) => malroller.includes(r));
  });

  // Kvittens pa en aldre version raknas inte som kvitterad — men den visas,
  // for skillnaden mellan "har aldrig last" och "last en tidigare version"
  // avgor hur paminnelsen bor formuleras.
  const kvittensPer = new Map(
    (kvittenser ?? []).map((k) => [k.employee_id, k] as const),
  );

  const rader = imalgrupp.map((a) => {
    const k = kvittensPer.get(a.id);
    return {
      ...a,
      lage: !k ? "aldrig" : k.version === d.version ? "aktuell" : "gammal",
      ackedAt: k?.acked_at ?? null,
      ackedVersion: k?.version ?? null,
      roller: rollerPer.get(a.id) ?? [],
    } as const;
  });

  const utestaende = rader.filter((r) => r.lage !== "aktuell");
  const klara = rader.filter((r) => r.lage === "aktuell");
  const andel = rader.length ? Math.round((klara.length / rader.length) * 100) : 100;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href={`/rutiner/${d.slug}`}
        className="inline-flex min-h-11 items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till dokumentet
      </Link>

      <div>
        <p className="text-micro uppercase text-ink-500">Kvittenser · version {d.version}</p>
        <h1 className="mt-1 text-display text-ink-900">{d.title}</h1>
      </div>

      {!d.requires_ack ? (
        <Card>
          <EmptyState
            rubrik="Dokumentet kräver ingen kvittens"
            text="Slå på kvittens i redigeringsvyn om alla i målgruppen ska bekräfta att de läst."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Nyckeltal etikett="Har kvitterat" varde={`${klara.length}`} av={`av ${rader.length}`} />
            <Nyckeltal etikett="Andel klara" varde={`${andel} %`} />
            <Nyckeltal
              etikett="Målgrupp"
              varde={malroller.length === 0 ? "Alla" : malroller.map((r) => ROLE_LABEL[r]).join(", ")}
              litet
            />
          </div>

          <Card status={utestaende.length ? "warn" : "ok"}>
            <h2 className="text-h2 text-ink-900">
              Saknas ({utestaende.length})
            </h2>
            {utestaende.length === 0 ? (
              <p className="mt-2 text-body text-ink-500">
                Alla i målgruppen har kvitterat den gällande versionen.
              </p>
            ) : (
              <Tabell rader={utestaende} version={d.version} />
            )}
          </Card>

          {klara.length > 0 && (
            <Card>
              <h2 className="text-h2 text-ink-900">Kvitterat ({klara.length})</h2>
              <Tabell rader={klara} version={d.version} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

type Rad = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  lage: "aldrig" | "aktuell" | "gammal";
  ackedAt: string | null;
  ackedVersion: number | null;
};

function Tabell({ rader, version }: { rader: readonly Rad[]; version: number }) {
  return (
    <table className="mt-3 w-full">
      <thead className="sr-only">
        <tr>
          <th>Namn</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rader.map((r) => (
          <tr key={r.id} className="border-b border-canvas last:border-0">
            <td className="py-3 pr-3">
              <span className="block text-body text-ink-900">{fullName(r)}</span>
              <span className="block text-small text-ink-500">{r.email}</span>
            </td>
            <td className="py-3 text-right">
              {r.lage === "aktuell" && (
                <span className="inline-flex flex-col items-end gap-1">
                  <Badge ton="ok">Kvitterad</Badge>
                  <time className="tnum text-small text-ink-500">
                    {new Date(r.ackedAt!).toLocaleDateString("sv-SE")}
                  </time>
                </span>
              )}
              {r.lage === "gammal" && (
                <span className="inline-flex flex-col items-end gap-1">
                  <Badge ton="warn">Läst v{r.ackedVersion}</Badge>
                  <span className="text-small text-ink-500">Ny version {version}</span>
                </span>
              )}
              {r.lage === "aldrig" && <Badge ton="danger">Ej kvitterad</Badge>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Nyckeltal({
  etikett,
  varde,
  av,
  litet,
}: {
  etikett: string;
  varde: string;
  av?: string;
  litet?: boolean;
}) {
  return (
    <Card>
      <p className="text-micro uppercase text-ink-500">{etikett}</p>
      <p className={litet ? "mt-2 text-body text-ink-900" : "tnum mt-2 text-display text-ink-900"}>
        {varde} {av && <span className="text-body text-ink-500">{av}</span>}
      </p>
    </Card>
  );
}
