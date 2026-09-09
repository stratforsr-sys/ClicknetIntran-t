"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ikon } from "./Ikon";
import { Vypanel } from "./Vypanel";
import { Counter } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import type { Navigering, NavVy } from "./nav-items";
import { navAnkare } from "@/guider/ankare";
import { INSTALLNINGAR_START } from "./installningar-delade";
import { PANELLAGEN, PANELLAGE_TEXT, arAktiv, type Panellage } from "./sidopanel";

/**
 * UI-PRD §5.1. Mork brand-900-yta, radie lg, 16 px marginal mot fonsterkanten
 * pa alla sidor — flytande, inte kant i kant.
 * Panelen innehaller navigation och anvandare. Inget annat.
 *
 * ===========================================================================
 * TRE LÄGEN OCH TVÅ LED (2026-09-09)
 *
 * **Lägena.** `utfalld`, `hopfalld` och `hovra` — se sidopanel.ts för vad de
 * betyder. Panelen ritar dem alla med EN härledd sanning:
 *
 *     smal = hopfalld, eller hovra utan mus över panelen
 *
 * `smal` styr bara `lg:`-klasser. Under 1024 px är panelen en utdragslåda som
 * redan är borta när den inte används, och en smal låda vore en låda med samma
 * yta men utan text.
 *
 * I hovra-läget svävar panelen ut ÖVER innehållet i stället för att knuffa
 * det. Skalet håller därför kvar den smala vänstermarginalen — se Skal.tsx.
 * Alternativet vore att sidan flyttar sig varje gång musen råkar passera
 * kanten, och en text som hoppar i sidled är oläslig medan den gör det.
 *
 * **Leden.** Snabbposterna står framme. Vyerna — Min vy, Chefsvy, Adminvy —
 * öppnar en andra spalt bredvid panelen. Se nav-items.ts för vad som hamnar
 * var, och Vypanel.tsx för hur spalten ser ut.
 *
 * Flyouten stänger sig av sig själv: när man valt en sida, när musen lämnat
 * panelen, vid Escape, vid klick utanför och vid varje adressbyte. Den enda
 * vägen till en flyout som ligger kvar och skymmer är att öppna en till.
 *
 * FÖRDRÖJNINGEN PÅ VÄG UT ÄR INTE KOSMETIK. Flyouten ligger utanför panelens
 * egen ruta, med några pixlars glapp emellan. Utan fördröjning stängs den i
 * glappet, varje gång, och menyn blir omöjlig att nå med musen.
 * ===========================================================================
 *
 * PANELEN AR ALLTID EXAKT SA HOG SOM FONSTRET (`inset-y-4`), och menyn vaxer
 * med varje modul som levereras. Pa en 690 px hog vy var sjutton poster mer an
 * som fick plats, och eftersom listan saknade egen scroll klipptes den bara av:
 * de sista posterna gick inte att na, och inte heller profilen och
 * utloggningen under dem. Darfor:
 *
 * - Bara LISTAN scrollar. Logotypen, lagesvaljaren, profilen och utloggningen
 *   ar `shrink-0` och star kvar — det man behover oftast ska inte kunna rulla
 *   bort, och en utloggningsknapp man maste leta efter ar ett sakerhetsproblem.
 * - Scrollisten ar egen och alltid synlig (`.nav-scroll` i globals.css). macOS
 *   doljer sina tills man rullar, sa en avklippt lista hade sett likadan ut som
 *   fore fixen.
 * - Den aktiva posten rullas in i vy nar panelen monteras. Utan det oppnar
 *   `/design` en meny som ser ut att sta pa `Hem`.
 */

/** Millisekunder innan panelen fälls in efter att musen lämnat den. */
const UTDROJNING = 180;

