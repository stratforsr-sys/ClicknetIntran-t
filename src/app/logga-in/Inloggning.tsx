"use client";

import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { FORSOK_INNAN_KOD, kvarText, liknarEpost, normaliseraEpost } from "@/lib/inloggning";
import { glomKontot, loggaInMedKod, loggaInMedLosenord, skickaKod, type LoginState } from "./actions";
import { Besked, EpostFalt, Fel, KontoRad, LosenordsFalt, type KontoVy } from "./falt";
import { skyddad, useNatlage } from "./natlage";
import { Klar, KodSteg, nySkickad, useNu, type Skickad } from "./steg";

const TOM: LoginState = {};

/** Nådde handlingen inte fram står adressen kvar, med ett fel som säger varför. */
function vidNatfel(fel: string, _forra: LoginState, form: FormData): LoginState {
  return { fel, felkod: "natfel", epost: normaliseraEpost(form.get("epost")) || undefined };
}

/*
 * Handlingarna, med omslaget mot nätfel (natlage.ts) och med de kontroller som
 * inte behöver servern. Servern gör samma kontroller igen; de här sparar bara
 * en resa för ett tomt fält.
 */
const LOGGA_IN = skyddad<LoginState>(async (forra, form) => {
  const epost = normaliseraEpost(form.get("epost"));
  if (!epost) return { fel: "Skriv din e-postadress.", falt: "epost" };
  if (!form.get("losenord")) return { fel: "Skriv ditt lösenord.", falt: "losenord", epost };
  return loggaInMedLosenord(forra, form);
}, vidNatfel);

const SKICKA = skyddad<LoginState>(async (forra, form) => {
  if (!normaliseraEpost(form.get("epost"))) return { fel: "Skriv din e-postadress.", falt: "epost" };
  return skickaKod(forra, form);
}, vidNatfel);

const VERIFIERA = skyddad<LoginState>(async (forra, form) => {
  if (!String(form.get("kod") ?? "").replace(/\D/g, "")) {
    return { fel: "Skriv in koden från mejlet.", falt: "kod", epost: normaliseraEpost(form.get("epost")) };
  }
  return loggaInMedKod(forra, form);
}, vidNatfel);

type Lage = "losenord" | "kod" | "glomt";

/** Besked som sidan fått med sig i adressen, från en annan del av navet. */
export type Ingang = "lank" | "utloggad" | null;

/** Vilken av de tre handlingarna som svarade senast, och vad den sa. */
type Svar = { fran: "losen" | "skick" | "ver"; s: LoginState; nr: number };

/**
 * Inloggningen. Lösenordet är förvalt; en kod till mejlen är andra vägen in och
 * samma väg som "Glömt lösenordet?".
 *
 * Den magiska länken är borttagen ur formuläret. Den kräver att Supabase
 * skickar tillbaka till rätt adress, och en kod gör samma sak utan att bero på
 * det, och fungerar när mejlet läses på telefonen och navet är öppet på
 * datorn. /auth/bekrafta står kvar för länkar som redan är skickade.
 *
 * Minns enheten kontot hälsar sidan med namn, adressfältet blir en rad med
 * kontot och bara lösenordet återstår.
 */
