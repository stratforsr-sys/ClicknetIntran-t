"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { ATERSTALL_MINUTER } from "@/lib/inloggning";
import { Fel } from "@/app/logga-in/falt";
import { skyddad } from "@/app/logga-in/natlage";
import { Klar, KodSteg, nySkickad, type Skickad } from "@/app/logga-in/steg";
import { bekraftaKodForByte, skickaKodForByte, type KodState } from "./actions";

const TOM: KodState = {};

const vidNatfel = (fel: string): KodState => ({ fel });

const SKICKA = skyddad<KodState>(skickaKodForByte, vidNatfel);

const BEKRAFTA = skyddad<KodState>(async (forra, form) => {
  if (!String(form.get("kod") ?? "").replace(/\D/g, "")) return { fel: "Skriv in koden från mejlet." };
  return bekraftaKodForByte(forra, form);
}, vidNatfel);

/**
 * En kod till mejlen i stället för det gamla lösenordet: "Glömt det?" mitt i
 * bytet, och vägen vidare när tiden efter en kod gått ut. Godkänd kod ger
 * kvittot, och sidan laddas om med bara fälten för det nya.
 */
export function KodForByte({ epost, utgatt, tillbaka }: { epost: string; utgatt: boolean; tillbaka?: () => void }) {
  const [skick, skicka, skickar] = useActionState(SKICKA, TOM);
  const [ver, verifiera, verifierar] = useActionState(BEKRAFTA, TOM);
  const [skickad, setSkickad] = useState<Skickad | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [nr, setNr] = useState(0);

  useEffect(() => {
    if (skick === TOM) return;
    if (skick.skickat) setSkickad((f) => nySkickad(f));
    setFel(skick.fel ?? null);
    setNr((n) => n + 1);
  }, [skick]);

  useEffect(() => {
    if (ver === TOM) return;
    setFel(ver.fel ?? null);
    setNr((n) => n + 1);
  }, [ver]);

  if (ver.ok) return <Klar rubrik="Koden stämmer" text="Nu väljer du ett nytt lösenord…" till="/byt-losenord" />;

  return (
    <>
      <h1 className="in-rubrik">{skickad ? "Skriv in koden" : utgatt ? "Tiden gick ut" : "Glömt lösenordet?"}</h1>
      <p className="in-ingress">
        {utgatt && !skickad ? (
          `Ett nytt lösenord efter en kod ska väljas inom ${ATERSTALL_MINUTER} minuter. Be om en ny kod, så fortsätter du där du var.`
        ) : (
          <>
            {skickad ? "Vi har mejlat en kod till " : "Vi mejlar en kod till "}
            <b>{epost}</b>. Med den väljer du ett nytt lösenord utan det gamla.
          </>
        )}
      </p>
      {skickad ? (
        <KodSteg
          skickad={skickad}
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
          {fel ? <Fel id="in-formfel">{fel}</Fel> : null}
          <button type="submit" className="in-knapp" disabled={skickar}>
            {skickar ? "Skickar…" : "Skicka koden"}
          </button>
          {tillbaka ? (
            <>
              <hr className="in-skilje" />
              <div className="in-rad" data-mitt="">
                <button type="button" className="in-lank" onClick={tillbaka}>
                  Jag kom på det
                </button>
              </div>
            </>
          ) : null}
        </form>
      )}
    </>
  );
}
