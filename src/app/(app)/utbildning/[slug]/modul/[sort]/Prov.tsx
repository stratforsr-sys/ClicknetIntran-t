"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Notis } from "@/components/ui/Notis";
import { KONTROLL } from "@/components/ui/Field";
import { Ikon } from "@/components/shell/Ikon";
import {
  MINSTA_SVAR,
  PROVLAGE_ETIKETT,
  PROVLAGE_TON,
  farSkriva,
  ordrakning,
  type Provlage,
} from "@/lib/prov";
import { sparaUtkast, lamnaProv } from "../../../prov/actions";
import type { KursState } from "../../../actions";

const TOM: KursState = {};

/** Sa lange efter sista tangenttrycket utkastet skrivs ner. */
const SPARFORDROJNING = 2500;

export type Provsvar = {
  fragaId: string;
  text: string;
  poang: number | null;
  kommentar: string | null;
};

export type Provfragarad = { id: string; sort: number; prompt: string; max_points: number };

export type Provresultat = {
  poang: number;
  grans: number;
  godkant: boolean;
  aterkoppling: string | null;
  rattad: string;
};

/**
 * Skrivvyn for det skriftliga provet (0067).
 *
 * ===========================================================================
 * TRE SAKER SOM STYR HELA FORMEN
 *
 * TEXTEN FAR INTE KUNNA FORSVINNA. Tjugo fritextsvar ar fyrtio minuters
 * arbete. Ett formular som lever i webblasaren tills man trycker pa ratt knapp
 * ar fyrtio minuter som forsvinner nar fliken stangs, batteriet tar slut eller
 * nagon klickar fel. Utkastet skrivs darfor ner av sig sjalv, och vyn SAGER nar
 * det skedde — en tyst sparning ar ingen trygghet, for den som inte ser den
 * litar inte pa den.
 *
 * DET SKA GA ATT SE HUR LANGT MAN KOMMIT. Raknaren overst ar inte pynt: tjugo
 * langa fragor utan matning ar en lista man tappar bort sig i, och den som inte
 * vet hur mycket som ar kvar tar aldrig itu med den sista fjardedelen.
 *
 * INLAMNAT AR INLAMNAT. Sa fort provet ligger hos chefen ar faltet en text och
 * inte en ruta. Ett redigerbart falt pa ett inlamnat prov ar ett lofte vyn inte
 * kan halla — servern nekar andringen anda, och den som skrivit i tio minuter
 * far veta det forst nar hon trycker.
 * ===========================================================================
 */
