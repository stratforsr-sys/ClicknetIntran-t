import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Markdown } from "@/components/Markdown";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import {
  BEVIS_ETIKETT,
  KVITTERARE_ETIKETT,
  LAGE_ETIKETT,
  LAGE_TON,
  TYP_ETIKETT,
  arSjalvsann,
  farAvbryta,
  farKvittera,
} from "@/lib/coachning";
import { arChefFor, namnkarta, uppgift as hamtaUppgift } from "@/lib/coachning-server";
import { Handlingar } from "./Handlingar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coachningsuppgift — Clicknet Nav" };

const HANDELSE_ORD: Record<string, string> = {
  tilldelad: "Upplagd av",
  paborjad: "Påbörjad av",
  inlamnad: "Inlämnad av",
  kvitterad: "Kvitterad av",
  underkand: "Underkänd av",
  avbruten: "Avbruten av",
};

/**
 * En enskild uppgift.
 *
 * RUBRIKEN OCH KRAVEN SYNS FORE, INTE EFTER. Vad som kravs, vem som kvitterar
 * och vad som ska bevisas star pa sidan innan nagot gors — samma linje som 0024
 * drog for rollspelsrubriken. En bedomning mot krav man far se i efterhand ar
 * inte en bedomning, det ar ett omdome.
 */
export default async function UppgiftSida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  // RLS avgor. Slapper den inte igenom raden finns uppgiften inte for den har
  // personen, och det ar samma svar som att den inte finns.
  const u = await hamtaUppgift(id);
  if (!u) notFound();

  const arChef = await arChefFor(user, u.assignee_id);
  const jag = user.employee.id;
  const egen = jag === u.assignee_id;

  const namn = await namnkarta([u.assignee_id, u.created_by, u.partner_id ?? "", ...u.handelser.map(() => "")]);

  const supabase = await supabaseServer();
  const { data: handelser } = await supabase
    .from("coaching_task_event")
    .select("id, type, at, note, by_employee_id")
    .eq("task_id", id)
    .order("at", { ascending: false });

  const aktorer = await namnkarta((handelser ?? []).map((h) => h.by_employee_id));

  const kanKvittera = farKvittera(u, jag, arChef);
  const kanAvbryta = farAvbryta(u, jag, arChef);
  /**
   * CHEFEN FAR OCKSA MARKERA PABORJAD, sedan 2026-09-02.
   *
   * Ett live-rollspel eller en medlyssning HANDER hos chefen, inte i navet. Att
   * bara ansvarig kunde trycka betydde att uppgiften stod kvar som "Ej
   * påbörjad" tills saljaren rakade oppna navet och bekrafta nagot som redan
   * skett — och kon blev en bild av vem som klickat, inte av vad som gjorts.
   *
   * Gransen mot kvitteringen ar oforandrad: chefen far anteckna att arbetet
   * BORJAT, aldrig pasta at nagon annan att det ar GJORT. `farKvittera()`
   * haller ute chefen pa `verify_by = 'sjalv'` precis som forut.
   */
  const kanPaborja =
    (egen || arChef) && !u.cancelled_at && u.lage === "ej_paborjad" && !arSjalvsann(u.kind);
  const kanLamnaIn = egen && !u.cancelled_at && u.verify_by !== "sjalv" && !arSjalvsann(u.kind)
    && (u.lage === "pagar" || u.lage === "ej_paborjad" || u.lage === "underkand");

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href={`/coachning/${u.assignee_id}`}
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        {egen ? "Tillbaka till min coachning" : `Tillbaka till ${namn.get(u.assignee_id) ?? "kortet"}`}
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-display text-ink-900">{u.title}</h1>
        <Badge ton={LAGE_TON[u.lage]}>{LAGE_ETIKETT[u.lage]}</Badge>
        {u.forsenad && <Badge ton="danger">Försenad</Badge>}
      </div>

      <Card>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Rad rubrik="Typ" varde={TYP_ETIKETT[u.kind]} />
          <Rad rubrik="Gäller" varde={namn.get(u.assignee_id) ?? "—"} />
          <Rad rubrik="Motpart" varde={u.partner_id ? (namn.get(u.partner_id) ?? "—") : "På egen hand"} />
          <Rad rubrik="Upplagd av" varde={namn.get(u.created_by) ?? "—"} />
          <Rad
            rubrik="Kvitteras av"
            varde={
              arSjalvsann(u.kind)
                ? "Ingen — läget hämtas ur certifikatet, bedömningen eller kvittensen"
                : KVITTERARE_ETIKETT[u.verify_by]
            }
          />
          <Rad rubrik="Kräver" varde={BEVIS_ETIKETT[u.evidence]} />
          {u.due_date && <Rad rubrik="Klar senast" varde={u.due_date} />}
          {u.fokus.length > 0 && <Rad rubrik="Tränar på" varde={u.fokus.join(", ")} />}
        </dl>

        {u.description_md && (
          <div className="mt-4 border-t border-canvas pt-4">
            <Markdown text={u.description_md} />
          </div>
        )}
      </Card>

      {(kanKvittera || kanAvbryta || kanPaborja || kanLamnaIn) && (
        <Card>
          <CardHeader titel="Vad du kan göra" />
          <Handlingar
            taskId={u.id}
            kanPaborja={kanPaborja}
            egenUppgift={egen}
            kanLamnaIn={kanLamnaIn}
            kanKvittera={kanKvittera}
            kanAvbryta={kanAvbryta}
            kraverKommentar={u.evidence === "kommentar"}
          />
        </Card>
      )}

      <Card>
        <CardHeader titel="Historik" beskrivning="Ingenting skrivs över. Varje steg ligger kvar." />
        <ol className="flex flex-col gap-3">
          {(handelser ?? []).map((h) => (
            <li key={h.id} className="rounded-sm bg-canvas px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-small font-semibold text-ink-900">
                  {HANDELSE_ORD[h.type] ?? h.type} {aktorer.get(h.by_employee_id) ?? "—"}
                </span>
                <span className="tnum text-small text-ink-500">{h.at.slice(0, 16).replace("T", " ")}</span>
              </div>
              {h.note && <p className="mt-1 text-small text-ink-700">{h.note}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function Rad({ rubrik, varde }: { rubrik: string; varde: string }) {
  return (
    <div>
      <dt className="text-micro uppercase text-ink-500">{rubrik}</dt>
      <dd className="text-body text-ink-900">{varde}</dd>
    </div>
  );
}
