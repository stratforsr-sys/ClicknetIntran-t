import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import {
  brottext,
  fristlage,
  omfattning,
  periodtext,
  periodtextOppen,
  sjukdag,
  startlage,
  FRIST_ETIKETT,
  type Fristtyp,
} from "@/lib/franvaro";
import { Sektionsflikar } from "@/components/ui/Flikar";
import { hamtaChefsbild, hamtaRegelverk } from "@/lib/franvaro-server";
import { Attestkort, type Attestvy } from "./Attestkort";
import { Sjukanteckningar } from "../Sjukanteckningar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Frånvaro i teamet — Clicknet Nav" };

/**
 * ============================================================================
 * CHEFENS FRÅNVAROVY (E7.1, AC-3.12) — OMBYGGD 2026-09-07.
 *
 * Hette "Att besluta" och var en lista. Beställarens invändning: den svarade
 * bara på halva frågan. Chefen som öppnar den vill veta både vad som väntar på
 * ett beslut OCH vem som faktiskt är borta — och de två låg på fyra sidor.
 *
 * TRE AVDELNINGAR, I DEN ORDNING FRÅGORNA STÄLLS:
 *
 *   1. ATT BESLUTA. Det som väntar på just den inloggade, med hela underlaget
 *      utskrivet och knapparna i samma kort. Sorterat på när ledigheten
 *      BÖRJAR och inte på när ansökan kom — den som söker för nästa vecka
 *      behöver svar först.
 *
 *   2. SJUKFRÅNVARO. Pågående perioder, med sjukdagsnummer, öppna frister med
 *      nedräkning, och chefens anteckningar. Den obekräftade ligger överst
 *      (AC-3.17): bekräftelsen är inte administration utan hela poängen.
 *
 *   3. BORTA OCH PÅ VÄG. Godkänd ledighet som pågår eller börjar inom två
 *      veckor. Ingen handling, bara vetskapen — det är den avdelning man läser
 *      innan man lovar bort någon till en kund.
 *
 * VAD SOM MEDVETET INTE FLYTTADE HIT:
 *
 *   Årsvyn ligger kvar på /franvaro/planering. Två veckor är bemanning; ett år
 *   är planering, och en skärm som försöker vara båda blir ingendera.
 *
 *   Sjukanmälans HANDLINGAR — bekräfta, kvittera frist, avsluta, intyg — ligger
 *   kvar på /franvaro/sjuk. Här står läget och anteckningen; där görs saken.
 *   Att duplicera knapparna hade gett två ställen att glömma ändra.
 * ============================================================================
 */