export function Prov({
  modulId,
  lage,
  fragor,
  svar,
  retur,
  resultat,
  nastaHref,
  grans,
}: {
  modulId: string;
  lage: Provlage;
  fragor: Provfragarad[];
  svar: Provsvar[];
  retur: { note: string; datum: string } | null;
  resultat: Provresultat | null;
  nastaHref: string;
  grans: number;
}) {
  const skrivbart = farSkriva(lage);
  const formRef = useRef<HTMLFormElement>(null);

  const [sparState, sparaAction, sparar] = useActionState(sparaUtkast, TOM);
  const [state, lamnaAction, skickar] = useActionState(lamnaProv, TOM);

  const tidigare = new Map(svar.map((s) => [s.fragaId, s]));
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(fragor.map((f) => [f.id, tidigare.get(f.id)?.text ?? ""])),
  );

  // `smutsigt` ar skillnaden mellan "inget att spara" och "sparat". Utan den
  // skulle timern skriva samma text om och om igen sa lange sidan star oppen.
  const [smutsigt, setSmutsigt] = useState(false);
  const [sparatKl, setSparatKl] = useState<string | null>(null);

  const spara = useCallback(() => {
    if (!formRef.current) return;
    setSmutsigt(false);
    setSparatKl(new Date().toLocaleTimeString("sv-SE", { timeStyle: "short" }));
    sparaAction(new FormData(formRef.current));
  }, [sparaAction]);

  useEffect(() => {
    if (!smutsigt || !skrivbart) return;
    const timer = setTimeout(spara, SPARFORDROJNING);
    return () => clearTimeout(timer);
  }, [smutsigt, skrivbart, spara, text]);

  /**
   * Varning vid stangd flik. Slar bara till medan det finns osparat — och det
   * fonstret ar hogst `SPARFORDROJNING` millisekunder brett, sa rutan dyker upp
   * nastan aldrig. Det ar meningen: den ska finnas for de tva sekunderna, inte
   * vara en rad man lar sig klicka bort.
   */
  useEffect(() => {
    if (!smutsigt) return;
    const vid = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", vid);
    return () => window.removeEventListener("beforeunload", vid);
  }, [smutsigt]);

  const besvarade = fragor.filter((f) => (text[f.id] ?? "").trim().length >= MINSTA_SVAR).length;
  const klart = besvarade === fragor.length;

  return (
    <div className="flex flex-col gap-4">
      <Lagesrad
        lage={lage}
        besvarade={besvarade}
        antal={fragor.length}
        sparar={sparar}
        sparatKl={sparatKl}
        skrivbart={skrivbart}
      />

      {resultat && <Resultatkort resultat={resultat} />}

      {retur && lage === "retur" && (
        <Notis ton="warn">
          <span className="block font-semibold">
            Din chef har skickat tillbaka provet {retur.datum} och vill att du fyller på.
          </span>
          <span className="mt-1 block whitespace-pre-line">{retur.note}</span>
          <span className="mt-1 block">
            Dina svar ligger kvar. Frågorna hon kommenterat är markerade nedan.
          </span>
        </Notis>
      )}

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      {sparState.fel && <Notis ton="danger">{sparState.fel}</Notis>}

      <form ref={formRef} action={lamnaAction} className="flex flex-col gap-3">
        <input type="hidden" name="modul_id" value={modulId} />

        {fragor.map((f) => {
          const eget = tidigare.get(f.id);
          const antalOrd = ordrakning(text[f.id] ?? "");
          const kort = (text[f.id] ?? "").trim().length < MINSTA_SVAR;

          return (
            <section
              key={f.id}
              className="rounded-md bg-surface p-4 shadow-elev-1 md:p-5"
              aria-labelledby={`fraga_${f.id}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-micro font-semibold ${
                    kort ? "bg-canvas text-ink-500" : "bg-brand-tint text-brand-ink"
                  }`}
                  aria-hidden
                >
                  {f.sort}
                </span>
                <label
                  id={`fraga_${f.id}`}
                  htmlFor={`svar_${f.id}`}
                  className="min-w-0 flex-1 text-body font-semibold text-ink-900"
                >
                  {f.prompt}
                </label>
                {eget?.poang != null && (
                  <Badge ton={eget.poang === f.max_points ? "ok" : eget.poang === 0 ? "danger" : "warn"}>
                    {eget.poang} av {f.max_points} p
                  </Badge>
                )}
              </div>

              {eget?.kommentar && (
                <p className="mt-3 rounded-sm bg-warn-tint px-3 py-2 text-small text-warn-ink">
                  <span className="font-semibold">Din chef:</span>{" "}
                  <span className="whitespace-pre-line">{eget.kommentar}</span>
                </p>
              )}

              {skrivbart ? (
                <>
                  <textarea
                    id={`svar_${f.id}`}
                    name={`svar_${f.id}`}
                    rows={4}
                    value={text[f.id] ?? ""}
                    onChange={(e) => {
                      setText((f2) => ({ ...f2, [f.id]: e.target.value }));
                      setSmutsigt(true);
                    }}
                    placeholder="Svara med egna ord."
                    className={`${KONTROLL} mt-3 resize-y text-body`}
                  />
                  <p className="mt-1.5 text-micro text-ink-500">
                    {antalOrd === 0
                      ? "Inte besvarad än"
                      : `${antalOrd} ${antalOrd === 1 ? "ord" : "ord"}`}
                    {antalOrd > 0 && kort && " · för kort för att lämnas in"}
                  </p>
                </>
              ) : (
                <p className="mt-3 whitespace-pre-line rounded-sm bg-canvas px-3 py-2.5 text-body text-ink-700">
                  {eget?.text || <span className="text-ink-300">Inget svar.</span>}
                </p>
              )}
            </section>
          );
        })}

        {skrivbart && (
          /* Handlingarna foljer med nedat. Tjugo fragor ar tre skarmhojder, och
             en inlamningsknapp langst ner ar en knapp man scrollar forbi utan
             att veta att man gjort det. */
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-full bg-surface px-4 py-3 shadow-elev-2">
            <Button type="submit" laddar={skickar} disabled={!klart}>
              Lämna in provet
            </Button>
            <Button
              type="button"
              variant="sekundar"
              size="sm"
              laddar={sparar}
              onClick={spara}
            >
              Spara utkast
            </Button>
            <p className="text-small text-ink-500">
              {klart
                ? "Alla frågor är besvarade."
                : `${fragor.length - besvarade} ${fragor.length - besvarade === 1 ? "fråga" : "frågor"} kvar innan du kan lämna in.`}
            </p>
          </div>
        )}
      </form>

      {lage === "inlamnad" && (
        <Notis ton="info">
          Provet ligger hos säljledningen. Du får besked i navet när det är rättat.
        </Notis>
      )}

      {lage === "godkant" && (
        <div>
          <Link href={nastaHref}>
            <Button variant="sekundar">Till kursen</Button>
          </Link>
        </div>
      )}

      {lage === "underkant" && (
        <Notis ton="warn">
          Läs din chefs återkoppling och gör om provet när du är redo. Gränsen är {grans} %, och
          ett nytt försök börjar med tomma rutor — det förra ligger kvar i historiken.
        </Notis>
      )}
    </div>
  );
}

