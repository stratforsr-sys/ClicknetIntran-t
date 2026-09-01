import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser } from "@/lib/auth";
import { LARMGRANS_DAGAR, larmar, sorteraLag } from "@/lib/coachning";
import { farCoacha, hamtaLag } from "@/lib/coachning-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coachning — Clicknet Nav" };

/**
 * Lagvyn.
 *
 * VYN VISAR VEM SOM BEHOVER NAGOT — INTE VEM SOM AR SAMST. Den bar darfor inga
 * poang, ingen placering och ingen jamforelse mellan personer. Det ar samma
 * linje som 0029 drog for adoptionen, som ar byggd for att gora
 * per-person-uppfoljning omojlig, och skalet ar detsamma: en lista som rangordnar
 * kollegor anvands till nagot annat an det den byggdes for.
 *
 * Den som inte coachar nagon skickas till sitt EGET kort. Coachningsvyn ar inte
 * stangd for saljaren — den ser bara annorlunda ut, precis som /avtal och /fel.
 */
export default async function CoachningSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!farCoacha(user)) redirect(`/coachning/${user.employee.id}`);

  const lag = sorteraLag(await hamtaLag(), (r) => r.namn);

  const utanCoachning = lag.filter((r) => larmar(r.dagarSedan)).length;
  const forsenade = lag.reduce((s, r) => s + r.forsenade, 0);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Coachning</h1>
          <p className="mt-1 text-body text-ink-500">
            {/* Den enda siffran vyn behover leda med. Underlaget ar entydigt:
                det ar coachningens FREKVENS som skiljer, inte dess form. */}
            {utanCoachning > 0
              ? `${utanCoachning} har inte coachats på ${LARMGRANS_DAGAR} dagar.`
              : "Alla har coachats den senaste månaden."}
            {forsenade > 0 && ` ${forsenade} uppgift${forsenade === 1 ? "" : "er"} är försenad${forsenade === 1 ? "" : "e"}.`}
          </p>
        </div>
        <Link
          href={`/coachning/${user.employee.id}`}
          className="text-small font-semibold text-brand-700 hover:text-brand-900"
        >
          Min egen coachning
        </Link>
      </div>

      {lag.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Ingen att coacha än"
            text="Vyn fylls med de personer du är chef för. Saknas någon är det teamtillhörigheten i personalregistret som styr."
            handling={
              <Link href="/personal" className="text-small font-semibold text-brand-700 hover:text-brand-900">
                Till personalregistret
              </Link>
            }
          />
        </Card>
      ) : (
        <Card className="p-0 md:p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse">
              <thead>
                <tr className="border-b border-canvas">
                  <th scope="col" className="px-6 py-3 text-left text-micro uppercase text-ink-500">Person</th>
                  <th scope="col" className="px-6 py-3 text-left text-micro uppercase text-ink-500">Senast coachad</th>
                  <th scope="col" className="px-6 py-3 text-left text-micro uppercase text-ink-500">Öppna uppgifter</th>
                  <th scope="col" className="px-6 py-3 text-left text-micro uppercase text-ink-500">Tränar på</th>
                </tr>
              </thead>
              <tbody>
                {lag.map((r) => (
                  <tr key={r.employee_id} className="border-b border-canvas last:border-0">
                    <td className="px-6 py-3 align-top">
                      <Link href={`/coachning/${r.employee_id}`} className="font-semibold text-ink-900 hover:underline">
                        {r.namn}
                      </Link>
                    </td>
                    <td className="px-6 py-3 align-top">
                      {/* AC-U5.2: statusen sags alltid ocksa med ord, aldrig med
                          enbart farg. */}
                      {r.dagarSedan === null ? (
                        <Badge ton="danger">Aldrig</Badge>
                      ) : larmar(r.dagarSedan) ? (
                        <Badge ton="danger">{r.dagarSedan} dagar sedan</Badge>
                      ) : (
                        <span className="tnum text-small text-ink-700">
                          {r.dagarSedan === 0 ? "I dag" : `${r.dagarSedan} dagar sedan`}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 align-top">
                      <span className="tnum text-small text-ink-700">{r.oppna}</span>
                      {r.forsenade > 0 && (
                        <span className="ml-2">
                          <Badge ton="danger">{r.forsenade} försenad{r.forsenade === 1 ? "" : "e"}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 align-top">
                      {r.fokus.length === 0 ? (
                        <span className="text-small text-ink-500">—</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1.5">
                          {r.fokus.map((f) => (
                            <li key={f}>
                              <Badge ton="info">{f}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
