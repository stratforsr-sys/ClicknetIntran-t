"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import {
  antalDagar,
  datumPlus,
  periodtext,
  SKAL_MAX,
  type Franvarotyp,
  type Regelverk,
} from "@/lib/franvaro";
import { forhandsgranska, skickaAnsokan, type Forhandsbesked, type FranvaroState } from "../actions";

/**
 * Ansökan om ledighet (E7.1, E7.2, AC-3.13).
 *
 * ===========================================================================
 * SKÄLFÄLTET FINNS SEDAN 2026-09-07, OCH DET ÄR EN OMPRÖVNING — INTE EN MISS.
 *
 * Här stod i ett år en versal rubrik om att fältet aldrig fick läggas till:
 * samma ruta som bär "bröllop" i september bär "cellprov" i november, och då
 * ligger en hälsouppgift i ett fritextfält.
 *
 * Beställaren vägde det mot att en chef inte kunde se varför någon var borta,
 * och valde skälet. Beslutet står som D-E7.10. Invändningen är inte upphävd,
 * den är besvarad med tre saker som gäller den här filen:
 *
 *   - HJÄLPTEXTEN STYR BORT FRÅN HÄLSA, uttryckligt och inte antytt. Det är
 *     allt ett fritextfält kan göra, och det ska då göras ordentligt.
 *   - SKÄLET SYNS BARA FÖR BESLUTSKRETSEN. Se rubriken i 0048.
 *   - SJUKVÄGEN FICK INGET SÅDANT FÄLT. Den frågan ställdes separat samma dag
 *     och besvarades med chefens anteckning i stället (D-E7.11).
 * ===========================================================================
 *
 * ===========================================================================
 * SLUTDAGEN VÄLJS, DEN UTELÄMNAS INTE.
 *
 * Fälten hette förut "Från och med" och "Till och med", och det andra fick
 * lämnas tomt. Servern läste då tomt som "samma dag" — tyst. Den som sökte en
 * vecka och missade fältet fick en dag, och ingenting på skärmen sa emot.
 *
 * Valet står nu först, före datumen, och har inget förvalt läge som betyder
 * något: "Bara en dag" och "Flera dagar" är två olika ansökningar, och den
 * som söker ska ha sagt vilken innan datumen ens visas.
 * ===========================================================================
 */
