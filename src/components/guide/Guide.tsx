"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { ankareFor, sparvarde, startSteg, synligaSteg } from "@/lib/guider";
import type { Guide as GuideDef, Lage } from "@/guider";
import { bokforGuidesteg, bokforGuideKlar } from "./actions";

/**
 * Den guidade turen så som den ser ut på skärmen.
 *
 * ===========================================================================
 * TRE SAKER SOM AVGÖR HELA KONSTRUKTIONEN
 *
 * 1. DET ÄR DEN RIKTIGA SIDAN UNDER. Overlayen ritar inte en bild av navet —
 *    den mörklägger navet och klipper ett hål över elementet steget handlar om.
 *    Det som syns i hålet är alltså alltid sant, även när knappen bytt färg
 *    eller flyttat sig sedan guiden skrevs.
 *
 * 2. HELA OVERLAYEN SLÄPPER IGENOM KLICK (`pointer-events-none`), utom rutan
 *    med texten. Alternativet — att blockera allt utom hålet — kräver att man
 *    räknar ut fyra rektangler runt målet och håller dem i takt med varje
 *    scroll. Det går sönder på ett sätt som låser användaren ute ur sitt eget
 *    nav, och en guide får aldrig kunna göra det. Priset är att man kan klicka
 *    bredvid och vandra iväg; turen står kvar och väntar där hon lämnade den.
 *
 * 3. MÅLET SLÅS UPP VARJE BILDRUTA. En `useEffect` som mäter en gång räcker
 *    inte: sidopanelen glider in på en telefon, toppraden är klistrad, kort
 *    växer när data kommer. En rAF-slinga med en enda attributväljare kostar
 *    ingenting mätbart och gör att hålet sitter rätt även mitt i en animation.
 *    Slingan är också det som upptäcker att ankaret INTE finns — se `saknas`.
 * ===========================================================================
 */

/** Så länge letar vi efter ett ankare innan guiden räknas som trasig. ~2 s. */
const TALAMOD = 120;

/** Luft runt hålet, i pixlar. Ett hål som tajt följer knappen ser ut som ett fel. */
const LUFT = 6;

type Rutan = { top: number; left: number; width: number; height: number; radie: number };

