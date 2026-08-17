import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { EmptyState } from "@/components/ui/EmptyState";
import { avslutaAvvikelse } from "../lonerapport/actions";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, canManageEmployees, hasRole, fullName } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { RAST_AKTIV } from "@/lib/tid";
import { AVVIKELSE_ETIKETT, AVVIKELSE_FORKLARING, type Avvikelsetyp } from "@/lib/raster";

export const dynamic = "force-dynamic";
export const metadata = { title: "Avvikelser — Clicknet Nav" };

const TON: Record<Avvikelsetyp, "warn" | "danger" | "info"> = {
  early_start: "info",
  overrun: "warn",
  missing: "danger",
  unscheduled: "info",
};

/**
 * AC-2.10, K16: chefen ser AVVIKELSER, inte ett flöde av stämplingar. Sidan
 * hämtar därför bara `break_deviation` — den rör aldrig `time_event`, så det
 * finns ingen väg härifrån till "när gick hon på toaletten".
 *
 * AC-2.12, AC-2.32, K19: varje öppning loggas. Den som tittar syns.
 */
export default async function AvvikelseSida() {
  const user = await getCurrentUser();
  if (!canManageEmployees(user) && !hasRole(user, "team_lead")) redirect("/tid");
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();

  const [{ data: avvikelser }, { data: personal }] = await Promise.all([
    supabase
      .from("break_deviation")
      .select("id, employee_id, work_date, kind, minutes, employee_comment, detected_at, resolved_at, resolution")
      .order("work_date", { ascending: false })
      .limit(200),
    supabase.from("employee").select("id, first_name, last_name"),
  ]);

  const namn = new Map((personal ?? []).map((p) => [p.id, fullName(p)]));
  const lista = avvikelser ?? [];

  // Loggas efter lasningen, sa att en misslyckad lasning inte bokfors som en
  // oppning. Ingen rad = ingen insyn skedde.
  await supabaseAdmin().from("audit_log").insert({
    actor_id: user.employee.id,
    action: "deviation.viewed",
    object_type: "break_deviation",
    object_id: "lista",
    meta: { antal: lista.length },
  });

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/tid"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till tid
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Avvikelser</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Rasterna som inte följde schemat. Den här sidan visar inga stämplingar och ingen
          rastlängd i övrigt — och varje gång den öppnas skrivs en rad i händelseloggen.
        </p>
      </div>

      <Notis ton="info">
        Utebliven rast är en arbetsmiljösignal. Följ upp den som en fråga om arbetsbelastning —
        avvikelser används inte som grund för varning, lönesättning eller uppsägning, och de når
        varken provision eller lönekostnadsvyn.
      </Notis>

      <Notis ton="info">
        Att avsluta en avvikelse är att kvittera att den är omhändertagen, ingenting annat. Ingen
        automatik hänger i knappen. Däremot går löneperioden inte att attestera så länge avvikelser
        står öppna — den som inte tittats på ska inte tyst följa med in i ett löneunderlag.
      </Notis>

      {!RAST_AKTIV && (
        <Notis ton="warn">
          Genereringen är avstängd tills K29 är uppfylld. Listan nedan är därför tom.
        </Notis>
      )}

      {lista.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Inga avvikelser"
            text="Ingen har avvikit från rastschemat under den period som finns kvar. Detaljer äldre än 90 dagar är gallrade."
          />
        </Card>
      ) : (
        <Card className="p-0 md:p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse">
              <thead>
                <tr className="border-b border-canvas">
                  {["Datum", "Person", "Vad", "Omfattning", "Kommentar", "Avslut"].map((h) => (
                    <th key={h} scope="col" className="px-6 py-3 text-left text-micro uppercase text-ink-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map((a) => (
                  <tr key={a.id} className="border-b border-canvas last:border-0">
                    <td className="tnum px-6 py-3 text-small text-ink-700">{a.work_date}</td>
                    <td className="px-6 py-3 text-small text-ink-900">
                      {namn.get(a.employee_id) ?? "Okänd"}
                    </td>
                    <td className="px-6 py-3">
                      <Badge ton={TON[a.kind as Avvikelsetyp]}>
                        {AVVIKELSE_ETIKETT[a.kind as Avvikelsetyp]}
                      </Badge>
                    </td>
                    <td className="tnum px-6 py-3 text-small text-ink-700">
                      {a.minutes > 0 ? `${a.minutes} min` : "—"}
                    </td>
                    <td className="px-6 py-3 text-small text-ink-500">
                      {a.employee_comment ?? "—"}
                    </td>
                    <td className="px-6 py-3">
                      {a.resolved_at ? (
                        <span className="text-small text-ink-500">
                          {a.resolution || "Avslutad"}
                        </span>
                      ) : (
                        <form action={avslutaAvvikelse} className="flex items-center gap-2">
                          <input type="hidden" name="avvikelse_id" value={a.id} />
                          <input
                            type="text"
                            name="anteckning"
                            placeholder="Anteckning (frivillig)"
                            className={`${KONTROLL} w-48`}
                          />
                          <Button type="submit" variant="sekundar" size="sm">
                            Avsluta
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader titel="Vad typerna betyder" />
        <dl className="flex flex-col gap-3">
          {(Object.keys(AVVIKELSE_ETIKETT) as Avvikelsetyp[]).map((k) => (
            <div key={k}>
              <dt className="text-small font-semibold text-ink-900">{AVVIKELSE_ETIKETT[k]}</dt>
              <dd className="text-small text-ink-500">{AVVIKELSE_FORKLARING[k]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
