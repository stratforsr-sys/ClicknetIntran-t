"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import {
  DOC_TYPES,
  DOC_TYPE_LABEL,
  LAGKRAVDA_TYPER,
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
  requires_ack: boolean;
  audience_roles: Role[];
  status?: string;
  version?: number;
};

export function Redaktor({
  utkast,
  agare,
  aktivAgare,
  action,
  kategorier,
}: {
  utkast: Utkast;
  agare: { id: string; namn: string }[];
  aktivAgare: string;
  action: (prev: DokumentState, form: FormData) => Promise<DokumentState>;
  kategorier: string[];
}) {
  const [state, formAction, vantar] = useActionState<DokumentState, FormData>(action, {});
  const [typ, setTyp] = useState<DocType>(utkast.doc_type);
  const [brodtext, setBrodtext] = useState(utkast.body_md);
  const [visaForhandsvisning, setVisaForhandsvisning] = useState(false);
  const [reviewDue, setReviewDue] = useState(utkast.review_due);

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
                  <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3">
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
