"use client";

import { useEffect, useRef, type RefObject } from "react";
import { cn } from "@/components/ui/cn";
import { Ikon } from "@/components/shell/Ikon";

export type Replik = {
  id: string;
  author_id: string;
  namn: string;
  body: string;
  created_at: string;
};

/**
 * Själva tråden — bubblorna, grupperingen och skrollen.
 *
 * ===========================================================================
 * EN CHATTRUTA, INTE ETT KOMMENTARSFÄLT
 *
 * Skillnaden är inte dekoration. Ett kommentarsfält är en rad man lämnar efter
 * sig; en chatt är ett rum man går in i. Tre saker gör den skillnaden:
 *
 *   1. TRÅDEN HAR EGEN HÖJD OCH SKROLLAR I SIG SJÄLV, med det senaste längst
 *      ned och synligt direkt. En lista som växer nedåt på sidan gör att
 *      skrivfältet vandrar längre bort ju mer man pratar.
 *   2. REPLIKER GRUPPERAS PER PERSON, DAG OCH PAUS. Fem repliker i rad från
 *      samma person är ett stycke, inte fem kort med namn och klockslag på var
 *      och en — upprepningen döljer vem som faktiskt svarade.
 *   3. DET FINNS EN GRÄNS FÖR "SEDAN DU VAR HÄR" där någon håller reda på det.
 *
 * ----------------------------------------------------------------------------
 * EGEN FIL, för att projektet och uppgiften ska rita samma tråd
 *
 * De två skiljer sig i allt annat: projektets chatt har läsmarkering och en
 * egen tabell, uppgiftens repliker är rader i händelseloggen och har ingen.
 * Men bubblorna, grupperingen och dagstrecken ska se likadana ut — två kopior
 * hade betytt att den dag den ena lär sig något nytt ser samtalet olika ut
 * beroende på var man står.
 * ===========================================================================
 */
export function Trad({
  repliker,
  mig,
  forstaOlasta = null,
  tomRubrik,
  tomText,
  hog = true,
}: {
  repliker: Replik[];
  mig: string;
  /** Id:t där strecket "Nytt sedan du var här" ritas. Null = inget streck. */
  forstaOlasta?: string | null;
  tomRubrik: string;
  tomText: string;
  /** Full höjd för ett projektrum; lägre för uppgiftens kortare tråd. */
  hog?: boolean;
}) {
  const traden = useRef<HTMLDivElement>(null);

  // Längst ned direkt. En tråd som öppnas högst upp kräver att man skrollar
  // för att se det som föranledde notisen.
  useEffect(() => {
    const el = traden.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [repliker.length]);

  const grupper = gruppera(repliker);

  return (
    <div
      ref={traden}
      className={cn(
        "flex flex-col gap-1 overflow-y-auto rounded-md bg-canvas px-3 py-4",
        hog ? "max-h-[28rem] min-h-[14rem]" : "max-h-[22rem] min-h-[8rem]",
      )}
    >
      {repliker.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <Ikon namn="chatt" className="size-8 text-ink-300" />
          <p className="text-body text-ink-500">{tomRubrik}</p>
          <p className="max-w-[38ch] text-small text-ink-300">{tomText}</p>
        </div>
      ) : (
        grupper.map((g) =>
          g.sort === "dag" ? (
            <Dagstrecket key={g.nyckel} text={g.text} />
          ) : (
            <Grupp
              key={g.nyckel}
              repliker={g.repliker}
              egen={g.repliker[0].author_id === mig}
              forstaOlasta={forstaOlasta}
            />
          ),
        )
      )}
    </div>
  );
}

function Grupp({
  repliker,
  egen,
  forstaOlasta,
}: {
  repliker: Replik[];
  egen: boolean;
  forstaOlasta: string | null;
}) {
  const forsta = repliker[0];
  const sista = repliker[repliker.length - 1];

  return (
    <>
      {forstaOlasta !== null && repliker.some((r) => r.id === forstaOlasta) && <Olastrecket />}

      <div className={cn("flex gap-2 pt-2", egen ? "flex-row-reverse" : "flex-row")}>
        {/* Initialerna står bara på andras repliker. Att se sin egen symbol
            bredvid varje sak man själv skrivit säger ingenting. */}
        {!egen && (
          <span
            aria-hidden
            className="mt-auto flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-micro font-semibold text-brand-ink"
          >
            {initialer(forsta.namn)}
          </span>
        )}

        <div className={cn("flex min-w-0 flex-col gap-0.5", egen ? "items-end" : "items-start")}>
          {!egen && <span className="px-1 text-micro text-ink-500">{forsta.namn}</span>}

          {repliker.map((r, i) => (
            <p
              key={r.id}
              className={cn(
                "max-w-[42ch] px-3.5 py-2 text-body break-words whitespace-pre-line",
                egen ? "bg-brand-600 text-ink-inv" : "bg-surface text-ink-900 shadow-elev-1",
                // Bubblorna i en grupp hakar i varandra: bara den första och
                // den sista får rundade hörn mot utsidan.
                egen
                  ? cn(
                      "rounded-l-lg",
                      i === 0 ? "rounded-tr-lg" : "rounded-tr-sm",
                      i === repliker.length - 1 ? "rounded-br-lg" : "rounded-br-sm",
                    )
                  : cn(
                      "rounded-r-lg",
                      i === 0 ? "rounded-tl-lg" : "rounded-tl-sm",
                      i === repliker.length - 1 ? "rounded-bl-lg" : "rounded-bl-sm",
                    ),
              )}
            >
              {r.body}
            </p>
          ))}

          <span className="px-1 text-micro text-ink-300">{klockslag(sista.created_at)}</span>
        </div>
      </div>
    </>
  );
}