export function Ansokningsformular({
  typer,
  regler,
  saldon,
  idag,
}: {
  typer: Franvarotyp[];
  regler: Record<string, string[]>;
  saldon: Record<string, { dagar: number; asOf: string; gammalt: boolean } | null>;
  idag: string;
  policy: Regelverk;
}) {
  const [state, action, vantar] = useActionState<FranvaroState, FormData>(skickaAnsokan, {});

  const [typId, setTypId] = useState(typer[0]?.id ?? "");
  const [langd, setLangd] = useState<"" | "en_dag" | "flera">("");
  const [fran, setFran] = useState("");
  const [till, setTill] = useState("");
  const [deldag, setDeldag] = useState(false);
  const [minuter, setMinuter] = useState(120);
  const [skal, setSkal] = useState("");
  const [besked, setBesked] = useState<Forhandsbesked | null>(null);
  const [raknar, startaRakning] = useTransition();

  const typ = typer.find((t) => t.id === typId);
  const enDag = langd === "en_dag";
  const slut = enDag ? fran : till;

  // Del av dag gäller per definition en enda dag. Byter man till "flera dagar"
  // ska kryssrutan inte ligga kvar och tyst motsäga valet ovanför den.
  useEffect(() => {
    if (langd === "flera" && deldag) setDeldag(false);
  }, [langd, deldag]);

  // Bemanningen och regelbrotten räknas på servern varje gång perioden ändras.
  // Kort fördröjning, annars går det en fråga per tangenttryck i datumfältet.
  useEffect(() => {
    if (!fran || !typId || !slut) {
      setBesked(null);
      return;
    }
    const timer = setTimeout(() => {
      startaRakning(async () => {
        setBesked(await forhandsgranska(typId, fran, slut, deldag ? minuter : null));
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [typId, fran, slut, deldag, minuter]);

  const dagar = fran && slut && slut >= fran ? antalDagar(fran, slut) : 0;
  const saldo = saldon[typId] ?? null;
  const overTak =
    besked?.bemanning && besked.bemanning.tak !== null && besked.bemanning.andra >= besked.bemanning.tak;

  /**
   * Antal dagar och sista dag är samma uppgift sedd från två håll, och båda
   * går att skriva i. Den som vet "tre veckor" räknar inte fram ett datum, och
   * den som vet "till den sista" räknar inte fram ett antal.
   */
  const satsDagar = (n: number) => {
    if (!fran || !Number.isFinite(n) || n < 1) return;
    setTill(datumPlus(fran, Math.min(n, 366) - 1));
  };

  const kanSkicka =
    Boolean(fran) && Boolean(slut) && slut >= fran && skal.trim().length > 0 && langd !== "";

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/franvaro"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till frånvaro
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Söka ledigt</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Du ser reglerna och bemanningen innan du skickar. Bryter ansökan mot något går den
          fortfarande att skicka — chefen får då motivera sitt beslut.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <form action={action} className="flex flex-col gap-5">
            {state.fel && <Notis ton="danger">{state.fel}</Notis>}

            <Field label="Sorts ledighet" namn="typ">
              <Select namn="typ" value={typId} onChange={(e) => setTypId(e.target.value)}>
                {typer.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            {/* Längden först. Datumfälten under den ändrar sig efter valet, och
                det är avsiktligt: två datumfält sida vid sida är just det som
                gjorde den tomma slutdagen möjlig att missa. */}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-small font-semibold text-ink-700">
                Hur länge gäller ledigheten?
              </legend>
              <input type="hidden" name="langd" value={langd} />
              {(
                [
                  ["en_dag", "Bara en dag", "En enda dag, eller en del av den."],
                  ["flera", "Flera dagar", "Du anger sista dagen eller antal dagar."],
                ] as const
              ).map(([varde, rubrik, hjalp]) => (
                <label key={varde} className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="langdval"
                    value={varde}
                    checked={langd === varde}
                    onChange={() => setLangd(varde)}
                    className="mt-1 size-5"
                  />
                  <span>
                    <span className="block text-body text-ink-900">{rubrik}</span>
                    <span className="block text-small text-ink-500">{hjalp}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {langd !== "" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={enDag ? "Vilken dag?" : "Första dagen"} namn="fran">
                  <Input
                    namn="fran"
                    type="date"
                    required
                    value={fran}
                    min="2000-01-01"
                    onChange={(e) => {
                      setFran(e.target.value);
                      if (till && till < e.target.value) setTill(e.target.value);
                    }}
                  />
                </Field>

                {!enDag && (
                  <>
                    <Field label="Sista dagen" namn="till">
                      <Input
                        namn="till"
                        type="date"
                        required
                        value={till}
                        min={fran || undefined}
                        onChange={(e) => setTill(e.target.value)}
                      />
                    </Field>

                    <Field
                      label="…eller antal dagar"
                      namn="antal_dagar"
                      hjalp="Räknar fram sista dagen åt dig. Kalenderdagar, helger inräknade."
                    >
                      <input
                        id="antal_dagar"
                        type="number"
                        min={1}
                        max={366}
                        value={dagar || ""}
                        disabled={!fran}
                        onChange={(e) => satsDagar(Number(e.target.value))}
                        className={KONTROLL}
                      />
                    </Field>
                  </>
                )}
              </div>
            )}

            {enDag && typ?.allows_part_day && (
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="deldag"
                    value="1"
                    checked={deldag}
                    onChange={(e) => setDeldag(e.target.checked)}
                    className="mt-1 size-5 rounded-xs"
                  />
                  <span>
                    <span className="block text-body text-ink-900">Bara en del av dagen</span>
                    <span className="block text-small text-ink-500">
                      Till exempel ett läkarbesök på förmiddagen.
                    </span>
                  </span>
                </label>

                {deldag && (
                  <Field label="Antal minuter" namn="minuter">
                    <Input
                      namn="minuter"
                      type="number"
                      min={15}
                      max={1440}
                      step={15}
                      value={minuter}
                      onChange={(e) => setMinuter(Number(e.target.value))}
                    />
                  </Field>
                )}
              </div>
            )}

            {/* Perioden i klartext, alltid när båda datumen finns. Det är den
                mening chefen kommer att läsa, och den som söker ska ha sett
                exakt samma innan hen trycker. */}
            {dagar > 0 && !deldag && (
              <Notis ton="info">
                Du söker ledigt <strong>{periodtext(fran, slut)}</strong> — {dagar}{" "}
                {dagar === 1 ? "dag" : "dagar"}.
              </Notis>
            )}

            <Field
              label="Varför söker du ledigt?"
              namn="skal"
              hjalp="Chefen ser texten och beslutar utifrån den. Skriv inget om hälsa, vård eller behandling — varken din egen eller någon annans."
            >
              <textarea
                id="skal"
                name="skal"
                rows={3}
                required
                maxLength={SKAL_MAX}
                value={skal}
                onChange={(e) => setSkal(e.target.value)}
                className={KONTROLL}
                placeholder="Till exempel: flytt, bröllop, resa som är bokad sedan i våras."
              />
            </Field>
            <p className="-mt-3 text-micro text-ink-300">
              {skal.length} av {SKAL_MAX} tecken. Texten läses av dig, av den som beslutar och av
              ledningen — av ingen annan.
            </p>

            {/* E7.2: bemanningsvyn. Antal, aldrig namn — vem som är ledig i
                teamet är inte den sökandes ensak att veta. */}
            {besked?.bemanning && (
              <Notis ton={overTak ? "warn" : "info"}>
                {besked.bemanning.andra === 0
                  ? "Ingen annan är borta under perioden."
                  : `${besked.bemanning.andra} ${besked.bemanning.andra === 1 ? "person är" : "personer är"} redan borta ${besked.bemanning.datum}.`}
                {besked.bemanning.tak !== null && ` Taket är ${besked.bemanning.tak} samtidigt.`}
              </Notis>
            )}

            {besked && besked.brott.length > 0 && (
              <Notis ton="warn">
                <span className="block font-semibold">Ansökan bryter mot följande:</span>
                <ul className="mt-1 list-disc pl-5">
                  {besked.brott.map((b) => (
                    <li key={b.kod + b.text}>{b.text}</li>
                  ))}
                </ul>
                <span className="mt-2 block">
                  Du kan skicka in ändå. Chefen ser samma lista och måste skriva varför den
                  godkänns.
                </span>
              </Notis>
            )}

            <div className="mt-2 flex items-center gap-3">
              <Button type="submit" laddar={vantar} disabled={!kanSkicka}>
                Skicka ansökan
              </Button>
              <Link href="/franvaro" className="text-small font-semibold text-ink-500 hover:text-ink-900">
                Avbryt
              </Link>
              {raknar && <span className="text-small text-ink-300">Räknar …</span>}
            </div>
          </form>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="text-h2 text-ink-900">Det här gäller</h2>
            <p className="mt-1 text-small text-ink-500">
              För {typ?.label.toLowerCase() ?? "vald typ"}, i dag {idag}.
            </p>
            <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-small text-ink-700">
              {(regler[typId] ?? []).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>

            {typ?.uses_balance && (
              <div className="mt-4 border-t border-canvas pt-4">
                {saldo === null ? (
                  <p className="text-small text-ink-500">
                    Inget saldo är inmatat för dig. Ansökan går att skicka ändå — navet räknar
                    ingen semesterrätt och påstår därför ingenting om dina dagar.
                  </p>
                ) : (
                  <p className={`text-small ${saldo.gammalt ? "text-warn-ink" : "text-ink-700"}`}>
                    Ditt saldo: <span className="tnum font-semibold">{saldo.dagar}</span> dagar,
                    inmatat {saldo.asOf}.
                    {saldo.gammalt && " Siffran är gammal och kan ha ändrats sedan dess."}
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
