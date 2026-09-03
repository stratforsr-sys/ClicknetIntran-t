"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ikon } from "./Ikon";
import { Counter } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import type { NavItem } from "./nav-items";
import { navAnkare } from "@/guider/ankare";
import { INSTALLNINGAR_START } from "./installningar-delade";

/**
 * UI-PRD §5.1. Mork brand-900-yta, radie lg, 16 px marginal mot fonsterkanten
 * pa alla sidor — flytande, inte kant i kant.
 * Panelen innehaller navigation och anvandare. Inget annat.
 *
 * §5.1 vill ocksa att den ska ga att falla ihop. Hopfalld visar den bara
 * ikoner, och bara fran 1024 px och uppat: under den breadden ar panelen en
 * utdragslada som redan ar borta nar den inte anvands, och en ihopfalld lada
 * vore en lada med samma yta men utan text.
 *
 * PANELEN AR ALLTID EXAKT SA HOG SOM FONSTRET (`inset-y-4`), och menyn vaxer
 * med varje modul som levereras. Pa en 690 px hog vy var sjutton poster mer an
 * som fick plats, och eftersom listan saknade egen scroll klipptes den bara av:
 * de sista posterna gick inte att na, och inte heller profilen och
 * utloggningen under dem. Darfor:
 *
 * - Bara LISTAN scrollar. Logotypen, hopfallningen, profilen och utloggningen
 *   ar `shrink-0` och star kvar — det man behover oftast ska inte kunna rulla
 *   bort, och en utloggningsknapp man maste leta efter ar ett sakerhetsproblem.
 * - Scrollisten ar egen och alltid synlig (`.nav-scroll` i globals.css). macOS
 *   doljer sina tills man rullar, sa en avklippt lista hade sett likadan ut som
 *   fore fixen.
 * - Den aktiva posten rullas in i vy nar panelen monteras. Utan det oppnar
 *   `/design` en meny som ser ut att sta pa `Hem`.
 */