export function Guide({
  guide,
  sparat,
}: {
  guide: GuideDef;
  /** Antal avklarade steg i guidens fullständiga lista. Se src/lib/guider.ts. */
  sparat: number;
}) {
  const router = useRouter();
  const path = usePathname();

  /**
   * Ingenting ritas på servern.
   *
   * Läget (dator eller telefon) går bara att läsa i webbläsaren, och stegen
   * skiljer sig mellan lägena. Renderade vi på servern skulle första bildrutan
   * visa fel steg och sedan byta — och för den som får en obligatorisk ruta i
   * ansiktet vid första inloggningen är det första intrycket av navet.
   */
  const [monterad, setMonterad] = useState(false);
  const [lage, setLage] = useState<Lage>("dator");
  const [pausad, setPausad] = useState(false);
  const [klar, setKlar] = useState(false);

  useEffect(() => {
    const fraga = window.matchMedia("(max-width: 767px)");
    const stall = () => setLage(fraga.matches ? "mobil" : "dator");
    stall();
    setMonterad(true);
    fraga.addEventListener("change", stall);
    return () => fraga.removeEventListener("change", stall);
  }, []);

  const synliga = synligaSteg(guide, lage);

  /**
   * Positionen hålls i klienten och speglas till servern efteråt.
   *
   * Turen ska aldrig vänta på nätet mellan två steg. Går skrivningen fel är det
   * värsta som hänt att personen återupptar en bit tidigare nästa gång — vilket
   * är rätt håll att fela åt. En tur som hänger sig i en halv sekund vid varje
   * klick är däremot något man aktivt börjar undvika.
   */
  const [position, setPosition] = useState(() => startSteg(guide, "dator", sparat));

  // Läget kan hinna bli känt efter första renderingen, och positionen räknas i
  // den synliga listan — som är en annan lista på en telefon.
  const stalltFor = useRef<Lage | null>(null);
  useEffect(() => {
    if (!monterad || stalltFor.current === lage) return;
    stalltFor.current = lage;
    setPosition(startSteg(guide, lage, sparat));
  }, [monterad, lage, guide, sparat]);

  const steg = synliga[position]?.steg ?? null;
  const ankare = steg ? ankareFor(steg, lage) : undefined;

  /** Står användaren på rätt sida? Ett steg utan `vag` hör hemma överallt. */
  const rattSida = !steg?.vag || steg.vag === path;

  const [rutan, setRutan] = useState<Rutan | null>(null);
  const [saknas, setSaknas] = useState(false);
  const rullat = useRef(false);

  /**
   * Slingan som håller hålet på plats — och som upptäcker att det inte finns
   * något att sätta det på.
   *
   * ETT SAKNAT ANKARE LÅSER INTE NÅGON. Efter två sekunder ger vi upp och visar
   * rutan mitt på skärmen med en förklaring och en väg vidare. Beslutet
   * 2026-08-31: en trasig guide ska aldrig kunna stå i vägen för arbetet. Det
   * är också därför `npm run test:guider` finns — felet ska fångas i bygget, och
   * det här är bara nätet under.
   */
  useEffect(() => {
    if (!monterad || pausad || klar) return;

    rullat.current = false;
    setSaknas(false);

    if (!ankare || !rattSida) {
      setRutan(null);
      return;
    }

    let id = 0;
    let tomma = 0;

    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-guide="${ankare}"]`);

      if (!el) {
        tomma += 1;
        if (tomma > TALAMOD) {
          setRutan(null);
          setSaknas(true);
          return; // slingan stannar; rutan visar beskedet
        }
        id = requestAnimationFrame(tick);
        return;
      }

      tomma = 0;
      const r = el.getBoundingClientRect();

      // Ett element som ligger utanför vyn rullas fram en gång per steg.
      // `nearest` och inte `center`: sitter det redan i vy ska ingenting röra
      // sig, och en sida som hoppar vid varje steg är svårare att följa.
      if (!rullat.current && (r.top < 0 || r.bottom > window.innerHeight)) {
        rullat.current = true;
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }

      const radie = Number.parseFloat(getComputedStyle(el).borderRadius) || 8;

      setRutan((forra) => {
        const ny: Rutan = {
          top: r.top - LUFT,
          left: r.left - LUFT,
          width: r.width + LUFT * 2,
          height: r.height + LUFT * 2,
          radie: radie + LUFT,
        };
        // Bara när något faktiskt ändrats: annars sätter vi state 60 gånger i
        // sekunden och ritar om rutan i onödan.
        if (
          forra &&
          Math.abs(forra.top - ny.top) < 0.5 &&
          Math.abs(forra.left - ny.left) < 0.5 &&
          Math.abs(forra.width - ny.width) < 0.5 &&
          Math.abs(forra.height - ny.height) < 0.5
        ) {
          return forra;
        }
        return ny;
      });

      id = requestAnimationFrame(tick);
    };

    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [monterad, pausad, klar, ankare, rattSida, position]);

  const gaVidare = useCallback(() => {
    const sista = position >= synliga.length - 1;

    if (sista) {
      setKlar(true);
      void bokforGuideKlar(guide.slug).then(() => router.refresh());
      return;
    }

    const nastaPosition = position + 1;
    setPosition(nastaPosition);
    void bokforGuidesteg(guide.slug, sparvarde(guide, lage, position));
  }, [position, synliga.length, guide, lage, router]);

  /**
   * Handlingen som steget kräver.
   *
   * Lyssnaren sitter på `document` i FÅNGSTFASEN och inte på elementet självt.
   * Målet kan bytas ut mitt under steget — React ritar om, sidopanelen monteras
   * på nytt när menyn öppnas — och en lyssnare fäst på noden hade följt med den
   * gamla noden i graven. `closest()` frågar i stället om det som klickades
   * ligger inuti ankaret, vilket också gör att ett klick på ikonen inuti en
   * knapp räknas.
   */
  useEffect(() => {
    if (!monterad || pausad || klar || saknas || !steg || !ankare || !rattSida) return;
    if (steg.handling === "vidare") return;

    const traff = (mal: EventTarget | null) =>
      mal instanceof Element && Boolean(mal.closest(`[data-guide="${ankare}"]`));

    const vidHandelse = (e: Event) => {
      if (!traff(e.target)) return;
      // Låt webbläsaren göra det den skulle: menyn ska hinna öppnas, fältet
      // hinna få fokus. Steget byts direkt efteråt.
      setTimeout(gaVidare, 220);
    };

    const typ = steg.handling === "fokus" ? "focusin" : "click";
    document.addEventListener(typ, vidHandelse, true);
    return () => document.removeEventListener(typ, vidHandelse, true);
  }, [monterad, pausad, klar, saknas, steg, ankare, rattSida, gaVidare]);

  // Escape pausar. En obligatorisk ruta måste gå att skjuta undan för stunden —
  // annars är nästa steg att logga ut.
  useEffect(() => {
    if (!monterad || pausad || klar) return;
    const vidTangent = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPausad(true);
    };
    window.addEventListener("keydown", vidTangent);
    return () => window.removeEventListener("keydown", vidTangent);
  }, [monterad, pausad, klar]);

  if (!monterad || pausad || klar || !steg) return null;

  const sista = position >= synliga.length - 1;
  const visaHal = Boolean(rutan) && !saknas && rattSida;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-live="polite">
      {/*
        Mörkläggningen ÄR hålets skugga. En `box-shadow` med 9999 px spridning
        fyller hela skärmen utom elementets egen yta, vilket ger ett hål med
        rundade hörn utan en enda extra nod — och utan en SVG-mask som måste
        ritas om vid varje scroll.

        Ligger inget mål framme (välkomstrutan, ett saknat ankare, fel sida)
        mörkläggs hela ytan i stället, med samma ton.
      */}
      {visaHal ? (
        <div
          aria-hidden
          className="fixed rounded-sm transition-[top,left,width,height] duration-fast ease-brand"
          style={{
            top: rutan!.top,
            left: rutan!.left,
            width: rutan!.width,
            height: rutan!.height,
            borderRadius: rutan!.radie,
            boxShadow: "0 0 0 9999px rgb(15 23 42 / 0.66)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0" style={{ background: "rgb(15 23 42 / 0.66)" }} />
      )}

      <Ruta
        guide={guide}
        stegNr={position + 1}
        antal={synliga.length}
        rubrik={saknas ? "Guiden pekar på något som flyttat" : steg.rubrik}
        text={
          saknas
            ? "Den här delen av navet har byggts om sedan guiden skrevs. Felet är rapporterat. " +
              "Hoppa vidare — resten av turen fungerar."
            : rattSida
              ? steg.text
              : "Det här steget hör hemma på en annan sida."
        }
        mal={visaHal ? rutan : null}
        handling={saknas || !rattSida ? "vidare" : steg.handling}
        sista={sista}
        vag={rattSida ? null : (steg.vag ?? null)}
        vidare={gaVidare}
        pausa={() => setPausad(true)}
      />
    </div>
  );
}

/**
 * Rutan med texten.
 *
 * Placeras under målet när det får plats, annars över. Utanför hålet, aldrig
 * ovanpå det — den som ska titta på en knapp ska kunna se knappen.
 * Utan mål står den mitt på skärmen.
 */
function Ruta({
  guide,
  stegNr,
  antal,
  rubrik,
  text,
  mal,
  handling,
  sista,
  vag,
  vidare,
  pausa,
}: {
  guide: GuideDef;
  stegNr: number;
  antal: number;
  rubrik: string;
  text: string;
  mal: Rutan | null;
  handling: "klick" | "fokus" | "vidare";
  sista: boolean;
  vag: string | null;
  vidare: () => void;
  pausa: () => void;
}) {
  const egen = useRef<HTMLDivElement>(null);
  const [plats, setPlats] = useState<{ top: number; left: number } | null>(null);

  /**
   * `useLayoutEffect` och inte `useEffect`: rutan mäts och flyttas innan
   * webbläsaren ritar. Med den vanliga varianten hinner den ritas mitt på
   * skärmen och hoppa på plats efteråt — en gång per steg, tio gånger per tur.
   *
   * Ingen varning i serverrenderingen: `Guide` returnerar null tills den är
   * monterad, så den här komponenten når aldrig servern.
   */
  useLayoutEffect(() => {
    const el = egen.current;
    if (!el || !mal) {
      setPlats(null);
      return;
    }

    const b = el.getBoundingClientRect();
    const marginal = 12;
    const under = mal.top + mal.height + marginal;
    const over = mal.top - b.height - marginal;

    // Under målet om det ryms, annars över, annars klistrad mot nederkanten.
    let top = under;
    if (under + b.height > window.innerHeight - 8) top = over >= 8 ? over : window.innerHeight - b.height - 8;

    // Vågrätt: linjerad med målets vänsterkant, men aldrig utanför fönstret.
    let left = mal.left;
    const max = window.innerWidth - b.width - 8;
    if (left > max) left = max;
    if (left < 8) left = 8;

    setPlats({ top: Math.max(8, top), left });
  }, [mal, rubrik, text]);

  const centrerad = !mal || !plats;

  return (
    <div
      ref={egen}
      role="dialog"
      aria-label={`${guide.titel}, steg ${stegNr} av ${antal}`}
      className={cn(
        "pointer-events-auto fixed w-[min(22rem,calc(100vw-1rem))] rounded-lg bg-surface p-5 shadow-elev-3",
        "ring-1 ring-ink-300/30",
        centrerad && "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
      )}
      style={centrerad ? undefined : { top: plats!.top, left: plats!.left }}
    >
      <p className="text-micro uppercase text-ink-500">
        {guide.titel} · steg {stegNr} av {antal}
      </p>

      <h2 className="mt-2 text-h2 text-ink-900">{rubrik}</h2>
      <p className="mt-2 text-small text-ink-500">{text}</p>

      {/* Framstegsraden. Fyra minuter känns kortare när man ser dem ta slut. */}
      <div aria-hidden className="mt-4 h-1 overflow-hidden rounded-full bg-canvas">
        <div
          className="h-full rounded-full bg-brand-600 transition-[width] duration-base ease-brand"
          style={{ width: `${Math.round((stegNr / antal) * 100)}%` }}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        {/*
          "Pausa", inte "Hoppa över". Turen är obligatorisk och kommer tillbaka
          vid nästa sidladdning, på samma steg. Ordet ska säga det.
        */}
        <button
          type="button"
          onClick={pausa}
          className="text-small text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline"
        >
          Pausa
        </button>

        {vag ? (
          <Link
            href={vag}
            className="inline-flex min-h-9 items-center rounded-full bg-brand-600 px-4 text-small font-semibold text-ink-inv"
          >
            Gå dit
          </Link>
        ) : handling === "vidare" ? (
          <Button size="sm" onClick={vidare}>
            {sista ? "Klart" : "Nästa"}
          </Button>
        ) : (
          /*
            Ingen knapp på de steg som kräver något. Att sätta en "Nästa" bredvid
            "Tryck på Mer" vore att erbjuda vägen förbi det man ska lära sig, och
            då gör alla det.
          */
          <span className="text-small font-semibold text-brand-700">
            {handling === "fokus" ? "Klicka i fältet" : "Din tur — tryck på den"}
          </span>
        )}
      </div>
    </div>
  );
}
