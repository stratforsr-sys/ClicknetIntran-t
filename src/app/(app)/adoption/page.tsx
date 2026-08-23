import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabaseServer } from "@/lib/supabase/server";
import {
  dagarSedan,
  klibbighet,
  tackning,
  toppvarde,
  type Aktivitetsdag,
} from "@/lib/adoption";

export const dynamic = "force-dynamic";
export const metadata = { title: "Adoption — Clicknet Nav" };

const DAGAR = 30;
const GLOMD_EFTER = 90;

/**
 * E6.5 / AC-12.5.
 *
 * Sidan har inget eget rollfilter. `adoption_*`-funktionerna i 0029 bar
 * villkoret sjalva och svarar med noll rader for fel roll — samma svar som RLS
 * ger pa resten av navet. Ett andra filter har hade blivit ett andra svar pa
 * samma fraga, och det ar alltid det slappare som overlever nar de glider isar.
 *
 * Ingen av siffrorna gar att bryta ner pa person. Det ar inte en begransning i
 * vyn utan i schemat: `activity_day` har ingen select-policy alls, och
 * `search_miss` har ingen kolumn for vem som sokte. Skalen star i 0029.
 */
export default async function Adoption() {
  const supabase = await supabaseServer();

  const [aktivitet, sokmissar, glomda, anstallda] = await Promise.all([
    supabase
      .rpc("adoption_aktivitet", { p_dagar: DAGAR })
      .then((r) => (r.data ?? []) as Aktivitetsdag[]),
    supabase
      .rpc("adoption_sokmissar", { p_antal: 20 })
      .then((r) => (r.data ?? []) as { q: string; antal: number; senast: string }[]),
    supabase
      .rpc("adoption_glomda_dokument", { p_dagar: GLOMD_EFTER })
      .then(
        (r) => (r.data ?? []) as { id: string; slug: string; title: string; senast: string | null }[],
      ),
    supabase
      .from("employee")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .then((r) => r.count ?? 0),
  ]);

  const sista = aktivitet[aktivitet.length - 1];
  const topp = toppvarde(aktivitet);
  const klibb = klibbighet(aktivitet);
  const tack = tackning(aktivitet, anstallda);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Adoption</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Används navet? Siffrorna nedan räknar personer, sökningar och dokument — aldrig vem som
          gjorde vad. Enskilda dagar per person går inte att läsa ut, varken här eller via API:t.
        </p>
      </div>

      {aktivitet.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Ingen statistik att visa"
            text="Adoptionssiffrorna är läsbara för säljchef, VD och administratör."
          />
        </Card>
      ) : (
        <Card>
          <h2 className="text-h2 text-ink-900">Aktiva användare</h2>
          <p className="mt-1 text-small text-ink-500">
            En person räknas den dag hen använt navet. Veckotalet räknar skilda personer i de
            senaste sju dagarna — samma person två dagar i rad räknas en gång.
          </p>

          <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
            <div>
              <dt className="text-small text-ink-500">I dag</dt>
              <dd className="tnum text-display text-ink-900">{sista?.dau ?? 0}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Senaste sju dagarna</dt>
              <dd className="tnum text-display text-ink-900">{sista?.wau ?? 0}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Av {anstallda} anställda</dt>
              <dd className="tnum text-display text-ink-900">
                {tack === null ? "–" : `${tack} %`}
              </dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Återkommer</dt>
              <dd className="tnum text-display text-ink-900">
                {klibb === null ? "–" : `${klibb} %`}
              </dd>
            </div>
          </dl>

          {/* Staplarna ar veckotalet, den ljusa delen dagens. Ingen bild och
              inget bibliotek: trettio div-element ritar samma sak, funkar utan
              JavaScript och kostar ingenting att ladda. */}
          <div className="mt-6 flex h-28 items-end gap-[3px]" aria-hidden="true">
            {aktivitet.map((d) => (
              <div key={d.dag} className="flex flex-1 flex-col justify-end gap-[2px]">
                <div
                  className="w-full rounded-t-sm bg-brand-200"
                  style={{ height: `${Math.round((d.wau / topp) * 100)}%` }}
                />
                <div
                  className="w-full bg-brand-600"
                  style={{ height: `${Math.round((d.dau / topp) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-small text-ink-500">
            <span>
              {new Date(aktivitet[0].dag).toLocaleDateString("sv-SE", {
                day: "numeric",
                month: "short",
              })}
            </span>
            <span>i dag</span>
          </div>

          {/* Tabellen ar inte dekoration. Staplarna ovan ar aria-hidden, och det
              har ar samma uppgifter i en form en skarmlasare kan lasa (X1). */}
          <details className="mt-4">
            <summary className="cursor-pointer text-small text-ink-500">
              Visa siffrorna som tabell
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-small">
                <caption className="sr-only">
                  Antal aktiva användare per dag de senaste {DAGAR} dagarna
                </caption>
                <thead>
                  <tr className="text-left text-ink-500">
                    <th scope="col" className="py-1 pr-4 font-normal">
                      Dag
                    </th>
                    <th scope="col" className="py-1 pr-4 font-normal">
                      Den dagen
                    </th>
                    <th scope="col" className="py-1 font-normal">
                      Sju dagar bakåt
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...aktivitet].reverse().map((d) => (
                    <tr key={d.dag} className="border-t border-canvas">
                      <td className="tnum py-1 pr-4 text-ink-700">
                        {new Date(d.dag).toLocaleDateString("sv-SE")}
                      </td>
                      <td className="tnum py-1 pr-4 text-ink-700">{d.dau}</td>
                      <td className="tnum py-1 text-ink-700">{d.wau}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>
      )}

      <Card>
        <h2 className="text-h2 text-ink-900">Sökningar utan träff</h2>
        <p className="mt-1 max-w-[70ch] text-small text-ink-500">
          Det närmaste navet kommer ett önskemål: någon letade efter något som inte finns. Ingen
          person sparas — bara texten och hur många gånger den sökts.
        </p>

        {sokmissar.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              rubrik="Inga träfflösa sökningar"
              text="Antingen hittar alla det de letar efter, eller så har ingen sökt än."
            />
          </div>
        ) : (
          <ul className="mt-4 flex flex-col">
            {sokmissar.map((s) => (
              <li
                key={s.q}
                className="flex items-center gap-4 border-b border-canvas py-2 last:border-0"
              >
                <span className="flex-1 text-body text-ink-900">{s.q}</span>
                <Badge ton={s.antal >= 3 ? "warn" : "neutral"}>
                  {s.antal} {s.antal === 1 ? "gång" : "gånger"}
                </Badge>
                <time className="tnum w-24 shrink-0 text-right text-small text-ink-500">
                  {new Date(s.senast).toLocaleDateString("sv-SE")}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="text-h2 text-ink-900">Dokument ingen läst på {GLOMD_EFTER} dagar</h2>
        <p className="mt-1 max-w-[70ch] text-small text-ink-500">
          Publicerade rutiner som ingen öppnat. En rutin ingen läser styr inget arbete — den ska
          antingen göras känd eller arkiveras. Utkast och arkiverade står utanför listan.
        </p>

        {glomda.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              rubrik="Alla publicerade rutiner har lästs"
              text={`Ingen publicerad rutin har stått oläst i ${GLOMD_EFTER} dagar.`}
            />
          </div>
        ) : (
          <ul className="mt-4 flex flex-col">
            {glomda.map((d) => {
              const dagar = dagarSedan(d.senast);
              return (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-canvas py-2 last:border-0"
                >
                  <Link
                    href={`/rutiner/${d.slug}`}
                    className="flex-1 text-body text-ink-900 underline-offset-2 hover:underline"
                  >
                    {d.title}
                  </Link>
                  <Badge ton={dagar === null ? "danger" : "warn"}>
                    {dagar === null ? "Aldrig öppnad" : `Senast för ${dagar} dagar sedan`}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