export function Sidebar({
  items,
  namn,
  roll,
  oppen,
  stang,
  hopfalld,
  vaxlaHopfalld,
}: {
  items: NavItem[];
  namn: string;
  roll: string;
  oppen: boolean;
  stang: () => void;
  hopfalld: boolean;
  vaxlaHopfalld: () => void;
}) {
  const path = usePathname();

  /** Doljs bara pa stora skarmar — utdragsladan visar alltid hela texten. */
  const doljText = hopfalld ? "lg:hidden" : "";

  /**
   * Rulla fram den aktiva posten. `nearest` och inte `center`: star posten
   * redan i vy ska ingenting rora sig, och pa en skarm dar hela listan far
   * plats ska panelen se ut precis som fore.
   *
   * Kors bara vid montering. Klickar man sig runt i navet ligger listan kvar
   * dar man lamnade den, vilket ar vad man forvantar sig — det ar ombytet till
   * en djuplank eller en omladdning som behover hjalpen.
   */
  const lista = useRef<HTMLElement>(null);

  /**
   * Toningar i over- och underkant nar det finns mer att rulla till.
   *
   * Scrollisten ensam racker inte. Den ar 6 px bred pa en mork platta, och
   * det var att INTE se att listan fortsatte som var hela felet. En post som
   * tonar bort mot kanten sager samma sak med hela radens bredd.
   */
  const [mer, setMer] = useState({ upp: false, ner: false });

  const matMer = useCallback(() => {
    const el = lista.current;
    if (!el) return;
    // 1 px slack: delpixlar gor att scrollTop sallan nar exakt sitt maxvarde,
    // och utan slacken blir den nedre toningen kvar for evigt.
    setMer({
      upp: el.scrollTop > 1,
      ner: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  }, []);

  useEffect(() => {
    const el = lista.current;
    if (!el) return;

    el.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
    matMer();

    // Fonstret kan andra hojd utan att listan rors — da andras svaret anda.
    const obs = new ResizeObserver(matMer);
    obs.observe(el);
    return () => obs.disconnect();
  }, [matMer]);

  return (
    <>
      {/* Under 1024 px dras panelen in over innehallet. */}
      {oppen && (
        <button
          type="button"
          aria-label="Stäng menyn"
          onClick={stang}
          className="fixed inset-0 z-30 bg-ink-900/40 lg:hidden"
        />
      )}

      <aside
        data-guide="nav.panel"
        className={cn(
          "on-dark fixed inset-y-4 left-4 z-40 flex w-64 flex-col rounded-lg bg-brand-900 p-4",
          "transition-[transform,width] duration-base ease-brand",
          oppen ? "translate-x-0" : "-translate-x-[calc(100%+1rem)]",
          "lg:translate-x-0",
          hopfalld && "lg:w-[4.5rem] lg:px-2",
        )}
      >
        {/*
          AC-U1.2/1.3: logotypen ar en <a> till /, fungerar med mittenklick.

          Ordbilden ar `clicknet-vit` fran clicknet.se — den variant som ar
          ritad for morka ytor, och darfor den enda som fungerar mot brand-900.
          Den ritas oforandrad. "Nav" star kvar som TEXT bredvid den: det ar
          produktnamnet, inte varumarket, och da ska det ga att andra utan att
          nagon oppnar en bildredigerare.

          Bilderna har `alt=""` med flit. Lanken bar redan hela namnet i sitt
          aria-label, och en alt-text hade last upp varumarket en gang till.
        */}
        <Link
          href="/"
          aria-label="Clicknet Nav — till startsidan"
          className={cn(
            "mb-6 flex shrink-0 items-center gap-2.5 rounded-sm p-2",
            hopfalld && "lg:justify-center lg:px-0",
          )}
        >
          {/* Hopfalld ryms bara markorsymbolen. Den ligger i en EGEN fil och
              inte som ett utsnitt av ordbilden: ett utsnitt bygger pa exakta
              pixelmatt i en bild vi inte ager, och gar sonder tyst nasta gang
              logotypen byts ut. */}
          {hopfalld && (
            <img
              src="/clicknet-symbol.png"
              alt=""
              width={157}
              height={200}
              className="hidden h-8 w-auto shrink-0 lg:block"
            />
          )}
          {/* width/height ar bildens riktiga matt. De styr ingenting visuellt
              — h-7 gor det — men de ger webblasaren proportionen i forvag, sa
              menyn inte hoppar till nar filen har laddat. */}
          <img
            src="/clicknet.png"
            alt=""
            width={868}
            height={200}
            className={cn("h-7 w-auto shrink-0", doljText)}
          />
          <span
            className={cn(
              "font-display text-h2 leading-none whitespace-nowrap text-ink-inv",
              doljText,
            )}
          >
            Nav
          </span>
        </Link>

        {/* `min-h-0` pa BADA leden ar det som far scrollen att fungera: utan
            den vagrar en flex-post krympa under sitt innehall, och
            `overflow-y-auto` far aldrig nagot att gora.

            Omslaget finns for toningarna. De maste ligga utanfor det som
            rullar — inuti hade de rullat med och tonat bort en post i taget
            i stallet for kanten. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <nav
            ref={lista}
            onScroll={matMer}
            className={cn(
              // Den negativa hogermarginalen lagger scrollisten i panelens
              // kant i stallet for inne i texten.
              "nav-scroll -mr-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-2 pb-1",
              hopfalld && "lg:-mr-1 lg:pr-1",
            )}
            aria-label="Huvudmeny"
          >
            {items.map((item) => {
              const aktiv = item.href === "/" ? path === "/" : path.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={stang}
                  // Guidade turer pekar pa menyposter via adressen, inte via
                  // etiketten: /avtal heter "Avtal" for chefen och "Mitt avtal"
                  // for alla andra. Se src/guider/ankare.ts.
                  data-guide={navAnkare(item.href)}
                  aria-current={aktiv ? "page" : undefined}
                  // Hopfalld ar ikonen allt som star kvar. Utan title blir
                  // menyn en rad symboler man far gissa sig till.
                  title={hopfalld ? item.label : undefined}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-3 rounded-full px-4 text-body",
                    "transition-colors duration-fast ease-brand",
                    hopfalld && "lg:justify-center lg:px-0",
                    aktiv
                      ? "bg-brand-800 font-semibold text-ink-inv"
                      : "text-brand-200 hover:bg-brand-800/60 hover:text-ink-inv",
                  )}
                >
                  <Ikon namn={item.ikon} />
                  <span className={cn("flex-1 whitespace-nowrap", doljText)}>{item.label}</span>
                  {item.raknare ? <Counter antal={item.raknare} /> : null}
                </Link>
              );
            })}
          </nav>

          {/* Dekoration, darfor `aria-hidden`: en skarmlasare far redan veta
              att listan fortsatter genom att posterna finns i tradet. */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-brand-900 to-transparent",
              "transition-opacity duration-fast ease-brand",
              mer.upp ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-brand-900 to-transparent",
              "transition-opacity duration-fast ease-brand",
              mer.ner ? "opacity-100" : "opacity-0",
            )}
          />
        </div>

        {/* Vaxeln finns bara dar panelen star kvar av sig sjalv. */}
        <button
          type="button"
          onClick={vaxlaHopfalld}
          aria-expanded={!hopfalld}
          aria-label={hopfalld ? "Fäll ut menyn" : "Fäll ihop menyn"}
          title={hopfalld ? "Fäll ut menyn" : "Fäll ihop menyn"}
          className={cn(
            "mt-4 hidden min-h-11 shrink-0 items-center gap-3 rounded-full px-4 text-small",
            "text-brand-200 transition-colors duration-fast hover:bg-brand-800/60 hover:text-ink-inv",
            "lg:flex",
            hopfalld && "lg:justify-center lg:px-0",
          )}
        >
          <Ikon
            namn="tillbaka"
            className={cn("size-5 shrink-0 transition-transform duration-base", hopfalld && "rotate-180")}
          />
          <span className={cn("whitespace-nowrap", doljText)}>Fäll ihop</span>
        </button>

        {/* Skiljelinjen sitter pa den har och inte pa listan: den ska ligga
            still mot botten, inte folja med det som rullar forbi. */}
        <div className="mt-4 shrink-0 border-t border-brand-800 pt-4">
          <div
            className={cn(
              "flex items-center gap-2 px-2",
              hopfalld && "lg:flex-col lg:gap-1 lg:px-0",
            )}
          >
            {/*
              Profilbilden ar vagen till installningarna. Det ar dar folk
              letar, och det ar den vana bade macOS och Claude bygger pa.

              LANK OCH INTE KNAPP, till skillnad fran forsta versionen. Rutan
              ar numera en rutt: klickar man har oppnas den ovanpa sidan man
              star pa, laddar man om samma adress far man den som helsida. En
              riktig <a> ar da inte bara arligare mot mittenklick, "oppna i ny
              flik" och skarmlasare — den ar det som far bada lagena att
              fungera. Se src/app/(app)/@ruta/.

              `scroll={false}`: sidan under rutan ska ligga kvar dar den lag.
            */}
            <Link
              href={INSTALLNINGAR_START}
              data-guide="nav.profil"
              scroll={false}
              onClick={stang}
              aria-current={path.startsWith("/profil") ? "page" : undefined}
              title={hopfalld ? `${namn} — inställningar` : "Inställningar"}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3 rounded-full py-1 pr-2 text-left transition-colors duration-fast hover:bg-brand-800/60",
                hopfalld && "lg:flex-none lg:pr-0",
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-800 text-small font-semibold text-brand-200">
                {namn
                  .split(" ")
                  .map((d) => d.charAt(0))
                  .slice(0, 2)
                  .join("")}
              </span>
              <span className={cn("min-w-0 flex-1", doljText)}>
                <span className="block truncate text-small font-semibold text-ink-inv">{namn}</span>
                <span className="block truncate text-micro uppercase text-brand-200">{roll}</span>
              </span>
            </Link>
            <form action="/auth/logga-ut" method="post">
              <button
                type="submit"
                aria-label="Logga ut"
                title="Logga ut"
                // AC-U5.5: minsta traffyta 44x44 px. Ikonen ar mindre an sa,
                // men klickytan far inte vara det.
                className="grid size-11 place-items-center rounded-full text-brand-200 transition-colors duration-fast hover:bg-brand-800 hover:text-ink-inv"
              >
                <Ikon namn="ut" />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
