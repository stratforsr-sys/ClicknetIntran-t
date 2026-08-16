import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, canManageEmployees, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import {
  M2_AKTIV,
  RAST_AKTIV,
  TYP_ETIKETT,
  arbetadeMinuter,
  dygnetsStart,
  gallande,
  klockan,
  lageNu,
  tillatna,
  timmarOchMinuter,
  type Handelse,
} from "@/lib/tid";
import { Stamplar } from "./Stamplar";
import { Rattelse } from "./Rattelse";
import { beslutaRattelse } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tid — Clicknet Nav" };

export default async function TidSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const chef = canManageEmployees(user);

  const { data: mina } = await supabase
    .from("time_event")
    .select("id, kind, occurred_at, source, supersedes_id, correction_state, note")
    .eq("employee_id", user.employee.id)
    .gte("occurred_at", dygnetsStart())
    .order("occurred_at");

  const handelser: Handelse[] = mina ?? [];
  const lage = lageNu(handelser);
  const giltiga = gallande(handelser);
  const minuter = arbetadeMinuter(handelser);

  // AC-2.8: namn och in-tid. Aldrig rastlangd — darfor hamtas bara 'in' och
  // 'out', och rasterna lamnas utanfor fragan helt.
  let paPlats: { namn: string; sedan: string }[] = [];
  if (chef && M2_AKTIV) {
    const [{ data: personal }, { data: idag }] = await Promise.all([
      supabase.from("employee").select("id, first_name, last_name").neq("status", "offboarded"),
      supabase
        .from("time_event")
        .select("employee_id, kind, occurred_at, correction_state, supersedes_id, id, source")
        .gte("occurred_at", dygnetsStart())
        .in("kind", ["in", "out"])
        .order("occurred_at"),
    ]);

    const perPerson = new Map<string, Handelse[]>();
    for (const h of idag ?? []) {
      perPerson.set(h.employee_id, [...(perPerson.get(h.employee_id) ?? []), h]);
    }

    paPlats = (personal ?? [])
      .map((p) => {
        const egna = gallande(perPerson.get(p.id) ?? []);
        const senaste = egna[egna.length - 1];
        return senaste?.kind === "in"
          ? { namn: fullName(p), sedan: klockan(senaste.occurred_at) }
          : null;
      })
      .filter((x): x is { namn: string; sedan: string } => x !== null)
      .sort((a, b) => a.sedan.localeCompare(b.sedan));
  }

  // AC-2.5: chefens kö. Bara det som väntar på beslut.
  const { data: vantande } = chef
    ? await supabase
        .from("time_event")
        .select("id, employee_id, kind, occurred_at, note, supersedes_id")
        .eq("correction_state", "pending")
        .order("occurred_at")
    : { data: null };

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Tid</h1>
          <p className="mt-1 text-body text-ink-500">
            {M2_AKTIV
              ? `${timmarOchMinuter(minuter)} registrerat idag.`
              : "Stämplingen är byggd men inte påslagen."}
          </p>
        </div>
        {M2_AKTIV && <Badge ton={lage === "inne" ? "ok" : lage === "rast" ? "warn" : "neutral"}>
          {lage === "inne" ? "Instämplad" : lage === "rast" ? "På rast" : "Utstämplad"}
        </Badge>}
      </div>

      {!M2_AKTIV && (
        <Notis ton="warn">
          Modulen väntar på K12: intresseavvägningen för raststämpling ska vara skriven och
          daterad innan den första stämplingen sker. Se <code>docs/DRIFTSATTNING.md</code>.
        </Notis>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              titel="Stämpla"
              beskrivning={
                RAST_AKTIV
                  ? "In, ut och rast. Tiden sätts när du trycker."
                  : "In och ut. Tiden sätts när du trycker."
              }
            />
            {M2_AKTIV ? (
              <Stamplar lage={lage} tillatna={tillatna(lage)} />
            ) : (
              <p className="text-small text-ink-500">
                Knapparna visas när modulen slås på.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader
              titel="Idag"
              beskrivning="Ingen rad kan ändras eller tas bort. En rättelse blir en ny rad."
            />
            {giltiga.length === 0 ? (
              <p className="text-small text-ink-500">Inga stämplingar idag.</p>
            ) : (
              <ul className="flex flex-col">
                {giltiga.map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-wrap items-center gap-3 border-b border-canvas py-3 last:border-0"
                  >
                    <span className="tnum w-14 text-body font-semibold text-ink-900">
                      {klockan(h.occurred_at)}
                    </span>
                    <span className="flex-1 text-body text-ink-700">{TYP_ETIKETT[h.kind]}</span>
                    {h.source === "offline_queue" && <Badge ton="info">Utan nät</Badge>}
                    {h.source === "correction" && <Badge ton="warn">Rättad</Badge>}
                    {h.source === "system_auto_close" && <Badge ton="warn">Stängd av navet</Badge>}
                    {M2_AKTIV && <Rattelse handelse={h} />}
                  </li>
                ))}
              </ul>
            )}

            {handelser.some((h) => h.correction_state === "pending") && (
              <p className="mt-4 text-small text-ink-500">
                En rättelse väntar på din chef. Den ursprungliga tiden gäller tills den är
                beslutad.
              </p>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {chef && (
            <Card className="h-fit">
              <CardHeader titel="På plats nu" beskrivning="Namn och in-tid. Inget mer." />
              {!M2_AKTIV ? (
                <p className="text-small text-ink-500">Visas när modulen slås på.</p>
              ) : paPlats.length === 0 ? (
                <p className="text-small text-ink-500">Ingen är instämplad.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {paPlats.map((p) => (
                    <li key={p.namn} className="flex items-center justify-between gap-3">
                      <span className="text-body text-ink-900">{p.namn}</span>
                      <span className="tnum text-small text-ink-500">sedan {p.sedan}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {chef && (vantande ?? []).length > 0 && (
            <Card className="h-fit" status="warn">
              <CardHeader titel="Rättelser att besluta" />
              <ul className="flex flex-col gap-4">
                {(vantande ?? []).map((r) => (
                  <li key={r.id} className="flex flex-col gap-2">
                    <p className="text-body text-ink-900">
                      {TYP_ETIKETT[r.kind as keyof typeof TYP_ETIKETT]} →{" "}
                      <span className="tnum">{klockan(r.occurred_at)}</span>
                    </p>
                    {r.note && <p className="text-small text-ink-500">{r.note}</p>}
                    <div className="flex flex-wrap gap-2">
                      <form action={beslutaRattelse}>
                        <input type="hidden" name="rattelse_id" value={r.id} />
                        <input type="hidden" name="beslut" value="godkann" />
                        <Button type="submit" size="sm">
                          Godkänn
                        </Button>
                      </form>
                      <form action={beslutaRattelse}>
                        <input type="hidden" name="rattelse_id" value={r.id} />
                        <input type="hidden" name="beslut" value="avsla" />
                        <Button type="submit" size="sm" variant="diskret">
                          Avslå
                        </Button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="h-fit">
            <CardHeader titel="Om tiden" />
            <ul className="flex flex-col gap-2 text-small text-ink-500">
              <li>Ingen stämpling kan raderas eller skrivas över. Databasen vägrar.</li>
              <li>En rättelse blir en ny rad. Båda syns i historiken.</li>
              <li>Ingen platsdata samlas in — varken GPS, wifi eller IP-position.</li>
            </ul>
          </Card>
        </div>
      </div>

      {M2_AKTIV && giltiga.length === 0 && lage === "ute" && (
        <EmptyState
          rubrik="Dagen har inte börjat"
          text="Stämpla in när du sätter dig. Ett tryck räcker."
        />
      )}
    </div>
  );
}