function Dagstrecket({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="h-px flex-1 bg-ink-300/40" />
      <span className="text-micro text-ink-500 uppercase">{text}</span>
      <span className="h-px flex-1 bg-ink-300/40" />
    </div>
  );
}

function Olastrecket() {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="h-px flex-1 bg-accent" />
      <span className="text-micro font-semibold text-accent-ink uppercase">Nytt sedan du var här</span>
      <span className="h-px flex-1 bg-accent" />
    </div>
  );
}

// -----------------------------------------------------------------------------

type Post =
  | { sort: "dag"; nyckel: string; text: string }
  | { sort: "grupp"; nyckel: string; repliker: Replik[] };

/**
 * Repliker till dagsrubriker och stycken.
 *
 * EN NY GRUPP NÄR AVSÄNDAREN BYTS, NÄR DAGEN BYTS, ELLER NÄR DET GÅTT MER ÄN EN
 * KVART. Tidsgränsen är den minst uppenbara av de tre och den viktigaste: utan
 * den klistras ett svar tre timmar senare ihop med morgonens fråga, och
 * samtalet ser ut att ha skett i ett svep.
 *
 * Förutsätter att replikerna kommer i tidsordning, äldst först.
 */
function gruppera(repliker: Replik[]): Post[] {
  const ut: Post[] = [];
  let dag = "";
  let nuvarande: Replik[] = [];

  const stang = () => {
    if (nuvarande.length > 0) {
      ut.push({ sort: "grupp", nyckel: nuvarande[0].id, repliker: nuvarande });
      nuvarande = [];
    }
  };

  for (const m of repliker) {
    const mittDag = svensktDatum(m.created_at);

    if (mittDag !== dag) {
      stang();
      dag = mittDag;
      ut.push({ sort: "dag", nyckel: `dag-${mittDag}`, text: dagsrubrik(mittDag) });
    }

    const forra = nuvarande[nuvarande.length - 1];
    const langtEmellan = forra && Date.parse(m.created_at) - Date.parse(forra.created_at) > 15 * 60_000;

    if (forra && (forra.author_id !== m.author_id || langtEmellan)) stang();

    nuvarande.push(m);
  }

  stang();
  return ut;
}

/**
 * Svensk väggtid, i webbläsaren.
 *
 * `src/lib/klocka.ts` gör samma sak på servern och importeras inte hit — den
 * hör till serversidan, och tiderna ska ändå visas i svensk tid oavsett var
 * mottagarens dator råkar stå. `Intl` med uttrycklig zon ger samma svar
 * överallt, vilket är hela poängen: en replik skriven 14:03 i Stockholm ska
 * stå 14:03 även för den som sitter någon annanstans.
 */
function svensktDatum(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date(iso));
}

function klockslag(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function dagsrubrik(datum: string): string {
  const nu = new Date();
  const idag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(nu);
  if (datum === idag) return "Idag";

  const igar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(
    new Date(nu.getTime() - 86_400_000),
  );
  if (datum === igar) return "I går";

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${datum}T12:00:00.000Z`));
}

function initialer(namn: string): string {
  const delar = namn.trim().split(/\s+/);
  const forsta = delar[0]?.charAt(0) ?? "";
  const sista = delar.length > 1 ? (delar[delar.length - 1]?.charAt(0) ?? "") : "";
  return (forsta + sista).toUpperCase() || "?";
}

/**
 * Skrivfältet.
 *
 * ENTER SKICKAR, SKIFT+ENTER RADBRYTER. Det är vad alla andra chattar gör, och
 * en chatt som gör tvärtom lär sig ingen — man skickar halva meningar i en
 * vecka och slutar sedan använda den.
 *
 * Fältet växer med texten upp till 160 px. Obegränsad växt hade tryckt ned
 * tråden det hör till, vilket är precis fel: den man svarar på ska synas medan
 * man skriver svaret.
 */
export function Skrivfalt({
  faltet,
  formularet,
  text,
  setText,
  vantar,
  placeholder,
}: {
  faltet: RefObject<HTMLTextAreaElement | null>;
  formularet: RefObject<HTMLFormElement | null>;
  text: string;
  setText: (v: string) => void;
  vantar: boolean;
  placeholder: string;
}) {
  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={faltet}
        name="body"
        value={text}
        rows={1}
        maxLength={4000}
        placeholder={placeholder}
        aria-label="Ny replik"
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (text.trim() !== "") formularet.current?.requestSubmit();
          }
        }}
        className={cn(
          "w-full resize-none rounded-lg bg-surface px-4 py-2.5 text-body text-ink-900",
          "shadow-elev-1 ring-1 ring-transparent placeholder:text-ink-300",
          "transition-shadow duration-fast ease-brand",
          "focus:shadow-elev-2 focus:ring-2 focus:ring-brand-600 focus:outline-none",
        )}
      />

      <button
        type="submit"
        disabled={vantar || text.trim() === ""}
        aria-label="Skicka"
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          "bg-brand-600 text-ink-inv shadow-elev-brand transition-all duration-fast ease-brand",
          "hover:bg-brand-700 active:scale-95",
          "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        <Ikon namn="fram" className="size-5" />
      </button>
    </div>
  );
}
