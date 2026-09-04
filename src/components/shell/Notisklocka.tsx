"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ikon } from "./Ikon";
import { cn } from "@/components/ui/cn";
import { narTid, TYP_ETIKETT, TYP_IKON, type Notis } from "@/lib/notiser";
import { avfardaNotisen, markeraNotiserLasta } from "./notiser-actions";

/**
 * UI-PRD §5.7. Klockan i toppraden.
 *
 * Posterna raknas fram pa servern ur raderna som redan finns — se
 * `src/lib/notiser-server.ts`. Den har filen visar dem och avgor en enda sak
 * sjalv: nar markeringarna slocknar.
 *
 * MARKERINGARNA FRYSES VID OPPNINGEN. Att oppna klockan skickar iväg
 * "senast sedd", och utan frysningen hade raderna tappat sina prickar mitt
 * framfor ogonen pa den som just oppnade — man hinner se att det fanns nagot
 * nytt, men inte vad. Prickarna star darfor kvar tills panelen stangs.
 *
 * ===========================================================================
 * TVA SATT ATT BLI AV MED EN POST, OCH DE BETYDER OLIKA SAKER
 *
 * ATT KLICKA PA POSTEN ar att ta hand om den: panelen stangs, navigeringen gar
 * dit posten pekar och raden avfardas.
 *
 * KRYSSET ar att saga "den har behover jag inte se". Panelen star KVAR oppen —
 * den som rensar bort tre poster gor det i en foljd, och en panel som stangde
 * sig efter det forsta krysset hade tvingat tre extra klick pa knappen. Raden
 * forsvinner med en gang och navigeringen uteblir.
 *
 * MARKERA ALLA SOM LASTA slacker prickarna utan att ta bort nagot. Det ar en
 * annan handling an krysset med flit: det som VANTAR pa dig ska inte forsvinna
 * for att du last att det finns. Knappen syns bara nar det finns nagot olast —
 * en knapp som inte gor nagot ar en knapp man slutar tro pa.
 * ===========================================================================
 *
 * EN KLICKAD NOTIS FORSVINNER. Att klicka ar att ta hand om posten, och da ska
 * den inte ligga kvar och tranga ut nasta. Den tas bort ur listan har och
 * bokfors i `notification_dismissed` (0038) sa att den ar borta aven efter en
 * omladdning.
 *
 * Borttagningen sker DIREKT och utan att invanta servern. Klicket navigerar
 * samtidigt, sa den som backar tillbaka gor det till en lista som redan ar
 * uppdaterad — och gick skrivningen fel ar det varsta som hant att posten kommer
 * tillbaka vid nasta sidladdning. Det ar ratt hall att fela at: en notis for
 * mycket ar en irritation, en notis for lite ar nagot som aldrig blir gjort.
 *
 * VAD SOM INTE FORSVINNER: allt det andra. Den okvitterade rutinen star kvar pa
 * `/rutiner`, den ogjorda kursen pa `/utbildning`, den obeslutade ansokan pa
 * `/franvaro` och pa startsidans "Att gora". Klockan ar pafarten, inte
 * bokforingen.
 *
 * UNDANTAGET AR `bekraftas`. Navets slapplista (`src/navnyheter/`) har ingen
 * andra plats dar posten ligger kvar — texten ar hela saken. Att klicka pa den
 * ar att GA OCH LASA, inte att ha last, sa den posten star kvar i klockan tills
 * mottagaren tryckt "Jag har last det har" under texten. Bada knapparna skriver
 * samma rad i `notification_dismissed`, sa den forsvinner ur klockan och ur
 * listan pa /nyheter i samma ogonblick.
 */
