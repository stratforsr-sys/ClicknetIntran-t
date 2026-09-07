"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Ikon } from "@/components/shell/Ikon";
import { Chiprad, Flikrad, Grupprubrik, Sifferrad, TomFlik } from "@/components/ui/Flikar";

/** En rad, färdigskriven på servern. Se kommentaren om nyttolast nedan. */
export type Lagesrad = {
  nyckel: string;
  namn: string;
  lage: "ej_instamplad" | "sen" | "sjuk" | "ledig";
  etikett: string;
  ton: "danger" | "warn" | "accent" | "neutral";
  detalj: string;
  href: string;
};

export type Dagslagevy = {
  idag: Lagesrad[];
  /** Nyckel = antal dagar framåt. Kommer ur `hamtaFramat`. */
  framat: Record<number, Lagesrad[]>;
  fonster: number[];
  /** Falskt när stämplingen är av: då går sen ankomst inte att veta alls. */
  senRaknad: boolean;
  datum: string;
  /** Ansökningar som väntar på den inloggades beslut. Bara talet. */
  attBesluta: number;
};

const LAGE_ORD: Record<Lagesrad["lage"], string> = {
  ej_instamplad: "Inte instämplad",
  sen: "Sen",
  sjuk: "Sjuk",
  ledig: "Ledig",
};

/** Ordningen i listan. Samma som `ORDNING` i `dagslage.ts` — se nedan. */
const ORDNING: Lagesrad["lage"][] = ["ej_instamplad", "sen", "sjuk", "ledig"];

/**
 * ============================================================================
 * DAGENS LÄGE — med tidsfönster som flikar och läge som chips.
 *
 * Ombyggt 2026-09-07 efter beställarens invändning: framåtblicken låg som en
 * rad småtext under listan och lästes som en kommentar. Nu är den en flik.
 *
 * ----------------------------------------------------------------------------
 * VARFÖR FLIKARNA ÄR TID OCH CHIPSEN ÄR LÄGE, OCH INTE TVÄRTOM
 *
 * Tiden byter ut vilken FRÅGA kortet svarar på: "vem är borta i dag" och "vem
 * är borta om två veckor" är två olika ärenden — det första bemannar dagen,
 * det andra avgör om man kan lova bort någon. Läget begränsar bara svaret.
 * Det som byter fråga är en flik; det som filtrerar ett svar är ett chip.
 *
 * ----------------------------------------------------------------------------
 * CHIPSEN ÄR FÄRRE I FRAMTIDEN, OCH DET ÄR HELA POÄNGEN
 *
 * "Sena" och "Inte instämplad" finns bara i fliken för i dag. Ingen är sen på
 * tisdag ännu. Ett chip som alltid visar noll hade lärt ögat att det aldrig
 * händer något där — och den dagen det gjorde det hade ingen sett. Raden under
 * listan säger varför de saknas, i stället för att låta tomrummet betyda det.
 *
 * ----------------------------------------------------------------------------
 * KORTET RITAS ÄVEN NÄR DET ÄR TOMT
 *
 * Medvetet undantag från regeln om rutor man slutar läsa, och det står kvar
 * från 2026-09-03: "Alla är på plats" är ett SVAR på chefens fråga, inte
 * frånvaron av ett svar. Göms kortet när listan är tom skulle en tom skärm
 * betyda två saker — fulltalig personal, eller något som slutat fungera.
 *
 * ----------------------------------------------------------------------------
 * ALLT KOMMER FÄRDIGSKRIVET FRÅN SERVERN
 *
 * Komponenten är en klientkomponent, så allt som skickas hit serialiseras och
 * hamnar i sidans nyttolast. Därför färdiga meningar och inga `Date`, `Map`
 * eller hela underlag — de hade antingen fallit i serialiseringen eller följt
 * med webbläsaren utan att behövas där.
 *
 * SORTERINGEN GÖRS INTE HÄR. Raderna kommer sorterade ur `dagslage.ts`, och
 * grupperingen nedan LÄSER den ordningen. Sorterade komponenten om skulle de
 * två kunna glida isär, och kortet börja säga en sak i rubriken och en annan i
 * listan.
 * ============================================================================
 */
