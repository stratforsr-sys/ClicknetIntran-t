import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notis } from "@/components/ui/Notis";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { hamtaLage } from "@/lib/sparrar";
import { hamtaHandelser, hamtaRegler } from "@/lib/konsekvens-server";
import { ATGARD_ETIKETT, type Atgard, type Handelsestatus } from "@/lib/konsekvens";
import { forsening } from "@/lib/narvaro";
import { Beslut, Havning, Upplaggning } from "./Beslut";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ogiltig frånvaro — Clicknet Nav" };

const STATUSETIKETT: Record<Handelsestatus, string> = {
  foreslagen: "Förslag",
  godkand: "Godkänd",
  avvisad: "Avvisad",
  havd: "Hävd",
};

const STATUSTON: Record<Handelsestatus, "warn" | "danger" | "info" | "ok"> = {
  foreslagen: "warn",
  godkand: "danger",
  avvisad: "info",
  havd: "ok",
};

/**
 * E13 steg 6: chefens ko.
 *
 * ===========================================================================
 * SIDAN LIGGER UNDER /tid OCH INTE UNDER /franvaro, med flit.
 *
 * En ogiltig franvaro ar en EGEN HANDELSE och inte en franvaroansokan
 * (avsnitt 7.2). Lades den i ansokningsmodulen hade den arvt attestlogiken dar,
 * och "ogiltig franvaro" hade blivit nagot man kan ANSOKA om. Det ar ocksa
 * skalet till att `absence_type` inte rors: dess check-villkor ar en stangd
 * lista pa tio varden, och att oppna den hade gjort precis det.
 *
 * Den hor hemma under tid for att den kommer ur stamplingen — och for att K13
 * kraver att ingen FRAGA joinar tid och provision. Sidan laser
 * `attendance_incident` och ingenting ur huvudboken.
 * ===========================================================================
 */
