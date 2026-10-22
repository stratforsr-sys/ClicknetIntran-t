"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { oppnarText } from "@/lib/inloggning";
import { skickaKod, verifieraKod, type ProfilState } from "@/app/(app)/profil/actions";
import { Fel } from "../falt";
import { skyddad } from "../natlage";
import { Klar, KodSteg, nySkickad, type Skickad } from "../steg";

const TOM: ProfilState = {};

const vidNatfel = (fel: string): ProfilState => ({ fel });

const SKICKA = skyddad<ProfilState>(skickaKod, vidNatfel);

const VERIFIERA = skyddad<ProfilState>(async (forra, form) => {
  if (!String(form.get("kod") ?? "").replace(/\D/g, "")) return { fel: "Skriv in koden från mejlet." };
  return verifieraKod(forra, form);
}, vidNatfel);

/**
 * Steg två: en kod till mejlen, en gång per enhet och STEG2_DYGN dygn.
 * Handlingarna är profilens (samma kvitto, samma logg); kodsteget är
 * inloggningens, så att koden ser likadan ut överallt.
 *
 * "Jag har redan en kod": den som laddat om sidan efter att koden kom ska
 * inte behöva vänta en minut på en ny.
 */
export function Verifiera({ epost, nasta, minnsTill }: { epost: string; nasta: string; minnsTill: string }) {
  const [skick, skicka, skickar] = useActionState(SKICKA, TOM);
  const [ver, verifiera, verifierar] = useActionState(VERIFIERA, TOM);
  const [skickad, setSkickad] = useState<Skickad | null>(null);
  const [harKod, setHarKod] = useState(false);
  const [fel, setFel] = useState<string | null>(null);
  const [nr, setNr] = useState(0);

  useEffect(() => {
    if (skick === TOM) return;
    if (skick.ok) setSkickad((f) => nySkickad(f));
    setFel(skick.fel ?? null);
    setNr((n) => n + 1);
  }, [skick]);

  useEffect(() => {
    if (ver === TOM) return;
    setFel(ver.fel ?? null);
    setNr((n) => n + 1);
  }, [ver]);

  if (ver.ok) {
    return <Klar rubrik="Klart" text={`Enheten är bekräftad till ${minnsTill}. ${oppnarText(nasta)}`} till={nasta} />;
  }

  return (
    <>
      <h1 className="in-rubrik">Ett steg till</h1>
      <p className="in-ingress">
        Din roll når personuppgifter och lönedata. Därför bekräftar vi att det är du, en gång per enhet och månad.
      </p>
      {skickad || harKod ? (
        <KodSteg
          skickad={skickad ?? { tid: null, nyFran: 0, igen: false }}
          action={verifiera}
          vantar={verifierar}
          knapp="Fortsätt"
          fel={fel}
          nr={nr}
          skickaIgen={() => startTransition(() => skicka(new FormData()))}
          skickarIgen={skickar}
        />
      ) : (
        <form action={skicka} className="in-form" aria-busy={skickar}>
          <p className="in-text">
            Vi mejlar en engångskod till <b>{epost}</b>.
          </p>
          {fel ? <Fel id="in-formfel">{fel}</Fel> : null}
          <button type="submit" className="in-knapp" disabled={skickar}>
            {skickar ? "Skickar…" : "Skicka koden"}
          </button>
          <div className="in-rad" data-mitt="">
            <button type="button" className="in-lank" onClick={() => setHarKod(true)}>
              Jag har redan en kod
            </button>
          </div>
        </form>
      )}
      <p className="in-hjalp in-efterkod">Enheten kommer ihåg dig till {minnsTill}. Sedan frågar vi igen.</p>
    </>
  );
}