export function Dagslagekort({ vy }: { vy: Dagslagevy }) {
  const [fonster, setFonster] = useState<number>(0); // 0 = i dag
  const [lage, setLage] = useState<string>("alla");

  const idagValt = fonster === 0;
  const rader = idagValt ? vy.idag : (vy.framat[fonster] ?? []);

  // Sena och ej instämplade finns bara i nuet. Se rubriken ovan.
  const mojligaLagen: Lagesrad["lage"][] = idagValt
    ? ORDNING.filter((l) => vy.senRaknad || (l !== "sen" && l !== "ej_instamplad"))
    : ["sjuk", "ledig"];

  const antal = (l: Lagesrad["lage"], i: Lagesrad[]) => i.filter((r) => r.lage === l).length;

  const synliga = lage === "alla" ? rader : rader.filter((r) => r.lage === lage);

  const flikar = [
    { id: "0", etikett: "I dag", antal: vy.idag.length },
    ...vy.fonster.map((d) => ({
      id: String(d),
      etikett: `${d} dagar`,
      antal: (vy.framat[d] ?? []).length,
    })),
  ];

  const chips = [
    { id: "alla", etikett: "Alla", antal: rader.length },
    ...mojligaLagen.map((l) => ({ id: l, etikett: LAGE_ORD[l], antal: antal(l, rader) })),
  ];

  /**
   * Talen. Fyra, och inte fler — en femte hade gjort raden till en tabell.
   *
   * "BORTA" och inte "FRÅNVARANDE": kortet läses på tio sekunder på en telefon.
   * Talen följer den valda fliken, så siffran och listan under den kan aldrig
   * säga emot varandra. "ATT BESLUTA" står utanför fliken eftersom kön inte har
   * något tidsfönster — och den är den enda som kräver en handling, alltså den
   * enda som får larma.
   */
  const borta = rader.filter((r) => r.lage === "sjuk" || r.lage === "ledig").length;
  const tal = [
    { id: "borta", varde: borta, etikett: idagValt ? "Borta i dag" : `Borta ${fonster} dagar`, onKlick: () => setLage("alla") },
    { id: "sjuk", varde: antal("sjuk", rader), etikett: "Sjuka", onKlick: () => setLage("sjuk") },
    idagValt && vy.senRaknad
      ? { id: "sen", varde: antal("sen", rader) + antal("ej_instamplad", rader), etikett: "Sena i dag", onKlick: () => setLage("sen") }
      : { id: "ledig", varde: antal("ledig", rader), etikett: "Lediga", onKlick: () => setLage("ledig") },
    { id: "besluta", varde: vy.attBesluta, etikett: "Att besluta", kraverHandling: true },
  ];

  return (
    <Card>
      <CardHeader
        titel="Dagens läge"
        beskrivning={vy.datum}
        handling={
          <ButtonLink href="/franvaro/attest" size="sm" variant="diskret">
            Frånvaro i teamet
          </ButtonLink>
        }
      />

      <div className="flex flex-col gap-4">
        <Sifferrad tal={tal} />

        <Flikrad
          etikett="Tidsfönster"
          flikar={flikar}
          valt={String(fonster)}
          onVal={(id) => {
            setFonster(Number(id));
            // Ett chip som inte finns i det nya fönstret hade tomt ut listan
            // utan att något syntes vara valt.
            setLage("alla");
          }}
        />

        <Chiprad etikett="Sorts frånvaro" chips={chips} valt={lage} onVal={setLage} />

        {synliga.length === 0 ? (
          <TomFlik
            text={
              rader.length === 0
                ? idagValt
                  ? "Alla är på plats. Ingen sjukanmälan, ingen godkänd ledighet."
                  : `Ingen är borta de närmaste ${fonster} dagarna.`
                : `Ingen ${LAGE_ORD[lage as Lagesrad["lage"]]?.toLowerCase() ?? ""} i det här fönstret.`
            }
            handling={
              rader.length === 0 && idagValt ? (
                <ButtonLink href="/franvaro/sjuk" size="sm" variant="sekundar">
                  Sjukfrånvaro
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-5">
            {mojligaLagen.map((l) => {
              const gruppen = synliga.filter((r) => r.lage === l);
              if (gruppen.length === 0) return null;
              return (
                <div key={l}>
                  <Grupprubrik text={LAGE_ORD[l]} antal={gruppen.length} />
                  <ul className="mt-1 flex flex-col">
                    {gruppen.map((r) => (
                      <li key={r.nyckel} className="border-b border-canvas last:border-0">
                        <Link
                          href={r.href}
                          className="group flex min-h-14 items-center gap-3 py-3 transition-colors duration-fast"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-body text-ink-900 group-hover:text-brand-700">
                              {r.namn}
                            </span>
                            <span className="block text-small text-ink-500">{r.detalj}</span>
                          </span>
                          <Badge ton={r.ton}>{r.etikett}</Badge>
                          <Ikon namn="tillbaka" className="size-4 rotate-180 text-ink-300" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {/* Står bara när det behövs, och säger vad som INTE går att veta.
            En tom lista kan annars betyda "alla är här" eller "det går inte
            att se", och skillnaden får inte gissas. */}
        {!idagValt && (
          <p className="text-small text-ink-500">
            Framåt visas bara registrerad frånvaro. Sen ankomst går inte att veta i förväg, och en
            pågående sjukperiod utan slutdag räknas inte som frånvaro längre fram — den står som
            &rdquo;Sjuk nu&rdquo;.
          </p>
        )}
        {idagValt && !vy.senRaknad && vy.idag.length > 0 && (
          <p className="text-small text-ink-500">
            Stämplingen är avstängd. Sena ankomster kan inte visas — listan bär bara registrerad
            frånvaro.
          </p>
        )}
      </div>
    </Card>
  );
}
