"use client";

import { useCallback, useEffect, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/Button";
import { Ikon } from "@/components/shell/Ikon";
import { tidstext, visaPrioritet, type Prioritet } from "@/lib/uppgifter";
import {
  DAG_SLUT,
  DAG_START,
  RUTA,
  SLAG_TON,
  dagssumma,
  heldagsposter,
  langd,
  laggUt,
  minuterTillTid,
  rutor,
  slut,
  start,
  utanforDygnet,
  type Kalenderpost,
} from "@/lib/kalender";
import { planera } from "../uppgifter/actions";
import { NyPost } from "./NyPost";

/**
 * Planeringsvyn.
 *
 * =============================================================================
 * EN UPPGIFT FLYTTAS PÅ TVÅ SÄTT, OCH BÅDA BEHÖVS
 *
 * DRA OCH SLÄPP är det beställaren bad om, och det är det snabbaste sättet på
 * en dator. Det fungerar inte på en pekskärm: HTML5:s dragrgränssnitt lyssnar på
 * musen, och ett finger ger `touchstart` som aldrig blir ett `dragstart`.
 *
 * Därför finns också VÄLJ OCH PLACERA: ett tryck på en uppgift markerar den, ett
 * tryck på ett klockslag lägger den där. Samma handling i två steg, och den
 * fungerar överallt — även med tangentbord, där den är den enda som gör det.
 *
 * Det är avsiktligt att båda leder till SAMMA anrop. Två vägar in är billigt så
 * länge de möts direkt; två vägar som var för sig bygger sitt anrop är två
 * ställen att glömma ett fält på, och just här kostar ett glömt fält data.
 *
 * =============================================================================
 * PLANERINGEN SKRIVS HEL, VARJE GÅNG
 *
 * `planera()` sätter datum, klockslag OCH minuter i samma uppdatering, och ett
 * fält som inte kommer med tolkas som "ta bort". Det har redan kostat en bugg
 * en gång: snabbknapparna "Idag"/"I morgon" i listan raderade tyst en
 * tidsuppskattning någon gjort (2026-09-11).
 *
 * `planeraTill()` nedan är därför den ENDA vägen härifrån till servern, och den
 * bygger alltid alla tre fälten ur postens nuvarande värden och ändrar ett av
 * dem. Lägg aldrig ett `planera()`-anrop bredvid den.
 *
 * =============================================================================
 * ETT KLICK PÅ EN TOM RUTA BETYDER TVÅ SAKER, OCH VALET STÅR I MARKERINGEN
 *
 * Har man markerat en uppgift i vänsterspalten betyder klicket "lägg den här" —
 * det är väljandet-och-placerandet ovan. Har man INTE markerat något betydde
 * det ingenting alls fram till 2026-09-14, och det var en tom gren i en ruta
 * användaren redan hade upptäckt att hon kunde trycka på.
 *
 * Numera öppnar den `NyPost` med dagen och klockslaget ifyllda. Det är samma
 * grepp som Outlook, och det är billigt just för att klicket redan bar rätt
 * information: rutan VET vilket klockslag den är.
 * =============================================================================
 */

export type Planerbar = {
  id: string;
  title: string;
  project_id: string | null;
  due_date: string | null;
  due_time: string | null;
  estimate_minutes: number | null;
  priority: number;
  forsenad: boolean;
};

export type Projektkarta = Record<string, { namn: string; farg: string }>;

/**
 * Det `NyPost` behöver för att kunna rita coachningsgrenen.
 *
 * Hämtas av sidan och skickas hit orört. ALLT ÄR TOMT FÖR DEN SOM INTE COACHAR
 * NÅGON — då står `farCoacha: false` och inga frågor har ställts, se
 * kommentaren i page.tsx.
 */
export type Postval = {
  farCoacha: boolean;
  personer: { id: string; namn: string }[];
  kollegor: { id: string; namn: string }[];
  kurser: { id: string; title: string }[];
  moduler: { id: string; title: string }[];
  dokument: { id: string; title: string; doc_type: string }[];
  fokus: { id: string; label: string }[];
};

const FARG_PRICK: Record<string, string> = {
  brand: "bg-brand-500",
  info: "bg-info",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

const TON_YTA: Record<string, string> = {
  brand: "bg-brand-100 text-brand-700",
  info: "bg-info-tint text-info-ink",
  accent: "bg-canvas text-ink-700",
  ok: "bg-ok-tint text-ok-ink",
  warn: "bg-warn-tint text-warn-ink",
};

/** Rutans höjd. Står som tal och inte som klass — posterna räknar mot den. */
const RUTHOJD_REM = 2.5;

export function Planeringsvy({
  dag,
  idag,
  poster,
  attPlanera,
  projekt,
  postval,
}: {
  dag: string;
  idag: string;
  poster: Kalenderpost[];
  attPlanera: Planerbar[];
  projekt: Projektkarta;
  postval: Postval;
}) {
  const router = useRouter();
  const [vantar, startaOvergang] = useTransition();
  const [vald, setVald] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [fel, setFel] = useState<string | null>(null);

  /**
   * Formuläret för en ny post. `null` = stängt; `{ tid: null }` = öppet för hela
   * dagen, alltså knappen och inte en ruta.
   */
  const [nyPost, setNyPost] = useState<{ tid: string | null } | null>(null);

  // Stabila mellan renderingar, så att effekten i NyPost inte tror att något
  // ändrats bara för att kalendern ritats om.
  const stangNyPost = useCallback(() => setNyPost(null), []);
  const nyPostKlar = useCallback(() => {
    setNyPost(null);
    router.refresh();
  }, [router]);

  /**
   * Den enda vägen till servern. Se rubriken överst.
   *
   * `tid = null` betyder "behåll dagen, ta bort klockslaget" — inte "ta bort
   * planeringen". Att släppa en uppgift utanför rutnätet ska inte kunna radera
   * dess datum av misstag.
   */
  const planeraTill = (uppgiftId: string, nyttDatum: string | null, nyTid: string | null, minuter: number | null) => {
    setFel(null);
    setVald(null);
    startaOvergang(async () => {
      const form = new FormData();
      form.set("id", uppgiftId);
      form.set("due_date", nyttDatum ?? "");
      form.set("due_time", nyTid ?? "");
      form.set("estimate_minutes", minuter === null ? "" : String(minuter));

      const svar = await planera({}, form);
      if (svar.fel) setFel(svar.fel);
      router.refresh();
    });
  };

  const slappPa = (minuter: number) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const nyttfall = e.dataTransfer.getData("text/plain");
    if (!nyttfall) return;
    const [uppgiftId, langdStr] = nyttfall.split("|");
    planeraTill(uppgiftId, dag, minuterTillTid(minuter), langdStr ? Number(langdStr) : null);
  };

  const klickaRuta = (minuter: number) => {
    // Ingen uppgift markerad? Då är klicket en beställning om en ny post på
    // just det klockslaget. Se rubriken överst.
    if (!vald) {
      setFel(null);
      setNyPost({ tid: minuterTillTid(minuter) });
      return;
    }
    const u = attPlanera.find((p) => p.id === vald);
    const p = poster.find((x) => x.ref === vald);
    planeraTill(vald, dag, minuterTillTid(minuter), u?.estimate_minutes ?? p?.minuter ?? null);
  };

  const heldag = heldagsposter(poster);
  const utanfor = utanforDygnet(poster);
  const utlagda = laggUt(poster);
  // BARA UPPGIFTER, och det är inte en glömd coachningsuppgift. Raden nedan är
  // en uppmaning att DRA ner posten i rutnätet, och en coachningsuppgift går
  // inte att dra — den har inget `planera()`. Utan klockslag hamnar den bland
  // heldagsposterna, vilket är sant om den: den gäller dagen och inte en timme.
  const utanKlockslag = poster.filter((p) => p.slag === "uppgift" && !p.tid);
  const summa = dagssumma(poster);

  return (
    <div className="flex flex-col gap-4">
      {fel && (
        <p role="alert" className="rounded-sm bg-danger-tint px-4 py-3 text-small text-danger-ink">
          {fel}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
        {/* ------------------------------------------------------------------ */}
        {/* Vänster: det som ska planeras                                       */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-h2 text-ink-900">Att planera</h3>
            <p className="text-small text-ink-500">
              {vald
                ? "Tryck på ett klockslag till höger."
                : "Dra en rad till en tid, eller tryck på den och sedan på ett klockslag. Tryck på en tom tid för en ny post."}
            </p>
          </div>

          {attPlanera.length === 0 ? (
            <p className="rounded-sm bg-canvas px-4 py-6 text-center text-small text-ink-500">
              Ingenting öppet att lägga ut. Nya uppgifter skrivs på{" "}
              <Link href="/uppgifter" className="text-brand-700 underline">
                Uppgifter
              </Link>
              .
            </p>
          ) : (
            <ul className="flex max-h-[36rem] flex-col gap-1.5 overflow-y-auto pr-1">
              {attPlanera.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      // Längden följer med i nyttolasten, så släppet kan skicka
                      // med `estimate_minutes` utan att slå upp raden igen.
                      e.dataTransfer.setData("text/plain", `${u.id}|${u.estimate_minutes ?? ""}`);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => setVald(vald === u.id ? null : u.id)}
                    aria-pressed={vald === u.id}
                    disabled={vantar}
                    className={cn(
                      "group flex w-full cursor-grab items-start gap-2 rounded-sm px-3 py-2 text-left transition-colors duration-fast active:cursor-grabbing",
                      vald === u.id ? "bg-brand-100 ring-2 ring-brand-500" : "bg-canvas hover:bg-surface-alt",
                    )}
                  >
                    {visaPrioritet(u.priority as Prioritet) && (
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 h-3 w-[3px] shrink-0 rounded-full",
                          u.priority === 1 ? "bg-danger" : "bg-warn",
                        )}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink-900">{u.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {u.forsenad && (
                          <span className="text-small font-semibold text-danger-ink">Försenad</span>
                        )}
                        {u.estimate_minutes ? (
                          <span className="tnum text-small text-ink-500">{tidstext(u.estimate_minutes)}</span>
                        ) : (
                          <span className="text-small text-ink-300">Ingen uppskattning</span>
                        )}
                        {u.project_id && projekt[u.project_id] && (
                          <span className="inline-flex items-center gap-1.5 text-small text-ink-500">
                            <span
                              aria-hidden
                              className={cn(
                                "size-2 rounded-full",
                                FARG_PRICK[projekt[u.project_id].farg] ?? "bg-brand-500",
                              )}
                            />
                            {projekt[u.project_id].namn}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Höger: dagen                                                        */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex flex-col gap-3">
          {/* "Ny post" står HÄR och inte i sidhuvudet, bredvid det den skapar.
              Klicket i rutnätet öppnar samma formulär, och två knappar för ett
              formulär hade betytt två tillstånd att hålla i takt. */}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="sekundar"
              size="sm"
              onClick={() => setNyPost({ tid: null })}
              disabled={vantar}
            >
              Ny post
            </Button>
          </div>

          {nyPost && (
            <NyPost
              dag={dag}
              tid={nyPost.tid}
              farCoacha={postval.farCoacha}
              personer={postval.personer}
              kollegor={postval.kollegor}
              kurser={postval.kurser}
              moduler={postval.moduler}
              dokument={postval.dokument}
              fokus={postval.fokus}
              onKlar={nyPostKlar}
              onAvbryt={stangNyPost}
            />
          )}

          {/* Heldagsposterna. Frånvaro, coachning och frister har ingen tid och
              hör inte hemma i rutnätet — men de styr dagen mest av allt, så de
              står överst och inte längst ned. */}
          {(heldag.length > 0 || utanfor.length > 0) && (
            <ul className="flex flex-col gap-1.5">
              {heldag.map((p) => (
                <Heldagsrad key={p.id} post={p} />
              ))}
              {utanfor.map((p) => (
                <Heldagsrad key={p.id} post={p} prefix={p.tid ?? undefined} />
              ))}
            </ul>
          )}

          {/* Uppgifter som ligger på dagen men saknar klockslag. De ÄR planerade
              — de har en dag — men de har inget NÄR, och forskningen bakom
              modulen säger att det är hela skillnaden. Raden är därför inte en
              lista utan en uppmaning: dra ner dem. */}
          {utanKlockslag.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-sm bg-canvas px-3 py-2">
              <span className="text-small text-ink-500">Idag utan klockslag:</span>
              {utanKlockslag.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  draggable={p.flyttbar}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", `${p.ref}|${p.minuter ?? ""}`);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => p.ref && setVald(vald === p.ref ? null : p.ref)}
                  aria-pressed={vald === p.ref}
                  className={cn(
                    "rounded-full px-3 py-1 text-small transition-colors duration-fast",
                    vald === p.ref
                      ? "bg-brand-100 text-brand-700 ring-2 ring-brand-500"
                      : "bg-surface text-ink-700 shadow-elev-1 hover:text-brand-700",
                    p.klar && "text-ink-300 line-through",
                  )}
                >
                  {p.rubrik ?? "Upptagen"}
                </button>
              ))}
            </div>
          )}

          {/* Rutnätet */}
          <div className="relative flex">
            {/* Klockslagen. Egen spalt så att posterna kan ligga absolut
                positionerade utan att räkna in etiketternas bredd. */}
            <div className="w-14 shrink-0">
              {rutor().map((m) => (
                <div
                  key={m}
                  style={{ height: `${RUTHOJD_REM}rem` }}
                  className="relative -top-2 text-right"
                >
                  {m % 60 === 0 && (
                    <span className="tnum pr-2 text-micro text-ink-300">{minuterTillTid(m)}</span>
                  )}
                </div>
              ))}
            </div>

            <div className="relative flex-1">
              {/* Släppytorna. En per halvtimme, och de ligger UNDER posterna i
                  staplingsordningen — annars hade en post täckt sin egen ruta
                  och gjort det omöjligt att släppa något ovanpå den. */}
              {rutor().map((m) => (
                <button
                  key={m}
                  type="button"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(m);
                  }}
                  onDragLeave={() => setOver((v) => (v === m ? null : v))}
                  onDrop={slappPa(m)}
                  onClick={() => klickaRuta(m)}
                  aria-label={
                    vald ? `Lägg ${minuterTillTid(m)}` : `Ny post ${minuterTillTid(m)}`
                  }
                  disabled={vantar}
                  style={{ height: `${RUTHOJD_REM}rem` }}
                  className={cn(
                    "block w-full border-t transition-colors duration-fast hover:bg-brand-100",
                    m % 60 === 0 ? "border-canvas" : "border-canvas/50",
                    over === m && "bg-brand-100",
                  )}
                />
              ))}

              {/* Posterna */}
              {utlagda.map((p) => {
                const topp = ((start(p) - DAG_START) / RUTA) * RUTHOJD_REM;
                const hojd = ((slut(p) - start(p)) / RUTA) * RUTHOJD_REM;
                const bredd = 100 / p.spalter;

                return (
                  <div
                    key={p.id}
                    draggable={p.flyttbar}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", `${p.ref}|${p.minuter ?? ""}`);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    style={{
                      top: `${topp}rem`,
                      height: `${hojd}rem`,
                      left: `${p.spalt * bredd}%`,
                      width: `${bredd}%`,
                    }}
                    className="absolute p-[2px]"
                  >
                    <div
                      className={cn(
                        "flex h-full flex-col overflow-hidden rounded-sm px-2 py-1",
                        TON_YTA[SLAG_TON[p.slag]] ?? "bg-brand-100 text-brand-700",
                        p.forsenad && "ring-2 ring-danger",
                        p.klar && "opacity-50",
                        p.flyttbar && "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      <span className="flex items-start justify-between gap-1">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-small font-semibold",
                            p.klar && "line-through",
                          )}
                        >
                          {p.href ? (
                            <Link href={p.href} className="hover:underline">
                              {p.rubrik ?? "Upptagen"}
                            </Link>
                          ) : (
                            (p.rubrik ?? "Upptagen")
                          )}
                        </span>
                        {p.flyttbar && p.ref && (
                          <button
                            type="button"
                            onClick={() => planeraTill(p.ref!, p.dag, null, p.minuter)}
                            aria-label="Ta bort klockslaget"
                            title="Ta bort klockslaget — dagen står kvar"
                            disabled={vantar}
                            className="-mt-0.5 -mr-1 shrink-0 rounded-full p-1 opacity-60 transition-opacity duration-fast hover:opacity-100"
                          >
                            <Ikon namn="kryss" className="size-3" />
                          </button>
                        )}
                      </span>
                      {hojd >= RUTHOJD_REM && (
                        <span className="tnum truncate text-micro opacity-80">
                          {p.tid}
                          {p.minuter ? ` · ${langd(p.minuter)}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Nulinjen. Bara på den dag som faktiskt är i dag — en röd linje
                  i nästa tisdag betyder ingenting. */}
              {dag === idag && <Nulinje ruthojd={RUTHOJD_REM} />}
            </div>
          </div>

          <Dagsumma summa={summa} />
        </div>
      </div>
    </div>
  );
}

/**
 * "Planerat 4 h av 6 h" — beställarens ord.
 *
 * OSKATTADE RADER RÄKNAS INTE IN, och det står utskrivet i stället för att
 * gömmas. Talet ska betyda "så mycket har jag lovat mig själv", och en gissning
 * inbakad i summan hade gjort det till något annat utan att någon märkte det.
 * Se `dagssumma()` i kalender.ts.
 */
function Dagsumma({ summa }: { summa: ReturnType<typeof dagssumma> }) {
  if (summa.antal === 0) return null;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-sm bg-canvas px-4 py-3">
      <span className="text-small text-ink-500">
        {summa.antal} {summa.antal === 1 ? "uppgift" : "uppgifter"}
        {summa.oskattade > 0 && ` · ${summa.oskattade} utan uppskattning`}
      </span>
      <span
        className={summa.over ? "text-small font-semibold text-warn-ink" : "text-small text-ink-700"}
      >
        Planerat {langd(summa.minuter)} av {langd(summa.tak)}
        {summa.over && " — mer än en dag rymmer"}
      </span>
    </div>
  );
}

function Heldagsrad({ post, prefix }: { post: Kalenderpost; prefix?: string }) {
  const innehall = (
    <>
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", FARG_PRICK[SLAG_TON[post.slag]] ?? "bg-brand-500")}
      />
      {prefix && <span className="tnum shrink-0 text-small text-ink-500">{prefix}</span>}
      <span className={cn("truncate text-small", post.forsenad ? "text-danger-ink" : "text-ink-700")}>
        {post.rubrik ?? "Upptagen"}
      </span>
    </>
  );

  return (
    <li className="flex">
      {post.href ? (
        <Link
          href={post.href}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm bg-canvas px-3 py-2 transition-colors duration-fast hover:bg-surface-alt"
        >
          {innehall}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded-sm bg-canvas px-3 py-2">
          {innehall}
        </span>
      )}
    </li>
  );
}

/**
 * Linjen för var klockan står.
 *
 * RÄKNAS I WEBBLÄSAREN och inte på servern, och det är ett undantag från
 * `klocka.ts` som är värt att skriva ut: allt annat i navet som rör tid räknas
 * mot `Europe/Stockholm` uttryckligen, eftersom serverns zon är UTC på Vercel.
 * Här är det tvärtom rätt att fråga enheten — linjen ska stå där ANVÄNDARENS
 * klocka står, och den som sitter i en annan tidszon läser sin egen dag.
 *
 * Komponenten renderar null vid första passet. Utan det hade servern ritat en
 * linje efter UTC och webbläsaren flyttat den två timmar, vilket React
 * rapporterar som ett hydreringsfel.
 */
function Nulinje({ ruthojd }: { ruthojd: number }) {
  const [minuter, setMinuter] = useState<number | null>(null);

  useEffect(() => {
    const las = () => {
      const nu = new Date();
      setMinuter(nu.getHours() * 60 + nu.getMinutes());
    };
    las();
    // En gång i minuten. En kalender som står öppen över lunchen ska inte visa
    // förmiddagens linje, och en `setInterval` på 60 sekunder är billigare än
    // det polling-anrop plinget redan gör.
    const id = setInterval(las, 60_000);
    return () => clearInterval(id);
  }, []);

  if (minuter === null || minuter < DAG_START || minuter >= DAG_SLUT) return null;

  return (
    <div
      aria-hidden
      style={{ top: `${((minuter - DAG_START) / RUTA) * ruthojd}rem` }}
      className="pointer-events-none absolute right-0 left-0 flex items-center"
    >
      <span className="size-2 rounded-full bg-danger" />
      <span className="h-px flex-1 bg-danger" />
    </div>
  );
}
