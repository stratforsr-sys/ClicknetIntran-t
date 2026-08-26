import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notis } from "@/components/ui/Notis";
import { EmptyState } from "@/components/ui/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { giltigManad, kronor, manadsnamn } from "@/lib/provision";
import { hamtaUnderlag } from "@/lib/provisionsunderlag-server";

export const dynamic = "force-dynamic";

/**
 * E13 steg 7: det separata provisionsunderlaget (O10).
 *
 * ===========================================================================
 * DET HAR AR INTE LONERAPPORTEN, OCH DET AR HELA POANGEN.
 *
 * Bestallaren svarade pa fraga 57 att bonusen ska raknas i lonerapporten. Det
 * krockar med K5 och AC-2.17 — navet raknar ingen lon — sa O10 gav ett eget
 * dokument i stallet, och `payroll_row` far ingen kronkolumn.
 *
 * Skillnaden ar den som star i 0025: lonerapportens kolumner ar MINUTER och
 * ANTAL, for att navet inte far gissa vad en minut ar vard. Kronorna har ar
 * inte en gissning utan en huvudbokssumma som redan ar bokford och attesterad.
 * Navet raknar inte fram dem — det lister upp dem.
 *
 * Det ar tva papper som foljs at till lonekorningen, aldrig ett.
 * ===========================================================================
 *
 * PDF:EN AR UTSKRIFTEN. Fraga 59 bad om CSV och PDF. CSV:en ar en egen rutt;
 * PDF:en ar den har sidan utskriven till fil, vilket varje webblasare gor via
 * "Spara som PDF". Alternativet hade varit ett nytt beroende som genererar
 * PDF pa servern — en stor sak att dra in for ett dokument som redan ar en
 * tabell, och en till plats dar layouten kan glida isar fran vad sidan visar.
 * `print:`-klasserna nedan ar det som gor utskriften laslig.
 */
export default async function Underlagssida({
  params,
}: {
  params: Promise<{ manad: string }>;
}) {
  const { manad } = await params;

  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!giltigManad(manad)) notFound();

  const dok = await hamtaUnderlag(manad);

  const chef = hasRole(user, "sales_manager", "ceo", "finance");

  // Loggas EFTER lasningen. En misslyckad lasning ska inte bokforas som en
  // oppning — samma regel som avvikelsevyn foljer.
  await supabaseAdmin().from("audit_log").insert({
    actor_id: user.employee.id,
    action: "commission.underlag_viewed",
    object_type: "commission_period",
    object_id: manad,
    meta: { period_month: manad, personer: dok.personer.length, faststalld: dok.faststalld },
  });

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/provision"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900 print:hidden"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till provision
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">
            Provisionsunderlag {manadsnamn(manad)}
          </h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            Intjänat i {manadsnamn(manad)}, utbetalas i {manadsnamn(dok.utbetalas)}. Det här är
            ett eget underlag som följer med lönekörningen — lönerapporten räknar fortfarande
            inga kronor.
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Badge ton={dok.faststalld ? "ok" : "warn"}>
            {dok.faststalld ? "Fastställd" : "Preliminär"}
          </Badge>
          {chef && (
            <ButtonLink href={`/provision/underlag/${manad}/csv`} size="sm" variant="sekundar">
              Hämta som CSV
            </ButtonLink>
          )}
        </div>
      </div>

      {!dok.faststalld && (
        <Notis ton="warn">
          <strong>Månaden är inte fastställd.</strong> Siffrorna räknas live ur orderna och
          ändras med varje ny order, makulering och bedömning. Betala inte ut efter det här
          pappret — fastställ perioden på provisionssidan först, då bokförs posterna och
          siffran står stilla.
        </Notis>
      )}

      {dok.personer.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Ingenting att betala ut"
            text={`Ingen har provision i ${manadsnamn(manad)}, eller så ser du bara din egen rad.`}
          />
        </Card>
      ) : (
        <>
          <Card status="brand">
            <CardHeader
              titel="Att betala ut"
              beskrivning={`${dok.personer.length} ${dok.personer.length === 1 ? "person" : "personer"}, utbetalning i ${manadsnamn(dok.utbetalas)}.`}
            />
            <p className="tnum text-display text-ink-900">{kronor(dok.summa)}</p>
          </Card>

          {dok.personer.map((p) => (
            <Card key={p.employee_id} className="break-inside-avoid">
              <CardHeader
                titel={p.namn}
                beskrivning={
                  p.anstallningsnummer
                    ? `Anställningsnummer ${p.anstallningsnummer}`
                    : "Anställningsnummer saknas"
                }
              />
              {p.poster.length === 0 ? (
                <p className="text-small text-ink-500">
                  Inga poster. Månaden går ihop till noll — personen är räknad, inte glömd.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {p.poster.map((post, i) => (
                    <li
                      key={`${p.employee_id}-${i}`}
                      className="flex flex-wrap items-baseline gap-3 border-b border-canvas py-2 last:border-0"
                    >
                      <span className="flex-1 text-small text-ink-700">{post.text}</span>
                      <span className="tnum text-small font-semibold text-ink-900">
                        {kronor(post.belopp)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex items-baseline justify-between border-t border-ink-900/10 pt-3">
                <span className="text-body font-semibold text-ink-900">Summa</span>
                <span className="tnum text-body font-semibold text-ink-900">
                  {kronor(p.summa)}
                </span>
              </div>
            </Card>
          ))}
        </>
      )}

      <p className="max-w-[70ch] text-small text-ink-500">
        Beloppen kommer ur provisionshuvudboken och är inte omräknade här. En rättelse bokförs
        som en egen negativ post — en bokförd post skrivs aldrig om. Frånvaro, arbetad tid och
        avvikelser står i lönerapporten och aldrig i det här dokumentet.
      </p>
    </div>
  );
}