export function Inloggning({
  konto: sparat,
  nasta,
  mal,
  halsning,
  dag,
  ingang,
}: {
  konto: KontoVy | null;
  nasta: string;
  /** Vyn `nasta` öppnar ("Kalendern"), eller null för navet självt. */
  mal: string | null;
  halsning: string;
  dag: string;
  ingang: Ingang;
}) {
  const [lage, setLage] = useState<Lage>("losenord");
  const [konto, setKonto] = useState(sparat);
  const [byter, startByt] = useTransition();
  const [losen, loggaIn, loggarIn] = useActionState(LOGGA_IN, TOM);
  const [skick, skicka, skickar] = useActionState(SKICKA, TOM);
  const [ver, verifiera, verifierar] = useActionState(VERIFIERA, TOM);

  // Det senaste svaret. Nollas vid lägesbyte, så att ett gammalt fel inte
  // står kvar när man går tillbaka. `nr` ger fälten nya nycklar per svar.
  const [svar, setSvar] = useState<Svar | null>(null);
  // Adressen följer med mellan lägena, och tas ur varje svar: servern kan ha
  // fyllt i domänen.
  const [adress, setAdress] = useState(sparat?.epost ?? "");
  // Adressen koden gick till, och när. Nollas av "Ändra adressen".
  const [skickat, setSkickat] = useState<{ till: string; s: Skickad } | null>(null);
  // Fel lösenord i rad. Efter FORSOK_INNAN_KOD blir länken till koden en knapp.
  const [iRad, setIRad] = useState(0);
  const [sparrTill, setSparrTill] = useState(0);
  const [visaIngang, setVisaIngang] = useState(ingang !== null);

  const formRef = useRef<HTMLFormElement>(null);
  const fokusAdress = useRef(false);
  const nat = useNatlage();
  const nu = useNu(sparrTill);
  const sparr = Math.max(0, (sparrTill - nu) / 1000);

  function ta(fran: Svar["fran"], s: LoginState) {
    if (s === TOM || s.klar) return;
    if (s.epost) setAdress(s.epost);
    if (s.vanta) setSparrTill(Date.now() + s.vanta * 1000);
    setSvar((f) => ({ fran, s, nr: (f?.nr ?? 0) + 1 }));
    // Beskedet i adressen (utloggad, länken gick inte) gäller inte längre
    // när man själv försökt något.
    setVisaIngang(false);
  }

  useEffect(() => {
    ta("losen", losen);
    if (losen.felkod === "fel") setIRad((n) => n + 1);
  }, [losen]);

  useEffect(() => {
    ta("skick", skick);
    const till = skick.skickat;
    if (till) setSkickat((f) => ({ till, s: nySkickad(f?.till === till ? f.s : null) }));
  }, [skick]);

  useEffect(() => ta("ver", ver), [ver]);

  // Felet som hör till vyn som visas. I kodsteget kan det komma från både
  // "Skicka en ny kod" och "Logga in".
  const vy: Svar["fran"][] = lage === "losenord" ? ["losen"] : skickat ? ["skick", "ver"] : ["skick"];
  const fel = svar && vy.includes(svar.fran) && svar.s.fel ? svar.s : null;
  const nr = svar?.nr ?? 0;
  const felId = "in-formfel";

  /**
   * Fokus. Vid ett fel: fältet felet gäller. Annars första tomma fältet, men
   * bara med mus och tangentbord: på en telefon fäller tangentbordet upp och
   * täcker halva sidan innan man ens läst den. Kodsteget sköter sitt eget.
   */
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const falt = (namn: string) => form.querySelector<HTMLInputElement>(`input[name="${namn}"]:not([hidden]):not([type=hidden])`);
    if (fokusAdress.current) {
      fokusAdress.current = false;
      falt("epost")?.select();
      return;
    }
    if (fel?.falt) {
      falt(fel.falt)?.focus();
      return;
    }
    if (fel || !window.matchMedia("(pointer: fine)").matches) return;
    Array.from(form.querySelectorAll<HTMLInputElement>("input:not([hidden]):not([type=hidden])"))
      .find((el) => !el.value)
      ?.focus();
  }, [fel, lage, skickat, konto]);

  const klar = losen.klar ?? ver.klar;
  if (klar) {
    return <Klar rubrik={klar.namn ? `Välkommen, ${klar.namn}` : "Välkommen"} text={klar.text} till={klar.till} />;
  }

  /** Adressen i formuläret just nu, för lägesbyten. */
  function lasAdress() {
    const el = formRef.current?.querySelector<HTMLInputElement>('input[name="epost"]');
    if (el?.value) setAdress(el.value);
  }

  function nollaSvar() {
    setSvar((f) => (f ? { ...f, s: TOM, nr: f.nr + 1 } : null));
  }

  function byt(till: Lage) {
    lasAdress();
    nollaSvar();
    setSkickat(null);
    setLage(till);
    setVisaIngang(false);
  }

  function skickaTill(epost: string, syfte: Lage = lage) {
    const form = new FormData();
    form.set("epost", epost);
    if (syfte === "glomt") form.set("syfte", "glomt");
    startTransition(() => skicka(form));
  }

  /** Efter tre fel lösenord: en kod direkt, utan att skriva adressen igen. */
  function kodDirekt(epost: string) {
    nollaSvar();
    setLage("kod");
    skickaTill(epost, "kod");
  }

  function bytKonto() {
    startByt(async () => {
      try {
        await glomKontot();
      } catch {
        // Kakan står kvar. Nästa inloggning skriver över den ändå.
      }
      setKonto(null);
      setAdress("");
      setIRad(0);
      nollaSvar();
    });
  }

  const kodAdress = konto?.epost ?? adress;
  const erbjudKod = lage === "losenord" && iRad >= FORSOK_INNAN_KOD && liknarEpost(kodAdress);

  // Lampan säger att något är fel innan man ens försökt. Har ett försök redan
  // sagt samma sak står det bara en gång.
  const natBesked =
    fel?.felkod === "natfel" || fel?.felkod === "tjanst"
      ? null
      : nat.lage === "nere"
        ? "Inloggningen svarar inte just nu. Det beror inte på dig. Försök igen om en stund."
        : nat.lage === "offline"
          ? "Ingen anslutning till internet. Inloggningen fungerar när nätet är tillbaka."
          : null;

  const kontot = konto ? (
    <>
      {/* Användarnamnet följer med osynligt, för servern och för lösenordshanteraren. */}
      <input type="email" name="epost" value={konto.epost} autoComplete="username" readOnly hidden />
      <input type="hidden" name="sparat" value="1" />
      <KontoRad konto={konto} onByt={bytKonto} byter={byter} />
    </>
  ) : null;

  return (
    <>
      {lage === "losenord" ? (
        <>
          <h1 className="in-rubrik">{konto?.fornamn ? `${halsning}, ${konto.fornamn}` : halsning}</h1>
          <p className="in-dag">{dag}</p>
        </>
      ) : (
        <>
          <h1 className="in-rubrik">
            {skickat ? "Skriv in koden" : lage === "glomt" ? "Glömt lösenordet?" : "Logga in med kod"}
          </h1>
          <p className="in-ingress">
            {skickat ? (
              <>
                Om <b>{skickat.till}</b> har ett konto i navet har vi mejlat en kod dit.
                {lage === "glomt" ? " Med den väljer du sedan ett nytt lösenord." : null}
              </>
            ) : lage === "glomt" ? (
              "Vi mejlar en kod. Med den loggar du in och väljer ett nytt lösenord."
            ) : (
              "Vi mejlar en engångskod. Du kan läsa mejlet på telefonen och skriva koden här."
            )}
          </p>
        </>
      )}

      {mal && lage !== "glomt" ? (
        <p className="in-mal">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            Efter inloggningen öppnas <b>{mal}</b>.
          </span>
        </p>
      ) : null}

      {visaIngang && ingang === "utloggad" ? (
        <div className="in-forebesked">
          <Besked>Du är utloggad.</Besked>
        </div>
      ) : null}
      {visaIngang && ingang === "lank" ? (
        <div className="in-forebesked">
          <Fel id="in-ingang">
            Länken gick inte att använda. Den kan ha gått ut eller redan öppnats.{" "}
            <button type="button" className="in-lank" onClick={() => byt("kod")}>
              Få en kod i stället
            </button>
          </Fel>
        </div>
      ) : null}
      {natBesked ? (
        <div className="in-forebesked">
          <Besked ton="varning">{natBesked}</Besked>
        </div>
      ) : null}

      {lage === "losenord" ? (
        <form ref={formRef} action={loggaIn} className="in-form" noValidate aria-busy={loggarIn}>
          <input type="hidden" name="nasta" value={nasta} />
          {kontot ?? (
            <EpostFalt
              key={`e-${nr}`}
              defaultValue={adress}
              fel={fel?.falt === "epost"}
              beskrivs={fel?.falt === "epost" ? felId : undefined}
            />
          )}
          {fel?.falt === "epost" ? <Fel id={felId}>{fel.fel}</Fel> : null}
          <LosenordsFalt
            key={`p-${nr}`}
            id="losenord"
            etikett="Lösenord"
            autoComplete="current-password"
            fel={fel?.falt === "losenord"}
            beskrivs={fel && fel.falt !== "epost" ? felId : undefined}
            tillagg={
              <button type="button" className="in-lank" onClick={() => byt("glomt")}>
                Glömt lösenordet?
              </button>
            }
          />
          {fel && fel.falt !== "epost" ? <Fel id={felId}>{fel.fel}</Fel> : null}
          <button type="submit" className="in-knapp" disabled={loggarIn || sparr > 0}>
            {loggarIn ? (
              "Loggar in…"
            ) : sparr > 0 ? (
              <>
                Försök igen om <span className="in-mono">{kvarText(sparr)}</span>
              </>
            ) : (
              "Logga in"
            )}
          </button>
          <hr className="in-skilje" />
          <div className="in-rad" data-mitt="">
            {erbjudKod ? (
              <button type="button" className="in-knapp-sek" onClick={() => kodDirekt(kodAdress)}>
                Skicka en kod till {kodAdress} i stället
              </button>
            ) : (
              <button type="button" className="in-lank" onClick={() => byt("kod")}>
                Få en kod till mejlen i stället
              </button>
            )}
          </div>
        </form>
      ) : !skickat ? (
        <form ref={formRef} key={`s-${lage}`} action={skicka} className="in-form" noValidate aria-busy={skickar}>
          {lage === "glomt" ? <input type="hidden" name="syfte" value="glomt" /> : null}
          {kontot ?? (
            <EpostFalt
              key={`e-${nr}`}
              defaultValue={adress}
              fel={fel?.falt === "epost"}
              beskrivs={fel ? felId : undefined}
            />
          )}
          {fel ? <Fel id={felId}>{fel.fel}</Fel> : null}
          <button type="submit" className="in-knapp" disabled={skickar}>
            {skickar ? "Skickar…" : "Skicka koden"}
          </button>
          <hr className="in-skilje" />
          <div className="in-rad" data-mitt="">
            <button type="button" className="in-lank" onClick={() => byt("losenord")}>
              Logga in med lösenord
            </button>
          </div>
        </form>
      ) : (
        <>
          <KodSteg
            key={`v-${lage}-${skickat.till}`}
            skickad={skickat.s}
            action={verifiera}
            vantar={verifierar}
            knapp={lage === "glomt" ? "Fortsätt" : "Logga in"}
            fel={fel?.fel ?? null}
            nr={nr}
            skickaIgen={() => skickaTill(skickat.till)}
            skickarIgen={skickar}
            andra={() => {
              fokusAdress.current = true;
              nollaSvar();
              setSkickat(null);
            }}
          >
            <input type="hidden" name="epost" value={skickat.till} />
            <input type="hidden" name="nasta" value={nasta} />
            {lage === "glomt" ? <input type="hidden" name="syfte" value="glomt" /> : null}
          </KodSteg>
          <hr className="in-skilje in-efterkod" />
          <div className="in-rad in-efterkod" data-mitt="">
            <button type="button" className="in-lank" onClick={() => byt("losenord")}>
              Logga in med lösenord
            </button>
          </div>
        </>
      )}
    </>
  );
}