export default async function OgiltigFranvaroSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const rls = await supabaseServer();

  // Behorigheten fragas till DATABASEN, inte till en kopia av regeln har.
  // `far_godkanna_franvaro()` i 0037 ar den enda definitionen, och samma
  // funktion star bakom RLS-policyn som avgor vilka rader som kommer tillbaka.
  const { data: farSe } = await rls.rpc("far_godkanna_franvaro");
  if (farSe !== true) redirect("/tid");

  const sparr = await hamtaLage();

  const [handelser, regler, { data: personal }] = await Promise.all([
    hamtaHandelser(),
    hamtaRegler(),
    rls.from("employee").select("id, first_name, last_name").neq("status", "offboarded"),
  ]);

  const namn = new Map((personal ?? []).map((p) => [p.id, fullName(p)]));
  const ko = handelser.filter((h) => h.status === "foreslagen");
  const beslutade = handelser.filter((h) => h.status !== "foreslagen");

  // K19: den som tittar syns. Loggas EFTER lasningen — en misslyckad lasning
  // ska inte bokforas som en oppning.
  await supabaseAdmin().from("audit_log").insert({
    actor_id: user.employee.id,
    action: "attendance_incident.viewed",
    object_type: "attendance_incident",
    object_id: "lista",
    meta: { i_ko: ko.length, beslutade: beslutade.length },
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
        <h1 className="text-display text-ink-900">Ogiltig frånvaro</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Dagar helt utan instämpling, föreslagna av navet. Ingenting registreras förrän du
          intygar att personen faktiskt inte var på plats. Varje öppning av den här sidan
          skrivs i händelseloggen.
        </p>
      </div>

      <Notis ton="info">
        <strong>Sen ankomst räknas aldrig här.</strong> Den som stämplat in — hur sent som
        helst — blir aldrig ett förslag. Detsamma gäller tidig hemgång och glapp mitt på
        dagen. Navet kan inte se skillnad på &quot;kom inte&quot; och &quot;var här men glömde
        stämpla&quot;, och därför är varje rad nedan en fråga till dig och inte ett besked.
      </Notis>

      {!sparr.stampling && (
        <Notis ton="warn">
          Stämplingen är avstängd, så inga nya förslag genereras. Utan instämpling saknar alla
          instämpling varje dag, och listan hade blivit lika lång som personalen gånger
          arbetsdagarna.
        </Notis>
      )}

      {regler.length === 0 && (
        <Notis ton="danger">
          Konsekvenstrappan är tom. Ingen händelse går att godkänna förrän den är ifylld under
          Provision → Regler.
        </Notis>
      )}

      <Card>
        <CardHeader
          titel={`Väntar på beslut (${ko.length})`}
          beskrivning="Ett förslag syns inte för den det gäller och räknas inte i trappan."
        />
        {ko.length === 0 ? (
          <EmptyState
            rubrik="Inget väntar"
            text="Ingen har en dag helt utan instämpling som saknar beslut."
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {ko.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-start justify-between gap-4 border-b border-canvas pb-4 last:border-0 last:pb-0"
              >
                <div>
                  <p className="text-body font-semibold text-ink-900">
                    {namn.get(h.employee_id) ?? "Okänd"}
                  </p>
                  <p className="tnum text-small text-ink-500">
                    {h.occurred_on} · {forsening(h.minutes)} schemalagd tid utan stämpling
                  </p>
                </div>
                <Beslut id={h.id} dag={h.occurred_on} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          titel="Lägg upp för hand"
          beskrivning="Motorn ser bara dagar med schema och letar fjorton dygn bakåt. Raden går ändå in som ett förslag."
        />
        <Upplaggning
          personer={[...namn.entries()]
            .map(([id, n]) => ({ id, namn: n }))
            .sort((a, b) => a.namn.localeCompare(b.namn, "sv"))}
        />
      </Card>

      <Card className="p-0 md:p-0">
        <div className="p-6 md:p-8">
          <CardHeader
            titel="Beslutade"
            beskrivning="En beslutad händelse skrivs varken om eller bort. Är beslutet fel hävs det, och båda spåren står kvar."
          />
        </div>
        {beslutade.length === 0 ? (
          <div className="px-6 pb-6 md:px-8 md:pb-8">
            <EmptyState rubrik="Inga beslut än" text="Kön ovan är där de börjar." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse">
              <thead>
                <tr className="border-b border-canvas">
                  {["Dag", "Person", "Läge", "Steg", "Åtgärd", ""].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-6 py-3 text-left text-micro uppercase text-ink-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {beslutade.map((h) => (
                  <tr key={h.id} className="border-b border-canvas last:border-0">
                    <td className="tnum px-6 py-3 text-small text-ink-700">{h.occurred_on}</td>
                    <td className="px-6 py-3 text-small text-ink-900">
                      {namn.get(h.employee_id) ?? "Okänd"}
                    </td>
                    <td className="px-6 py-3">
                      <Badge ton={STATUSTON[h.status]}>{STATUSETIKETT[h.status]}</Badge>
                    </td>
                    <td className="tnum px-6 py-3 text-small text-ink-700">
                      {h.ordningsnummer ?? "—"}
                    </td>
                    <td className="px-6 py-3 text-small text-ink-700">
                      {h.atgard ? ATGARD_ETIKETT[h.atgard as Atgard] : "—"}
                    </td>
                    <td className="px-6 py-3">
                      {h.status === "godkand" ? <Havning id={h.id} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          titel="Trappan som gäller"
          beskrivning="Konfiguration, inte kod. Steget fryses på händelsen när du godkänner den, så en ändring i morgon rör aldrig ett beslut som redan tagits."
        />
        {regler.length === 0 ? (
          <EmptyState rubrik="Trappan är tom" text="Fyll i den under Provision → Regler." />
        ) : (
          <ol className="flex flex-col gap-3">
            {regler.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-2">
                <span className="tnum text-small font-semibold text-ink-900">
                  Gång {r.antal_handelser}
                </span>
                <span className="text-small text-ink-500">
                  inom {r.periodlangd_manader} månader →
                </span>
                <span className="text-small text-ink-900">{ATGARD_ETIKETT[r.atgard]}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 max-w-[70ch] text-small text-ink-500">
          Grundprovisionen rörs aldrig — intjänade pengar för utfört arbete faller inte bort.
          Vid en bonusförlust faller volymbonusen och K&amp;V-bonusen för händelsens månad, och
          orderräknaren börjar om från noll: nya order samma månad bygger en ny trappa. Övrig
          bonus står kvar (Ö8).
        </p>
      </Card>
    </div>
  );
}
