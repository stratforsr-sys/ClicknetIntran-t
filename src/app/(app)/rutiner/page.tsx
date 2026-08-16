import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { agarnamn } from "@/lib/rutiner-data";
import {
  DOC_TYPE_LABEL,
  STATUS_LABEL,
  granskningslage,
  kategoridelar,
  type DocType,
} from "@/lib/dokument";

export const dynamic = "force-dynamic";

type Sok = { q?: string; kategori?: string; typ?: string; status?: string };

export default async function Rutiner({ searchParams }: { searchParams: Promise<Sok> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const supabase = await supabaseServer();
  const farRedigera = hasRole(user, "sales_manager", "admin");
  const farSkapa = hasRole(user, "sales_manager", "admin", "ceo", "team_lead");

  // AC-5.7: fritextsok over rubrik, kategori och brodtext. RLS avgor urvalet —
  // ett dokument utanfor din malgrupp finns inte i resultatet.
  let fraga = supabase
    .from("document")
    .select("id, title, slug, category_path, doc_type, status, review_due, requires_ack, version, owner_id")
    .order("category_path")
    .order("title");

  if (sp.q?.trim()) fraga = fraga.textSearch("search", sp.q.trim(), { type: "websearch", config: "swedish" });
  if (sp.kategori) fraga = fraga.like("category_path", `${sp.kategori}%`);
  if (sp.typ) fraga = fraga.eq("doc_type", sp.typ);
  if (sp.status) fraga = fraga.eq("status", sp.status);
  else fraga = fraga.neq("status", "archived");

  const { data: dokument } = await fraga;
  const lista = dokument ?? [];

  const [namnPer, { data: minaKvittenser }] = await Promise.all([
    agarnamn(lista.map((d) => d.owner_id)),
    user?.employee
      ? supabase.from("document_ack").select("document_id, version").eq("employee_id", user.employee.id)
      : Promise.resolve({ data: [] as { document_id: string; version: number }[] }),
  ]);
  const kvitterat = new Set((minaKvittenser ?? []).map((k) => `${k.document_id}:${k.version}`));

  // Mappträd byggt ur de kategorier som faktiskt finns, inte ur en fast lista.
  const kategorier = [...new Set(lista.map((d) => kategoridelar(d.category_path)[0]).filter(Boolean))].sort();

  const forfallna = lista.filter((d) => granskningslage(d.review_due).lage === "forfallen").length;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Rutiner</h1>
          <p className="mt-1 text-body text-ink-500">
            {lista.length} dokument
            {forfallna > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-danger-ink">
                  {forfallna} med förfallen granskning
                </span>
              </>
            )}
          </p>
        </div>
        {farSkapa && <ButtonLink href="/rutiner/ny" variant="primar">Nytt dokument</ButtonLink>}
      </div>

      <Card>
        <form className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-sm border-b border-ink-300/60 px-2 py-2 focus-within:border-transparent focus-within:bg-surface-alt focus-within:px-4 focus-within:shadow-elev-1 focus-within:ring-2 focus-within:ring-brand-600">
            <Ikon namn="sok" className="size-5 shrink-0 text-ink-500" />
            <input
              type="search"
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Sök i rutiner"
              aria-label="Sök i rutiner"
              className="min-w-0 flex-1 bg-transparent text-body text-ink-900 placeholder:text-ink-300 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Chip href={lank(sp, {})} aktiv={!sp.kategori && !sp.typ && !sp.status}>Alla</Chip>
            {kategorier.map((k) => (
              <Chip key={k} href={lank(sp, { kategori: k })} aktiv={sp.kategori === k}>
                {k}
              </Chip>
            ))}
            {farRedigera && (
              <Chip href={lank(sp, { status: "draft" })} aktiv={sp.status === "draft"}>
                Utkast
              </Chip>
            )}
          </div>
        </form>
      </Card>

      {lista.length === 0 ? (
        <Card>
          <EmptyState
            rubrik={sp.q ? "Inga träffar" : "Inga rutiner än"}
            text={
              sp.q
                ? `Sökningen på "${sp.q}" gav ingenting. Prova ett annat ord, eller skapa dokumentet om det saknas.`
                : "Här samlas allt en säljare behöver kunna slå upp mitt i ett samtal. Börja med det som frågas mest."
            }
            handling={
              farSkapa ? <ButtonLink href="/rutiner/ny" variant="primar">Nytt dokument</ButtonLink> : undefined
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {lista.map((d) => {
            const g = granskningslage(d.review_due);
            const behoverKvittens = d.requires_ack && !kvitterat.has(`${d.id}:${d.version}`);
            return (
              <li key={d.id}>
                <Link href={`/rutiner/${d.slug}`} className="block">
                  <Card
                    klickbart
                    status={g.lage === "forfallen" ? "danger" : behoverKvittens ? "warn" : undefined}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1">
                        {d.category_path && (
                          <p className="text-micro uppercase text-ink-500">{d.category_path}</p>
                        )}
                        <h2 className="mt-1 text-h2 text-ink-900">{d.title}</h2>
                        <p className="mt-1 text-small text-ink-500">
                          {DOC_TYPE_LABEL[d.doc_type as DocType]} · Ägare{" "}
                          {namnPer.get(d.owner_id) ?? "okänd"} · Version {d.version}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {d.status !== "published" && (
                          <Badge ton="neutral">{STATUS_LABEL[d.status]}</Badge>
                        )}
                        {behoverKvittens && <Badge ton="warn">Kvittens saknas</Badge>}
                        <Badge ton={g.lage === "forfallen" ? "danger" : g.lage === "snart" ? "warn" : "ok"}>
                          {g.text}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Byter ett filter men behaller soktexten. */
function lank(sp: Sok, andring: Partial<Sok>): string {
  const p = new URLSearchParams();
  if (sp.q) p.set("q", sp.q);
  for (const [k, v] of Object.entries(andring)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/rutiner?${s}` : "/rutiner";
}

function Chip({ href, aktiv, children }: { href: string; aktiv: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-9 items-center rounded-full px-4 text-small font-semibold transition-colors duration-fast ${
        aktiv ? "bg-brand-100 text-brand-ink" : "bg-canvas text-ink-500 hover:text-ink-900"
      }`}
    >
      {children}
    </Link>
  );
}