export function Sidebar({
  nav,
  namn,
  roll,
  oppen,
  stang,
  lage,
  valjLage,
}: {
  nav: Navigering;
  namn: string;
  roll: string;
  oppen: boolean;
  stang: () => void;
  lage: Panellage;
  valjLage: (lage: Panellage) => void;
}) {
  const path = usePathname();

  /** Musen är över panelen. Betyder bara något i hovra-läget. */
  const [hovrar, setHovrar] = useState(false);
  const smal = lage === "hopfalld" || (lage === "hovra" && !hovrar);

  /** Doljs bara pa stora skarmar — utdragsladan visar alltid hela texten. */
  const doljText = smal ? "lg:hidden" : "";

  /** Öppen vy och vald grupp i den. `null` = ingen flyout. */
  const [oppenVy, setOppenVy] = useState<string | null>(null);
  const [valdGrupp, setValdGrupp] = useState<string | null>(null);

  const panel = useRef<HTMLElement>(null);
  const utTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stangFlyout = useCallback(() => setOppenVy(null), []);

  const oppnaVy = useCallback(
    (vy: NavVy) => {
      if (oppenVy === vy.id) {
        setOppenVy(null);
        return;
      }
      setOppenVy(vy.id);
      setValdGrupp(vy.start);
    },
    [oppenVy],
  );

  /**
   * Musen in och ut. `pointerType` provas: pa en pekskarm skickar webblasaren
   * ett `pointerenter` vid tryck som aldrig foljs av ett `pointerleave`, och
   * panelen hade da last sig i utfallt lage efter forsta tryckningen.
   */
  const musIn = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (utTimer.current) clearTimeout(utTimer.current);
    setHovrar(true);
  };

  const musUt = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (utTimer.current) clearTimeout(utTimer.current);
    utTimer.current = setTimeout(() => {
      setHovrar(false);
      setOppenVy(null);
    }, UTDROJNING);
  };

  useEffect(() => () => {
    if (utTimer.current) clearTimeout(utTimer.current);
  }, []);

  /**
   * Tangentbordet ska na samma meny som musen. Fokus in i panelen haller den
   * utfalld; fokus ut faller ihop den igen. `relatedTarget` sager vart fokus
   * tog vagen — utan den provningen stangs panelen mellan tva poster i den.
   */
  const fokusIn = () => setHovrar(true);
  const fokusUt = (e: React.FocusEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setHovrar(false);
    setOppenVy(null);
  };

  /** Adressbyte stanger flyouten. Annars star den kvar over den nya sidan. */
  useEffect(() => {
    setOppenVy(null);
  }, [path]);

  /** Escape och klick utanfor. Samma tva vagar ut som alla andra lager i navet. */
  useEffect(() => {
    if (!oppenVy) return;

    const tangent = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOppenVy(null);
    };
    const utanfor = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOppenVy(null);
    };

    document.addEventListener("keydown", tangent);
    document.addEventListener("pointerdown", utanfor);
    return () => {
      document.removeEventListener("keydown", tangent);
      document.removeEventListener("pointerdown", utanfor);
    };
  }, [oppenVy]);

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

  const aktivVy = nav.vyer.find((v) => v.id === oppenVy) ?? null;

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
        ref={panel}
        data-guide="nav.panel"
        onPointerEnter={musIn}
        onPointerLeave={musUt}
        onFocusCapture={fokusIn}
        onBlurCapture={fokusUt}
        className={cn(
          "on-dark fixed inset-y-4 left-4 z-40 flex w-64 flex-col rounded-lg bg-brand-900 p-4",
          // Ringen och skuggan gor kanten skarp mot ljust innehall, och det ar
          // viktigare nu: i hovra-laget svavar panelen OVER sidan, och en yta
          // utan kant ser da ut som ett hal i texten.
          "ring-1 ring-brand-800 shadow-elev-3",
          "transition-[transform,width] duration-base ease-brand",
          oppen ? "translate-x-0" : "-translate-x-[calc(100%+1rem)]",
          "lg:translate-x-0",
          smal && "lg:w-[4.5rem] lg:px-2",
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
            "mb-4 flex shrink-0 items-center gap-2.5 rounded-sm p-2",
            smal && "lg:justify-center lg:px-0",
          )}
        >
          {/* Smal ryms bara markorsymbolen. Den ligger i en EGEN fil och
              inte som ett utsnitt av ordbilden: ett utsnitt bygger pa exakta
              pixelmatt i en bild vi inte ager, och gar sonder tyst nasta gang
              logotypen byts ut. */}
          {smal && (
            <img
              src="/clicknet-symbol.png"
              alt=""
              width={157}
              height={200}
              className="hidden h-9 w-auto shrink-0 lg:block"
            />
          )}
          {/* width/height ar bildens riktiga matt. De styr ingenting visuellt
              — h-8 gor det — men de ger webblasaren proportionen i forvag, sa
              menyn inte hoppar till nar filen har laddat.

              h-8 ger ordbilden 139 px bredd. Med gap, "Nav" och lankens p-2
              blir lockupen 203 px i en panel som har 224 px innanfor sin
              padding — det ar sa stort den kan bli utan att bli trang. */}
          <img
            src="/clicknet.png"
            alt=""
            width={868}
            height={200}
            className={cn("h-8 w-auto shrink-0", doljText)}
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

            Omslaget finns for toningarna OCH for flyouten. Toningarna maste
            ligga utanfor det som rullar — inuti hade de rullat med och tonat
            bort en post i taget i stallet for kanten. Flyouten maste ligga
            utanfor av ett hardare skal: `overflow-y-auto` klipper allt som
            sticker ut, och en svavande panel bredvid listan hade blivit
            avskuren vid panelens kant. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <nav
            ref={lista}
            onScroll={matMer}
            className={cn(
              // Den negativa hogermarginalen lagger scrollisten i panelens
              // kant i stallet for inne i texten.
              "nav-scroll -mr-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-2 pb-1",
              smal && "lg:-mr-1 lg:pr-1",
            )}
            aria-label="Huvudmeny"
          >
            {nav.snabb.map((item) => {
              const aktiv = arAktiv(path, item.href);
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
                  // Smal ar ikonen allt som star kvar. Utan title blir
                  // menyn en rad symboler man far gissa sig till.
                  title={smal ? item.label : undefined}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-3 rounded-full px-4 text-body",
                    "transition-colors duration-fast ease-brand",
                    smal && "lg:justify-center lg:px-0",
                    aktiv
                      ? "bg-brand-800 font-semibold text-ink-inv ring-1 ring-inset ring-brand-700"
                      : "text-brand-200 hover:bg-brand-800/60 hover:text-ink-inv",
                  )}
                >
                  <Ikon namn={item.ikon} className={cn("size-5 shrink-0", aktiv && "text-brand-400")} />
                  <span className={cn("flex-1 whitespace-nowrap", doljText)}>{item.label}</span>
                  {item.raknare ? <Counter antal={item.raknare} /> : null}
                </Link>
              );
            })}

            {/* Vyerna. Skiljelinjen sager att det som foljer inte ar fler
                sidor utan fler MENYER — utan den las de tre posterna som tre
                lankar till, och da undrar man varfor de inte oppnar nagot. */}
            {nav.vyer.length > 0 && (
              <div className="my-2 shrink-0 border-t border-brand-800" aria-hidden />
            )}

            {nav.vyer.map((vy) => {
              const oppenHar = oppenVy === vy.id;
              // Star man PA en sida som ligger i vyn ska vyn se ut att bara
              // den. Annars ser menyn ut att sta pa Hem sa fort man oppnat
              // nagot som inte ar en snabbpost.
              const barAktiv = vy.grupper.some((g) => g.poster.some((p) => arAktiv(path, p.href)));
              const raknare = vy.grupper.reduce(
                (s, g) => s + g.poster.reduce((t, p) => t + (p.raknare ?? 0), 0),
                0,
              );

              return (
                <div key={vy.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => oppnaVy(vy)}
                    aria-expanded={oppenHar}
                    aria-controls={`vy-${vy.id}`}
                    title={smal ? vy.etikett : undefined}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-full px-4 text-body",
                      "transition-colors duration-fast ease-brand",
                      smal && "lg:justify-center lg:px-0",
                      oppenHar || barAktiv
                        ? "bg-brand-800 font-semibold text-ink-inv ring-1 ring-inset ring-brand-700"
                        : "bg-brand-800/30 text-brand-200 hover:bg-brand-800/60 hover:text-ink-inv",
                    )}
                  >
                    <Ikon
                      namn={vy.ikon}
                      className={cn("size-5 shrink-0", (oppenHar || barAktiv) && "text-brand-400")}
                    />
                    <span className={cn("flex-1 text-left whitespace-nowrap", doljText)}>
                      {vy.etikett}
                    </span>
                    {raknare ? <Counter antal={raknare} /> : null}
                    <Ikon
                      namn="fram"
                      className={cn(
                        "size-4 shrink-0 text-brand-400 transition-transform duration-fast",
                        doljText,
                        oppenHar && "rotate-90",
                      )}
                    />
                  </button>

                  {/* Telefonens variant: vyn fäller ut INUTI lådan. En
                      svävande spalt bredvid en 16 rem bred låda på en 20 rem
                      bred skärm hade hamnat utanför fönstret.

                      Utan `data-guide` med flit — se Vypanel.tsx. */}
                  {oppenHar && (
                    <Vypanel
                      vy={vy}
                      vald={valdGrupp}
                      valj={setValdGrupp}
                      path={path}
                      stang={() => {
                        stangFlyout();
                        stang();
                      }}
                      ankare={false}
                      className="mt-1 rounded-md bg-brand-950/60 p-2 lg:hidden"
                    />
                  )}
                </div>
              );
            })}
          </nav>

          {/* Datorns variant: svävar bredvid panelen, ovanpå innehållet.
              `left-full` följer panelens bredd av sig själv, så den sitter rätt
              både när panelen är smal och när den är utfälld. */}
          {aktivVy && (
            <div
              id={`vy-${aktivVy.id}`}
              className={cn(
                "absolute top-0 left-full z-50 ml-2 hidden max-h-full w-[19rem] flex-col",
                "rounded-lg bg-brand-950 p-3 ring-1 ring-brand-800 shadow-elev-4 lg:flex",
              )}
            >
              <Vypanel
                vy={aktivVy}
                vald={valdGrupp}
                valj={setValdGrupp}
                path={path}
                stang={stangFlyout}
                ankare
              />
            </div>
          )}

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

        {/* Lagesvaljaren finns bara dar panelen star kvar av sig sjalv. */}
        <Lagesvaljare lage={lage} valjLage={valjLage} smal={smal} />

        {/* Skiljelinjen sitter pa den har och inte pa listan: den ska ligga
            still mot botten, inte folja med det som rullar forbi. */}
        <div className="mt-4 shrink-0 border-t border-brand-800 pt-4">
          <div className={cn("flex items-center gap-2 px-2", smal && "lg:flex-col lg:gap-1 lg:px-0")}>
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
              title={smal ? `${namn} — inställningar` : "Inställningar"}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3 rounded-full py-1 pr-2 text-left transition-colors duration-fast hover:bg-brand-800/60",
                smal && "lg:flex-none lg:pr-0",
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

