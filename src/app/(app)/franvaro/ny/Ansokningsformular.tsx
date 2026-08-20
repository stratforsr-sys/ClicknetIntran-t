"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { antalDagar, periodtext, type Franvarotyp, type Regelverk } from "@/lib/franvaro";
import { forhandsgranska, skickaAnsokan, type Forhandsbesked, type FranvaroState } from "../actions";

/**
 * Ansökan om ledighet (E7.1, E7.2, AC-3.13).
 *
 * ===========================================================================
 * K35, AC-3.21: DET FINNS INGET SKÄLFÄLT HÄR, OCH DET SKA INTE LÄGGAS TILL.
 *
 * "Varför söker du ledigt" ser oskyldigt ut på ett semesterformulär. Men samma
 * fält skulle stå kvar den dag någon söker ledigt för en behandling, och då
 * bär navet en uppgift om någons hälsa i ett fritextfält. Chefen beslutar
 * utifrån period, bemanning och regler — inget av det kräver ett skäl.
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
  const [fran, setFran] = useState("");
  const [till, setTill] = useState("");
  const [deldag, setDeldag] = useState(false);
  const [minuter, setMinuter] = useState(120);
  const [besked, setBesked] = useState<Forhandsbesked | null>(null);
  const [raknar, startaRakning] = useTransition();

  const typ = typer.find((t) => t.id === typId);
  const slut = till || fran;

  // Bemanningen och regelbrotten räknas på servern varje gång perioden ändras.
  // Kort fördröjning, annars går det en fråga per tangenttryck i datumfältet.
  useEffect(() => {
    if (!fran || !typId) {
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

  const dagar = fran && slut >= fran ? antalDagar(fran, slut) : 0;
  const saldo = saldon[typId] ?? null;
  const overTak =
    besked?.bemanning && besked.bemanning.tak !== null && besked.bemanning.andra >= besked.bemanning.tak;

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

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Från och med" namn="fran">
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

              <Field
                label="Till och med"
                namn="till"
                hjalp={deldag ? "Del av dag gäller en enda dag." : undefined}
              >
                <Input
                  namn="till"
                  type="date"
                  value={deldag ? fran : till}
                  min={fran || undefined}
                  disabled={deldag}
                  onChange={(e) => setTill(e.target.value)}
                />
              </Field>
            </div>

            {typ?.allows_part_day && (
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

            {dagar > 0 && !deldag && (
              <p className="text-small text-ink-500">
                {periodtext(fran, slut)} — {dagar} {dagar === 1 ? "dag" : "dagar"}.
              </p>
            )}

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
              <Button type="submit" laddar={vantar} disabled={!fran}>
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
