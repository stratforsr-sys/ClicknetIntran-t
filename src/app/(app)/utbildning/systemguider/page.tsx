import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getCurrentUser } from "@/lib/auth";
import { hamtaLage } from "@/lib/sparrar";
import { stampelfri } from "@/lib/stampelfri";
import { guiderForRoller } from "@/guider";
import { hamtaProgress } from "@/lib/guider-server";
import { GUIDE_ETIKETT, GUIDE_TON, guideLage, procent, type GuideLage } from "@/lib/guider";
import { GorOm } from "./GorOm";

export const dynamic = "force-dynamic";

/**
 * Systemguiderna — turerna som lär ut navet självt.
 *
 * ===========================================================================
 * VARFÖR DEN HÄR SIDAN INTE ÄR EN KURSLISTA
 *
 * M6 har redan en lista över kurser, och en systemguide ÄR tänkt att på sikt
 * bokföras som en kurs med modultypen `guidad_tur` — det är så chefsöversikten
 * och certifikaten kommer utan att byggas en andra gång. Men en kurs kräver en
 * `owner_id` som pekar på en anställd, och guiderna föds i koden innan det finns
 * någon att peka på. Att seeda en kursrad i en migration hade krävt att man
 * gissade vem som äger den.
 *
 * Därför står listan för sig själv tills G5, då speglingen mot kurserna och
 * anställningschecklistan byggs. Vad användaren ser ändras inte av det bytet.
 * ===========================================================================
 *
 * SIDAN VISAR BARA DET SOM GÄLLER DEN SOM ÖPPNAR DEN. En guide för ekonomi
 * finns inte i en säljares lista — samma regel som `course.audience_roles`
 * följer, och av samma skäl: en lista med sjutton poster där fyra angår mig
 * lär mig att inte läsa listan.
 */
export default async function Systemguider() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  /**
   * Stämplingsguiden gäller bara den som stämplar, och svaret på den frågan bor
   * i `stampelfri.ts` plus modulens spärr — aldrig i en rollista i guiden. Se
   * `krav` i src/guider/typer.ts.
   */
  const [lage, progress] = await Promise.all([hamtaLage(), hamtaProgress(user.employee.id)]);
  const stamplar = lage.stampling && !stampelfri(user.roles);

  const mina = guiderForRoller(user.roles, {
    stamplar,
    behorigheter: user.permissions,
  });
  const forSlug = new Map(progress.map((p) => [p.guide_slug, p]));

  const kvar = mina.filter((g) => guideLage(g, forSlug.get(g.slug)) !== "klar");

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Systemguider</h1>
        <p className="mt-1 text-body text-ink-500">
          {mina.length === 0
            ? "Inga guider är riktade till dig än."
            : kvar.length === 0
              ? "Du är genomgången. Guiderna ligger kvar om du vill göra om någon."
              : `${kvar.length} av ${mina.length} kvar att gå igenom.`}
        </p>
      </div>

      <Card>
        <CardHeader
          titel="Så fungerar de"
          beskrivning="En guide lägger sig över det riktiga navet och pekar ut vad du tittar på. Du kan pausa mitt i — du kommer tillbaka till samma steg."
        />

        <ul className="mt-5 flex flex-col divide-y divide-canvas">
          {mina.map((guide) => {
            const p = forSlug.get(guide.slug) ?? null;
            const lage = guideLage(guide, p);
            const andel = procent(guide, p);

            return (
              <li key={guide.slug} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4 first:pt-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body font-semibold text-ink-900">{guide.titel}</p>
                    <Etikett lage={lage} />
                  </div>
                  <p className="mt-1 text-small text-ink-500">{guide.beskrivning}</p>

                  {/* Raden ritas bara när den säger något. Noll procent är inte
                      en tom mätare utan en guide som inte börjat. */}
                  {lage === "pagar" && (
                    <div className="mt-2 flex items-center gap-3">
                      <div aria-hidden className="h-1 w-32 overflow-hidden rounded-full bg-canvas">
                        <div className="h-full rounded-full bg-brand-600" style={{ width: `${andel}%` }} />
                      </div>
                      <span className="text-micro text-ink-500">{andel} %</span>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-small text-ink-500">{guide.minuter} min</span>
                  <GorOm slug={guide.slug} klar={lage === "klar"} />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function Etikett({ lage }: { lage: GuideLage }) {
  return <Badge ton={GUIDE_TON[lage]}>{GUIDE_ETIKETT[lage]}</Badge>;
}