export function Notisklocka({ notiser }: { notiser: Notis[] }) {
  const [oppen, setOppen] = useState(false);
  const [frysta, setFrysta] = useState<string[] | null>(null);
  const [allaLasta, setAllaLasta] = useState(false);
  const [avfardade, setAvfardade] = useState<Set<string>>(() => new Set());
  const [, startOvergang] = useTransition();
  const router = useRouter();
  const rutan = useRef<HTMLDivElement>(null);

  /**
   * Ny lista fran servern = glom det vi bestamt sjalva.
   *
   * Utan det haller `allaLasta` i sig efter en `router.refresh()`, och nasta
   * post som faktiskt ar ny hade kommit in utan prick. Servern har redan
   * skrivit "senast sedd" nar listan hamtas om, sa dess svar och vart eget
   * sager samma sak — det ar bara servern som fortsatter ha ratt efterat.
   */
  useEffect(() => {
    setAllaLasta(false);
  }, [notiser]);

  const synliga = notiser.filter((n) => !avfardade.has(n.id));
  const arOlast = (n: Notis) => !allaLasta && (frysta ? frysta.includes(n.id) : n.olast);
  const olasta = synliga.filter(arOlast).length;

  /**
   * Krysset: raden bort, panelen kvar.
   *
   * `bekraftas` galler INTE har, och det ar hela skillnaden mot klicket nedan.
   * En slapplistepost star kvar nar man gar och laser den, for klicket betyder
   * "jag gar dit" och inte "jag har last". Krysset betyder daremot uttryckligen
   * "den har behover jag inte se" — och da ska den ga bort, precis som allt
   * annat i listan.
   */
  function avfarda(n: Notis) {
    setAvfardade((forra) => new Set(forra).add(n.id));
    startOvergang(async () => {
      await avfardaNotisen(n.id);
    });
  }

  /** Klick pa sjalva posten: panelen stangs och navigeringen gar. */
  function avfardaOchStang(n: Notis) {
    // Panelen stangs alltid — klicket navigerar, och en meny som star kvar over
    // sidan man just bad om ar bara i vagen.
    setOppen(false);
    setFrysta(null);

    if (n.bekraftas) return;
    avfarda(n);
  }

  /**
   * Prickarna slacks HAR OCH NU, inte nar servern svarat.
   *
   * `markeraNotiserLasta()` skriver samma tidpunkt som oppningen redan skrev,
   * sa anropet ar strangt taget overflodigt — men det kostar ingenting och gor
   * knappen sann aven om oppningens skrivning foll. Det som gor prickarna borta
   * for gott ar `olast`-regeln i `hamtaNotiser()`: en post ar olast bara om den
   * ar nyare an "senast oppnad", och efter det har anropet ar ingen det.
   */
  function markeraAllaLasta() {
    setAllaLasta(true);
    startOvergang(async () => {
      await markeraNotiserLasta();
      router.refresh();
    });
  }

  function vaxla() {
    if (oppen) {
      setOppen(false);
      setFrysta(null);
      return;
    }

    setFrysta(synliga.filter((n) => n.olast).map((n) => n.id));
    setOppen(true);

    if (olasta > 0) {
      startOvergang(async () => {
        await markeraNotiserLasta();
        router.refresh();
      });
    }
  }

  useEffect(() => {
    if (!oppen) return;

    function vidKlick(e: MouseEvent) {
      if (rutan.current && !rutan.current.contains(e.target as Node)) {
        setOppen(false);
        setFrysta(null);
      }
    }
    function vidTangent(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOppen(false);
        setFrysta(null);
      }
    }

    document.addEventListener("mousedown", vidKlick);
    document.addEventListener("keydown", vidTangent);
    return () => {
      document.removeEventListener("mousedown", vidKlick);
      document.removeEventListener("keydown", vidTangent);
    };
  }, [oppen]);

  return (
    <div ref={rutan} className="relative shrink-0">
      <button
        type="button"
        onClick={vaxla}
        data-guide="topp.notiser"
        aria-haspopup="dialog"
        aria-expanded={oppen}
        aria-label={olasta > 0 ? `Notiser, ${olasta} nya` : "Notiser"}
        className="relative grid size-11 place-items-center rounded-full text-ink-700 transition-colors duration-fast hover:bg-surface"
      >
        <Ikon namn="klocka" />
        {olasta > 0 && (
          <>
            {/* AC-U5.2: farg ensam far inte bara betydelsen. Siffran star i
                knappens aria-label, och prickens innehall lases upp. */}
            <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-micro tabular-nums text-accent-ink">
              {olasta > 9 ? "9+" : olasta}
            </span>
            <span className="sr-only">{olasta} olästa</span>
          </>
        )}
      </button>

      {oppen && (
        <div
          role="dialog"
          aria-label="Notiser"
          className={cn(
            "absolute right-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-2rem))]",
            "overflow-hidden rounded-md bg-surface shadow-elev-2",
          )}
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-canvas px-4 py-3">
            <h2 className="text-small font-semibold text-ink-900">Notiser</h2>
            {olasta > 0 ? (
              <button
                type="button"
                onClick={markeraAllaLasta}
                className="shrink-0 rounded-sm text-micro font-medium uppercase tracking-wide text-accent underline-offset-2 transition-colors duration-fast hover:underline"
              >
                Markera alla som lästa
              </button>
            ) : (
              <span className="text-micro uppercase text-ink-500">
                {synliga.length === 0 ? "Inget nytt" : `${synliga.length} senaste`}
              </span>
            )}
          </div>

          {synliga.length === 0 ? (
            <p className="px-4 py-8 text-center text-small text-ink-500">
              Ingenting väntar på dig just nu.
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {synliga.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "flex items-stretch border-b border-canvas last:border-0",
                    arOlast(n) ? "bg-accent-tint/40" : "",
                  )}
                >
                  {/*
                    Lanken och krysset ar SYSKON, inte inbaddade i varandra.
                    En <button> inuti en <a> ar ogiltig HTML och ger olika
                    beteende i olika lasare — i praktiken en lank som ibland
                    navigerar nar man kryssar.
                  */}
                  <Link
                    href={n.href}
                    onClick={() => avfardaOchStang(n)}
                    className={cn(
                      "flex min-h-14 flex-1 items-start gap-3 py-3 pl-4 pr-2 transition-colors duration-fast",
                      arOlast(n) ? "hover:bg-accent-tint/70" : "hover:bg-canvas",
                    )}
                  >
                    <Ikon namn={TYP_IKON[n.typ]} className="mt-0.5 size-4 shrink-0 text-ink-500" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-small font-semibold text-ink-900">
                          {n.rubrik}
                        </span>
                        <span className="ml-auto shrink-0 text-micro text-ink-500">
                          {narTid(n.tidpunkt)}
                        </span>
                      </span>
                      <span className="block truncate text-small text-ink-500">
                        {TYP_ETIKETT[n.typ]} · {n.detalj}
                      </span>
                    </span>
                    {arOlast(n) && (
                      <span
                        aria-hidden
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-accent"
                      />
                    )}
                  </Link>

                  <button
                    type="button"
                    onClick={() => avfarda(n)}
                    // Rubriken star i etiketten. "Ta bort notis" tolv ganger i
                    // rad ar oanvandbart for den som lyssnar sig igenom listan.
                    aria-label={`Ta bort notisen "${n.rubrik}"`}
                    title="Ta bort"
                    className={cn(
                      "grid w-10 shrink-0 place-items-center text-ink-300",
                      "transition-colors duration-fast hover:bg-canvas hover:text-ink-700",
                    )}
                  >
                    <Ikon namn="kryss" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
