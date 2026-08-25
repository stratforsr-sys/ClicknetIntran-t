import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notis } from "@/components/ui/Notis";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { hamtaKriterier, hamtaPolicyer, hamtaSamtal, hamtaSamtalet } from "@/lib/kv-server";
import { gallandePolicy, konfigurationsfel, manadForVecka, veckonummer, veckostart } from "@/lib/kv";
import { Bedomning } from "./Bedomning";

export const dynamic = "force-dynamic";

/**
 * Ett samtal, med sin bedomning.
 *
 * RLS AVGOR OM SIDAN FINNS. `hamtaSamtalet` laser med anvandarens egen token, sa
 * en saljare som gissar ett id far null och darmed 404 — inte ett tomt formular
 * eller ett felmeddelande som avslojar att samtalet finns.
 *
 * SALJAREN SER SIN EGEN BEDOMNING, inklusive fritexten (fraga 38). Hen far
 * daremot inte formularet.
 */
export default async function Samtalssida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const samtalet = await hamtaSamtalet(id);
  if (!samtalet) notFound();

  const bedomare = hasRole(user, "sales_manager", "ceo");
  const manad = manadForVecka(samtalet.call_date);

  const [kriterier, policyer, alla] = await Promise.all([
    hamtaKriterier(),
    hamtaPolicyer(),
    hamtaSamtal(veckostart(samtalet.call_date)),
  ]);

  const policy = gallandePolicy(policyer, manad);
  const fel = policy ? konfigurationsfel(kriterier, policy) : "Inga K&V-regler gäller för den månaden.";

  // Veckans OVRIGA samtal for samma person. Troskeln galler summan av dem alla,
  // sa formularet maste veta vad de andra gav for att kunna saga nagot vettigt.
  const veckansAndra = alla.filter(
    (s) =>
      s.employee_id === samtalet.employee_id &&
      s.id !== samtalet.id &&
      veckostart(s.call_date) === veckostart(samtalet.call_date),
  );

  const andraBedomda = veckansAndra.filter((s) => s.poang !== null);
  const andraSamtalet =
    andraBedomda.length === veckansAndra.length && veckansAndra.length > 0
      ? andraBedomda.reduce((s, x) => s + (x.poang ?? 0), 0)
      : null;

  const summa = samtalet.poang;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <Link href="/kv" className="text-small text-ink-500 underline">
          Tillbaka till K&amp;V
        </Link>
        <h1 className="mt-1 text-display text-ink-900">{samtalet.customer}</h1>
        <p className="mt-1 text-body text-ink-500">
          {samtalet.call_date} · vecka {veckonummer(samtalet.call_date)}
          {samtalet.source === "dialer" && " · hämtat från dialern"}
        </p>
      </div>

      {fel && (
        <Notis ton="warn">
          {fel}{" "}
          {bedomare && (
            <Link href="/kv/regler" className="underline">
              Gå till inställningarna
            </Link>
          )}
        </Notis>
      )}

      <Card status={summa === null ? "warn" : "brand"}>
        <CardHeader
          titel="Bedömningen"
          beskrivning={
            samtalet.bedomd_nar
              ? `Bedömd ${samtalet.bedomd_nar.slice(0, 10)}.`
              : "Samtalet är inte bedömt än."
          }
        />
        {summa === null ? (
          <Badge ton="neutral">Ej bedömd</Badge>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <p className="tnum text-h1 text-ink-900">{summa} poäng</p>
              <p className="text-small text-ink-500">på det här samtalet</p>
            </div>
            {policy && andraSamtalet !== null && (
              <div>
                <p className="tnum text-h1 text-ink-900">{summa + andraSamtalet}</p>
                <p className="text-small text-ink-500">
                  veckan, av {policy.threshold_points} som krävs
                </p>
              </div>
            )}
          </div>
        )}

        {summa !== null && (
          <ul className="mt-4 flex flex-col">
            {kriterier
              .filter((k) => samtalet.omraden.some((o) => o.criterion_id === k.id))
              .map((k) => {
                const o = samtalet.omraden.find((x) => x.criterion_id === k.id)!;
                return (
                  <li key={k.id} className="border-b border-canvas py-2 last:border-0">
                    <div className="flex items-baseline gap-4">
                      <span className="flex-1 text-body text-ink-900">{k.label}</span>
                      <span className="tnum text-body font-semibold text-ink-900">
                        {o.points}
                        {k.max_points !== null && (
                          <span className="text-small font-normal text-ink-500"> / {k.max_points}</span>
                        )}
                      </span>
                    </div>
                    {o.note && <p className="mt-1 text-small text-ink-700">{o.note}</p>}
                  </li>
                );
              })}
          </ul>
        )}

        {samtalet.kommentar && (
          <p className="mt-4 whitespace-pre-wrap text-body text-ink-700">{samtalet.kommentar}</p>
        )}
      </Card>

      {bedomare && policy && !fel && (
        <Card>
          <CardHeader
            titel={summa === null ? "Bedöm samtalet" : "Ändra bedömningen"}
            beskrivning={
              summa === null
                ? "Sex områden. Tröskeln gäller summan av veckans samtal."
                : "En bedömning får ändras i efterhand. Ändringen loggas."
            }
          />
          <Bedomning
            callId={samtalet.id}
            kriterier={kriterier}
            befintliga={samtalet.omraden}
            kommentar={samtalet.kommentar}
            troskel={policy.threshold_points}
            andraSamtalet={andraSamtalet}
          />
        </Card>
      )}
    </div>
  );
}