export default async function Chefsvy() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const idag = svensktDatum();
  const uppslag = await hamtaRegelverk();
  const bild = await hamtaChefsbild(user, uppslag?.regler ?? null, uppslag?.typer ?? [], idag);

  const ledning = hasRole(user, "sales_manager", "ceo");

  /**
   * Kön formas om till det kortet behöver och inget mer.
   *
   * `Attestkort` är en klientkomponent, och allt som skickas dit serialiseras
   * och hamnar i sidans nyttolast. Därför färdiga meningar och inte rådata: en
   * `Date`, en `Map` eller ett helt `Provunderlag` hade antingen fallit i
   * serialiseringen eller följt med webbläsaren utan att behövas där.
   */
  const kortet: Attestvy[] = bild.ko.map((a) => {
    const start = startlage(a.starts_on, idag);
    return {
      id: a.id,
      namn: a.namn,
      typ: a.typ,
      period: periodtext(a.starts_on, a.ends_on),
      omfattning: omfattning(a),
      start: start.text,
      brådskar: start.dagar <= 3,
      skal: a.skal,
      brott: a.brutna.map(brottext),
      bemanning: a.bemanning
        ? {
            over: a.bemanning.over,
            text: bemanningstext(a.bemanning),
          }
        : null,
      saldo: a.saldo
        ? `${a.saldo.dagar} dagar inmatade ${a.saldo.asOf}${a.saldo.gammalt ? " — siffran är gammal" : ""}`
        : null,
    };
  });

  const pagar = bild.kommande.filter((k) => k.fran <= idag);
  const paVag = bild.kommande.filter((k) => k.fran > idag);
  const obekraftade = bild.sjuka.filter((s) => !s.bekraftad && !s.sistaDag).length;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/franvaro"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till min frånvaro
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Frånvaro i teamet</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            {ledning
              ? "Hela bolaget. Det som väntar på ditt beslut ligger överst, sedan sjukfrånvaron och sist vilka som är borta de närmaste två veckorna."
              : "De du leder. Det som väntar på ditt beslut ligger överst, sedan sjukfrånvaron och sist vilka som är borta de närmaste två veckorna."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/franvaro/planering" size="sm" variant="diskret">
            Årsvy
          </ButtonLink>
          <ButtonLink href="/franvaro/sjuk" size="sm" variant="diskret">
            Sjukanmälningar
          </ButtonLink>
        </div>
      </div>

      {/* AC-3.17: den obekräftade anmälan är det enda på sidan som har en frist
          mot en människa och inte mot ett datum. Den står därför över allt
          annat, även över kön. */}
      {obekraftade > 0 && (
        <Notis ton="warn">
          {obekraftade === 1
            ? "En sjukanmälan är inte bekräftad."
            : `${obekraftade} sjukanmälningar är inte bekräftade.`}{" "}
          Den som anmält sig sjuk hör ingenting förrän någon kvitterar.{" "}
          <Link href="/franvaro/sjuk" className="font-semibold underline">
            Bekräfta dem
          </Link>
        </Notis>
      )}

      {/**
        * TRE VYER, EN FLIKRAD (ombyggt 2026-09-07).
        *
        * Korten lag staplade och det nedersta lastes minst, oavsett vad det
        * innehol. Sektionerna ar oforandrade — de renderas fortfarande pa
        * servern med sin egen RLS — men de vaxlas nu i stallet for att
        * scrollas forbi. Se rubriken i `Sektionsflikar`.
        *
        * TALEN OVERST BAR HELA SIDAN och inte den valda fliken. Chefen ska se
        * att tva sjukanmalningar ar obekraftade aven nar hen star i
        * ledighetsfliken — annars hade flikarna kunnat gomma det bradskande.
        */}
      <Sektionsflikar
        etikett="Vy"
        tal={[
          { id: "besluta", varde: kortet.length, etikett: "Att besluta", kraverHandling: true },
          { id: "obekraftade", varde: obekraftade, etikett: "Obekräftade", kraverHandling: true },
          { id: "sjuka", varde: bild.sjuka.length, etikett: "Sjukperioder" },
          { id: "borta", varde: bild.kommande.length, etikett: `Borta ${bild.fonster} dagar` },
        ]}
        sektioner={[
          {
            id: "besluta",
            etikett: "Att besluta",
            antal: kortet.length,
            innehall: (
            <Card status={kortet.length > 0 ? "brand" : undefined}>
              <CardHeader
                titel={`Att besluta — ${kortet.length} ${kortet.length === 1 ? "ansökan" : "ansökningar"}`}
                beskrivning="Sorterade efter när ledigheten börjar, inte efter när ansökan kom in."
              />

              {kortet.length === 0 ? (
                <EmptyState
                  rubrik="Kön är tom"
                  text="Ansökningar som väntar på ditt beslut hamnar här, med skäl, bemanning och regelbrott utskrivna."
                />
              ) : (
                <ul className="flex flex-col">
                  {kortet.map((p) => (
                    <Attestkort key={p.id} post={p} />
                  ))}
                </ul>
              )}
            </Card>
            ),
          },
          {
            id: "sjuk",
            etikett: "Sjukfrånvaro",
            antal: bild.sjuka.length,
            innehall: (
            <Card>
              <CardHeader
                titel="Sjukfrånvaro"
                beskrivning="Datum, sjukdag och frister — aldrig något om orsak."
                handling={
                  <ButtonLink href="/franvaro/sjuk" size="sm" variant="diskret">
                    Hantera
                  </ButtonLink>
                }
              />

              {bild.sjuka.length === 0 ? (
                <EmptyState
                  rubrik="Ingen är sjukanmäld"
                  text="Pågående sjukperioder hos dem du ansvarar för visas här."
                />
              ) : (
                <ul className="flex flex-col gap-4">
                  {bild.sjuka
                    .slice()
                    .sort(
                      (a, b) =>
                        Number(b.bekraftad === false && !b.sistaDag) - Number(a.bekraftad === false && !a.sistaDag) ||
                        a.forstaDag.localeCompare(b.forstaDag),
                    )
                    .map((s) => {
                      const pagaende = s.sistaDag === null;
                      return (
                        <li key={s.id} className="border-b border-canvas pb-4 last:border-0 last:pb-0">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-h2 text-ink-900">{s.namn}</p>
                              {/* Här stod förut bara "sedan 4 september". Att slutdagen
                                  SAKNAS är en uppgift, inte ett tomrum — se
                                  `periodtextOppen`. */}
                              <p className="text-small text-ink-500">
                                {periodtextOppen(s.forstaDag, s.sistaDag)}
                                {s.omfattning < 100 ? ` · ${s.omfattning} %` : ""}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {pagaende && (
                                <Badge ton="warn">Sjukdag {sjukdag(s.forstaDag, idag)}</Badge>
                              )}
                              {s.eskalerad ? (
                                <Badge ton="danger">Eskalerad</Badge>
                              ) : s.bekraftad ? (
                                <Badge ton="ok">Bekräftad</Badge>
                              ) : (
                                <Badge ton="danger">Obekräftad</Badge>
                              )}
                            </div>
                          </div>

                          {s.frister.length > 0 && (
                            <ul className="mt-2 flex flex-col gap-1">
                              {s.frister.map((f) => {
                                const lage = fristlage(f.due_on, idag);
                                return (
                                  <li key={f.kind} className="flex flex-wrap items-baseline gap-2 text-small">
                                    <span className="text-ink-500">
                                      {FRIST_ETIKETT[f.kind as Fristtyp] ?? f.kind}
                                    </span>
                                    <span
                                      className={
                                        lage.ton === "danger"
                                          ? "font-semibold text-danger-ink"
                                          : lage.ton === "warn"
                                            ? "font-semibold text-warn-ink"
                                            : "text-ink-900"
                                      }
                                    >
                                      {periodtext(f.due_on, f.due_on)} · {lage.text}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}

                          <Sjukanteckningar
                            rapportId={s.id}
                            anteckningar={s.anteckningar}
                            egenAnmalan={false}
                          />
                        </li>
                      );
                    })}
                </ul>
              )}
            </Card>
            ),
          },
          {
            id: "ledighet",
            etikett: "Godkänd ledighet",
            antal: bild.kommande.length,
            innehall: (
            <Card>
              <CardHeader
                titel="Godkänd ledighet"
                beskrivning={`Pågår i dag eller börjar inom ${bild.fonster} dagar.`}
                handling={
                  <ButtonLink href="/franvaro/planering" size="sm" variant="diskret">
                    Hela året
                  </ButtonLink>
                }
              />

              {bild.kommande.length === 0 ? (
                <EmptyState
                  rubrik="Ingen inbokad ledighet"
                  text={`Godkänd ledighet som pågår eller börjar inom ${bild.fonster} dagar visas här.`}
                />
              ) : (
                <div className="flex flex-col gap-5">
                  {pagar.length > 0 && <Bortalista rubrik="Borta i dag" rader={pagar} idag={idag} />}
                  {paVag.length > 0 && <Bortalista rubrik="På väg" rader={paVag} idag={idag} />}
                </div>
              )}
            </Card>
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * Bemanningen som en mening.
 *
 * Siffran ensam ("2") säger ingenting utan taket bredvid sig, och taket
 * ensamt ingenting utan siffran. Saknas taket helt — vilket det gör i hela
 * bolaget tills någon sätter ett — sägs det rakt ut i stället för att raden
 * tyst ser lugn ut.
 */
function bemanningstext(b: {
  datum: string;
  antal: number;
  namn: string[];
  tak: number | null;
  over: boolean;
}): string {
  const vilka = b.namn.length > 0 ? ` (${b.namn.join(", ")})` : "";
  const grund =
    b.antal === 0
      ? "Ingen annan är borta under perioden."
      : `${b.antal} ${b.antal === 1 ? "annan är" : "andra är"} borta ${periodtext(b.datum, b.datum)}${vilka}.`;

  if (b.tak === null) return `${grund} Inget bemanningstak är satt.`;
  return b.over
    ? `${grund} Taket är ${b.tak} samtidigt — godkänner du blir de ${b.antal + 1}.`
    : `${grund} Taket är ${b.tak} samtidigt.`;
}

function Bortalista({
  rubrik,
  rader,
  idag,
}: {
  rubrik: string;
  rader: { employeeId: string; namn: string; etikett: string; detalj: string; href: string; fran: string }[];
  idag: string;
}) {
  return (
    <div>
      <h3 className="text-small font-semibold text-ink-700">{rubrik}</h3>
      <ul className="mt-1 flex flex-col">
        {rader.map((r) => (
          <li key={`${r.employeeId}-${r.href}`} className="border-b border-canvas last:border-0">
            <Link
              href={r.href}
              className="group flex min-h-12 items-center gap-3 py-2 transition-colors duration-fast"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body text-ink-900 group-hover:text-brand-700">
                  {r.namn}
                </span>
                <span className="block text-small text-ink-500">
                  {r.etikett} · {r.detalj}
                  {r.fran > idag ? ` · ${startlage(r.fran, idag).text}` : ""}
                </span>
              </span>
              <Ikon namn="tillbaka" className="size-4 rotate-180 text-ink-300" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
