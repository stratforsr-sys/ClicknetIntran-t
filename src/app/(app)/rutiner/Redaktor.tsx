"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import {
  DOC_TYPES,
  DOC_TYPE_LABEL,
  LAGKRAVDA_TYPER,
  SPARRTYPER,
  arstalDatum,
  type DocType,
} from "@/lib/dokument";
import type { DokumentState } from "./actions";

const Forhandsvisning = dynamic(() => import("./Forhandsvisning"), {
  loading: () => <p className="text-small text-ink-500">Laddar förhandsvisning…</p>,
});

export type Utkast = {
  id?: string;
  slug?: string;
  title: string;
  category_path: string;
  body_md: string;
  doc_type: DocType;
  review_due: string;
  decided_on?: string | null;
  requires_ack: boolean;
  audience_roles: Role[];
  audience_employees: string[];
  status?: string;
  version?: number;
};

export function Redaktor({
  utkast,
  agare,
  aktivAgare,
  action,
  kategorier,
  personer,
}: {
  utkast: Utkast;
  agare: { id: string; namn: string }[];
  aktivAgare: string;
  action: (prev: DokumentState, form: FormData) => Promise<DokumentState>;
  kategorier: string[];
  /**
   * De som gar att peka ut personligen. TOM for den som inte far peka ut nagon
   * — se `redaktorsunderlag()`. Formularet visar da inte valet, men skickar
   * anda med de som redan star, sa att en agare utan chefsroll inte tommer
   * malgruppen bara genom att rätta en stavning.
   */
  personer: { id: string; namn: string }[];
}) {
  const [state, formAction, vantar] = useActionState<DokumentState, FormData>(action, {});
  const [typ, setTyp] = useState<DocType>(utkast.doc_type);
  const [brodtext, setBrodtext] = useState(utkast.body_md);
  const [visaForhandsvisning, setVisaForhandsvisning] = useState(false);
  const [reviewDue, setReviewDue] = useState(utkast.review_due);
  const [personval, setPersonval] = useState<string[]>(utkast.audience_employees);
  const [personsok, setPersonsok] = useState("");
  const barSparr = SPARRTYPER.includes(typ);

  const traffar = personsok.trim()
    ? personer.filter((p) => p.namn.toLowerCase().includes(personsok.trim().toLowerCase()))
    : personer;

  const nytt = !utkast.id;
  const lagkravd = LAGKRAVDA_TYPER.includes(typ);

  /**
   * AC-5.9: byter man till en lagkravd typ satts granskningsdatumet till ett ar
   * fram. Det ar ett forslag, inte en las — men det gor att den som glommer
   * falter anda hamnar ratt enligt AFS 2023:1.
   */
  function bytTyp(ny: DocType) {
    setTyp(ny);
    if (LAGKRAVDA_TYPER.includes(ny)) setReviewDue(arstalDatum(12));
    else if (ny === "price_list") setReviewDue(arstalDatum(6));
    else if (!reviewDue) setReviewDue(arstalDatum(12));
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href={utkast.slug ? `/rutiner/${utkast.slug}` : "/rutiner"}
        className="inline-flex min-h-11 items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        {utkast.slug ? "Tillbaka till dokumentet" : "Tillbaka till rutiner"}
      </Link>

      <div>
        <h1 className="text-display text-ink-900">{nytt ? "Nytt dokument" : "Redigera dokument"}</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          {nytt
            ? "Ett dokument utan ägare och granskningsdatum går inte att publicera. Det är avsiktligt: ett styrande dokument som ingen ansvarar för slutar snabbt att stämma."
            : "Ändras rubrik eller brödtext skapas en ny version, och kvittenserna nollställs för den nya versionen. Rättar du bara en kategori eller ett datum står versionen kvar."}
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        {utkast.id && <input type="hidden" name="id" value={utkast.id} />}
        {utkast.slug && <input type="hidden" name="slug" value={utkast.slug} />}

        {state.fel && <Notis ton="danger">{state.fel}</Notis>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-4">
            <Card>
              <div className="flex flex-col gap-5">
                <Field label="Rubrik" namn="titel">
                  <Input namn="titel" required defaultValue={utkast.title} autoComplete="off" />
                </Field>

                <Field
                  label="Kategori"
                  namn="kategori"
                  hjalp="Skriv sökvägen med snedstreck, till exempel HR/Anställning."
                >
                  <Input
                    namn="kategori"
                    defaultValue={utkast.category_path}
                    list="kategorier"
                    autoComplete="off"
                    placeholder="Försäljning/Manus"
                  />
                </Field>
                <datalist id="kategorier">
                  {kategorier.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="brodtext" className="text-small font-semibold text-ink-700">
                      Innehåll
                    </label>
                    <button
                      type="button"
                      onClick={() => setVisaForhandsvisning((v) => !v)}
                      className="min-h-11 text-small font-semibold text-brand-700 hover:text-brand-800"
                    >
                      {visaForhandsvisning ? "Redigera" : "Förhandsgranska"}
                    </button>
                  </div>

                  {visaForhandsvisning ? (
                    <div className="prosa min-h-[24rem] max-w-[70ch] rounded-sm bg-canvas p-4">
                      {brodtext.trim() ? (
                        <Forhandsvisning text={brodtext} />
                      ) : (
                        <p className="text-ink-500">Inget innehåll än.</p>
                      )}
                    </div>
                  ) : (
                    <textarea
                      id="brodtext"
                      name="brodtext"
                      value={brodtext}
                      onChange={(e) => setBrodtext(e.target.value)}
                      rows={20}
                      aria-describedby="brodtext-hjalp"
                      className="w-full rounded-sm bg-surface px-4 py-3 font-mono text-small text-ink-900 shadow-elev-1 ring-1 ring-transparent transition-shadow duration-fast ease-brand focus:shadow-elev-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  )}
                  {visaForhandsvisning && (
                    <input type="hidden" name="brodtext" value={brodtext} />
                  )}
                  <p id="brodtext-hjalp" className="text-small text-ink-500">
                    Markdown. ## för rubrik, - för punktlista, **fet**, [text](länk).
                  </p>
                </div>

                {!nytt && (
                  <Field
                    label="Ändringsnot"
                    namn="andringsnot"
                    hjalp="Syns i versionshistoriken. Skriv vad som ändrats, inte att något ändrats."
                  >
                    <Input namn="andringsnot" autoComplete="off" placeholder="Nytt pris från 1 sep" />
                  </Field>
                )}
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <h2 className="text-h2 text-ink-900">Styrning</h2>
              <div className="mt-4 flex flex-col gap-5">
                <Field label="Dokumenttyp" namn="doc_type">
                  <Select
                    namn="doc_type"
                    value={typ}
                    onChange={(e) => bytTyp(e.target.value as DocType)}
                  >
                    {DOC_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {DOC_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                </Field>

                {lagkravd && (
                  <Notis ton="info">
                    Lagkrävd handling enligt AFS 2023:1. Ska gås igenom minst en gång per år.
                  </Notis>
                )}

                <Field label="Ägare" namn="owner_id" hjalp="Den som ansvarar för att innehållet stämmer.">
                  <Select namn="owner_id" defaultValue={aktivAgare}>
                    {agare.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.namn}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Granskas senast" namn="review_due">
                  <Input
                    namn="review_due"
                    type="date"
                    required
                    value={reviewDue}
                    onChange={(e) => setReviewDue(e.target.value)}
                  />
                </Field>

                {/* En intresseavvagning utan datum gar inte att aberopa. Faltet
                    visas darfor bara for de typer som bar en sparr, och spa­rren
                    i databasen slapper inte igenom ett paslag utan det. */}
                {barSparr && (
                  <Field
                    label="Beslutsdatum"
                    namn="decided_on"
                    hjalp="Dagen dokumentet beslutades och undertecknades. Krävs för att kunna slå på det spärren skyddar."
                  >
                    <Input namn="decided_on" type="date" defaultValue={utkast.decided_on ?? ""} />
                  </Field>
                )}

                <label className="flex min-h-11 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    name="kraver_kvittens"
                    defaultChecked={utkast.requires_ack}
                    className="mt-1 size-5 accent-brand-600"
                  />
                  <span className="text-small text-ink-700">
                    Kräver kvittens
                    <span className="block text-ink-500">
                      Läsaren måste bekräfta varje ny version.
                    </span>
                  </span>
                </label>
              </div>
            </Card>

            <Card>
              <h2 className="text-h2 text-ink-900">Målgrupp</h2>
              <p className="mt-1 text-small text-ink-500">
                Ingen markerad roll betyder alla anställda.
              </p>
              <div className="mt-3 flex flex-col">
                {ROLES.map((r) => (
                  <label
                    key={r}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 ${personval.length > 0 ? "opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      name="malgrupp"
                      value={r}
                      defaultChecked={utkast.audience_roles.includes(r)}
                      className="size-5 accent-brand-600"
                    />
                    <span className="text-small text-ink-700">{ROLE_LABEL[r]}</span>
                  </label>
                ))}
              </div>

              {/* Personvalet ligger i SAMMA kort som rollerna och inte i ett
                  eget. De ar inte tva inställningar utan tva svar pa samma
                  fraga, och det ena slar ut det andra — star de isar ser det ut
                  som om de gick att kombinera. */}
              <div className="mt-5 border-t border-canvas pt-4">
                <h3 className="text-small font-semibold text-ink-900">Bara vissa personer</h3>
                <p className="mt-1 text-small text-ink-500">
                  Markerar du någon här gäller rollerna ovan inte längre —
                  dokumentet syns då bara för de markerade. Ett manus skrivet åt
                  en enda person är det här fältet finns för.
                </p>

                {personer.length === 0 ? (
                  <>
                    {/* Behorigheten att peka ut folk saknas. Valet visas inte,
                        men det som redan star far inte tyst forsvinna. */}
                    {personval.map((id) => (
                      <input key={id} type="hidden" name="malgrupp_person" value={id} />
                    ))}
                    <p className="mt-3 text-small text-ink-500">
                      {personval.length > 0
                        ? `Dokumentet är riktat till ${personval.length} utpekad${personval.length === 1 ? " person" : "a personer"}. Det står kvar när du sparar. Bara säljchef, VD, administratör och teamledare kan ändra vilka.`
                        : "Du kan inte peka ut personer. Be en säljchef, VD eller din teamledare."}
                    </p>
                  </>
                ) : (
                  <>
                    {personer.length > 8 && (
                      {/* Ratt och slatt <input> och inte <Input>: den senare
                          satter `name`, och sokrutan ska inte folja med i
                          formularet. */}
                      <input
                        type="search"
                        value={personsok}
                        onChange={(e) => setPersonsok(e.target.value)}
                        placeholder="Sök namn"
                        aria-label="Sök bland personer"
                        autoComplete="off"
                        className={`${KONTROLL} mt-3`}
                      />
                    )}

                    <div className="mt-2 flex max-h-64 flex-col overflow-y-auto">
                      {traffar.map((p) => (
                        <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3">
                          <input
                            type="checkbox"
                            name="malgrupp_person"
                            value={p.id}
                            checked={personval.includes(p.id)}
                            onChange={(e) =>
                              setPersonval((f) =>
                                e.target.checked ? [...f, p.id] : f.filter((x) => x !== p.id),
                              )
                            }
                            className="size-5 accent-brand-600"
                          />
                          <span className="text-small text-ink-700">{p.namn}</span>
                        </label>
                      ))}
                      {traffar.length === 0 && (
                        <p className="py-2 text-small text-ink-500">Ingen träff.</p>
                      )}
                    </div>

                    {/* En markerad person som filtrerats bort ur listan far inte
                        falla bort ur formularet — checkboxen finns da inte i
                        DOM:en, och webblasaren skickar bara det som star dar. */}
                    {personval
                      .filter((id) => !traffar.some((p) => p.id === id))
                      .map((id) => (
                        <input key={id} type="hidden" name="malgrupp_person" value={id} />
                      ))}
                  </>
                )}

                {personval.length > 0 && (
                  <div className="mt-3">
                    <Notis ton="info">
                      {personval.length === 1
                        ? "Dokumentet syns bara för den markerade personen — och för säljchef, VD, administratör och dokumentets ägare, som ser allt i navet."
                        : `Dokumentet syns bara för de ${personval.length} markerade — och för säljchef, VD, administratör och dokumentets ägare, som ser allt i navet.`}
                    </Notis>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>

        {/* En primarknapp per vy (UI-PRD §5.4): publicera ar handlingen,
            spara som utkast ar en sidovag. */}
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-md bg-surface p-4 shadow-elev-3">
          <Button type="submit" name="publicera" value="1" laddar={vantar}>
            {utkast.status === "published" ? "Spara och publicera" : "Publicera"}
          </Button>
          <Button type="submit" name="publicera" value="0" variant="sekundar" disabled={vantar}>
            Spara som utkast
          </Button>
          <span className="text-small text-ink-500">
            {utkast.version ? `Nuvarande version ${utkast.version}` : "Skapas som version 1"}
          </span>
        </div>
      </form>
    </div>
  );
}
