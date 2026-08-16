import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { DOC_TYPE_LABEL, STATUS_LABEL, granskningslage, type DocType } from "@/lib/dokument";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { kvittera, markeraGranskad, registreraVisning } from "../actions";

export const dynamic = "force-dynamic";

export default async function Rutindokument({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const supabase = await supabaseServer();

  const { data: d } = await supabase
    .from("document")
    .select(
      `id, title, slug, category_path, body_md, doc_type, status, review_due,
       requires_ack, version, owner_id, audience_roles, published_at, updated_at`,
    )
    .eq("slug", slug)
    .maybeSingle();

  // AC-5.8: ej behorig far 404, inte "atkomst nekad". Ett nekande avslojar
  // att dokumentet finns, och rubriken pa ett HR-dokument kan i sig vara
  // kanslig information.
  if (!d) notFound();

  const [{ data: agare }, { data: minKvittens }, { data: versioner }] = await Promise.all([
    supabase.from("employee").select("id, first_name, last_name").eq("id", d.owner_id).maybeSingle(),
    user?.employee
      ? supabase
          .from("document_ack")
          .select("acked_at, version")
          .eq("document_id", d.id)
          .eq("employee_id", user.employee.id)
          .eq("version", d.version)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("document_version")
      .select("version, changed_at, change_note, changed_by")
      .eq("document_id", d.id)
      .order("version", { ascending: false })
      .limit(6),
  ]);

  if (user?.employee) await registreraVisning(d.id, user.employee.id);

  const g = granskningslage(d.review_due);
  const arAgare = user?.employee?.id === d.owner_id;
  const farRedigera = hasRole(user, "sales_manager", "admin") || arAgare;
  const behoverKvittens = d.requires_ack && d.status === "published" && !minKvittens;

  return (
    <div className="flex flex-col gap-4 pb-24 pt-2">
      <Link
        href="/rutiner"
        className="inline-flex min-h-11 items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till rutiner
      </Link>

      {g.lage === "forfallen" && (
        <Notis ton="danger">
          {g.text}. Innehållet kan vara inaktuellt — kontrollera med{" "}
          {agare ? fullName(agare) : "ägaren"} innan du agerar på det.
        </Notis>
      )}
      {d.status === "draft" && (
        <Notis ton="warn">Utkast. Dokumentet är inte publicerat och syns bara för dig och ledningen.</Notis>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            {d.category_path && (
              <p className="text-micro uppercase text-ink-500">{d.category_path}</p>
            )}
            <h1 className="mt-1 text-display text-ink-900">{d.title}</h1>

            {/* AC-5.10 och AC-U3.3: radlangd max 70 tecken i lopande text. */}
            <article className="prosa mt-6 max-w-[70ch]">
              {d.body_md.trim() ? (
                <Markdown text={d.body_md} />
              ) : (
                <p className="text-ink-500">Dokumentet har inget innehåll än.</p>
              )}
            </article>
          </Card>

          {(versioner?.length ?? 0) > 1 && (
            <Card>
              <h2 className="text-h2 text-ink-900">Versionshistorik</h2>
              <ul className="mt-3 flex flex-col">
                {(versioner ?? []).map((v) => (
                  <li key={v.version} className="flex flex-wrap items-baseline gap-x-3 border-b border-canvas py-2.5 last:border-0">
                    <span className="tnum text-small font-semibold text-ink-900">v{v.version}</span>
                    <time className="tnum text-small text-ink-500">
                      {new Date(v.changed_at).toLocaleDateString("sv-SE")}
                    </time>
                    <span className="flex-1 text-small text-ink-700">
                      {v.change_note ?? "Ingen ändringsnot"}
                    </span>
                    {v.version === d.version && <Badge ton="brand">Gällande</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card status={g.lage === "forfallen" ? "danger" : g.lage === "snart" ? "warn" : undefined}>
            <h2 className="text-h2 text-ink-900">Om dokumentet</h2>
            <dl className="mt-4 flex flex-col gap-3">
              <Rad etikett="Typ" varde={DOC_TYPE_LABEL[d.doc_type as DocType]} />
              <Rad etikett="Ägare" varde={agare ? fullName(agare) : "Okänd"} />
              <Rad etikett="Version" varde={`${d.version}`} tnum />
              <Rad etikett="Status" varde={STATUS_LABEL[d.status]} />
              <Rad etikett="Granskning" varde={g.text} />
              {(d.audience_roles?.length ?? 0) > 0 && (
                <Rad
                  etikett="Målgrupp"
                  varde={(d.audience_roles as Role[]).map((r) => ROLE_LABEL[r]).join(", ")}
                />
              )}
            </dl>

            {farRedigera && (
              <div className="mt-5 flex flex-col gap-2">
                <ButtonLink href={`/rutiner/${d.slug}/redigera`} size="sm">Redigera</ButtonLink>
                {d.requires_ack && (
                  <ButtonLink href={`/rutiner/${d.slug}/kvittenser`} variant="diskret" size="sm">
                    Se kvittenser
                  </ButtonLink>
                )}
                <form action={markeraGranskad}>
                  <input type="hidden" name="document_id" value={d.id} />
                  <input type="hidden" name="slug" value={d.slug} />
                  <input type="hidden" name="manader" value="12" />
                  <Button type="submit" variant="diskret" size="sm" className="w-full">
                    Markera som granskad idag
                  </Button>
                </form>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* AC-5.5: kvittensknappen fastnar nederst tills den tryckts. */}
      {behoverKvittens && (
        <div className="fixed inset-x-4 bottom-4 z-20 lg:left-[18.5rem] lg:right-8">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 rounded-md bg-surface p-4 shadow-elev-3">
            <p className="text-body text-ink-700">
              Den här rutinen kräver att du kvitterar att du läst den.
            </p>
            <form action={kvittera}>
              <input type="hidden" name="document_id" value={d.id} />
              <input type="hidden" name="slug" value={d.slug} />
              <Button type="submit">Kvittera</Button>
            </form>
          </div>
        </div>
      )}

      {d.requires_ack && minKvittens && (
        <Notis ton="ok">
          Kvitterad {new Date(minKvittens.acked_at).toLocaleDateString("sv-SE")} för version{" "}
          {d.version}. Kommer en ny version behöver du kvittera igen.
        </Notis>
      )}
    </div>
  );
}

function Rad({ etikett, varde, tnum }: { etikett: string; varde: string; tnum?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-micro uppercase text-ink-500">{etikett}</dt>
      <dd className={`text-right text-small text-ink-900 ${tnum ? "tnum" : ""}`}>{varde}</dd>
    </div>
  );
}