function Lagesrad({
  lage,
  besvarade,
  antal,
  sparar,
  sparatKl,
  skrivbart,
}: {
  lage: Provlage;
  besvarade: number;
  antal: number;
  sparar: boolean;
  sparatKl: string | null;
  skrivbart: boolean;
}) {
  const andel = antal === 0 ? 0 : Math.round((besvarade / antal) * 100);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-surface px-4 py-3 shadow-elev-1">
      <Badge ton={PROVLAGE_TON[lage]}>{PROVLAGE_ETIKETT[lage]}</Badge>

      {skrivbart && (
        <>
          <span className="tnum text-small text-ink-700">
            {besvarade} av {antal} besvarade
          </span>
          <span
            className="h-1.5 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-canvas"
            role="progressbar"
            aria-valuenow={andel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Så långt du kommit"
          >
            <span
              className="block h-full rounded-full bg-brand-600 transition-[width] duration-slow ease-brand"
              style={{ width: `${andel}%` }}
            />
          </span>
          <span className="inline-flex items-center gap-1.5 text-micro text-ink-500">
            <Ikon namn={sparar ? "tid" : "kontroll"} className="size-3.5" />
            {sparar ? "Sparar…" : sparatKl ? `Sparat ${sparatKl}` : "Sparas medan du skriver"}
          </span>
        </>
      )}
    </div>
  );
}

function Resultatkort({ resultat }: { resultat: Provresultat }) {
  return (
    <div
      className={`rounded-md bg-surface p-4 shadow-elev-1 md:p-5 ${
        resultat.godkant ? "border-l-[3px] border-l-ok" : "border-l-[3px] border-l-danger"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tnum text-display text-ink-900">{resultat.poang} %</span>
        <Badge ton={resultat.godkant ? "ok" : "danger"}>
          {resultat.godkant ? "Godkänt" : "Underkänt"}
        </Badge>
        <span className="text-small text-ink-500">
          Gränsen är {resultat.grans} % · rättat {resultat.rattad}
        </span>
      </div>

      {resultat.aterkoppling && (
        <p className="mt-3 whitespace-pre-line text-body text-ink-700">{resultat.aterkoppling}</p>
      )}

      <p className="mt-3 text-small text-ink-500">
        Poängen fråga för fråga står vid varje svar nedan.
      </p>
    </div>
  );
}