/**
 * Valjaren for panelens lage.
 *
 * Utfalld ar den tre knappar bredvid varandra: alla tre lagen syns, och man
 * byter till det man vill ha med ETT tryck. Smal finns inte den bredden — da
 * blir det en knapp som stegar vidare, med nasta lages namn i sin `title`.
 *
 * `radiogroup` och inte tre `switch`: lagena utesluter varandra, och en
 * skarmlasare ska sagas ETT lage av tre, inte tre pa/av som rakar hanga ihop.
 */
function Lagesvaljare({
  lage,
  valjLage,
  smal,
}: {
  lage: Panellage;
  valjLage: (lage: Panellage) => void;
  smal: boolean;
}) {
  const nasta = PANELLAGEN[(PANELLAGEN.indexOf(lage) + 1) % PANELLAGEN.length];

  return (
    <>
      <div
        role="radiogroup"
        aria-label="Sidopanelens läge"
        className={cn(
          "mt-4 hidden shrink-0 gap-1 rounded-full bg-brand-950/60 p-1 lg:flex",
          smal && "lg:hidden",
        )}
      >
        {PANELLAGEN.map((id) => {
          const text = PANELLAGE_TEXT[id];
          const vald = id === lage;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={vald}
              onClick={() => valjLage(id)}
              title={text.hjalp}
              className={cn(
                "flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-micro font-semibold",
                "transition-colors duration-fast ease-brand",
                vald
                  ? "bg-brand-800 text-ink-inv ring-1 ring-inset ring-brand-700"
                  : "text-brand-200 hover:bg-brand-800/60 hover:text-ink-inv",
              )}
            >
              <Ikon namn={text.ikon} className={cn("size-4 shrink-0", vald && "text-brand-400")} />
              {text.namn}
            </button>
          );
        })}
      </div>

      {/* Smal: en knapp som stegar. Den star bara pa dator, av samma skal som
          hela valjaren — utdragsladan har inget lage att stalla om. */}
      <button
        type="button"
        onClick={() => valjLage(nasta)}
        title={`Panel: ${PANELLAGE_TEXT[lage].namn}. Byt till ${PANELLAGE_TEXT[nasta].namn.toLowerCase()}.`}
        aria-label={`Sidopanelens läge: ${PANELLAGE_TEXT[lage].namn}. Byt till ${PANELLAGE_TEXT[nasta].namn.toLowerCase()}.`}
        className={cn(
          "mt-4 hidden min-h-11 shrink-0 place-items-center rounded-full",
          "text-brand-200 transition-colors duration-fast hover:bg-brand-800/60 hover:text-ink-inv",
          smal && "lg:grid",
        )}
      >
        <Ikon namn={PANELLAGE_TEXT[lage].ikon} className="size-5" />
      </button>
    </>
  );
}
