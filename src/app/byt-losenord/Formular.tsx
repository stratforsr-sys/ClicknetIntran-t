"use client";

import { useActionState, useEffect, useState } from "react";
import { MIN_TECKEN, bitar, styrka } from "@/lib/losenordskrav";
import { foreslaLosenord } from "@/lib/losenordsforslag";
import { Fel, LosenordsFalt } from "@/app/logga-in/falt";
import { skyddad } from "@/app/logga-in/natlage";
import { Klar } from "@/app/logga-in/steg";
import { bytLosenord, type BytState } from "./actions";
import { KodForByte } from "./KodForByte";

const TOM: BytState = {};

const BYT = skyddad<BytState>(bytLosenord, (fel) => ({ fel: [fel] }));

export type Bytesorsak = "glomt" | "tvingat" | "frivilligt";

const TON: Record<string, { steg: number; ord: string }> = {
  svagt: { steg: 1, ord: "Svagt" },
  godkant: { steg: 2, ord: "Godkänt" },
  starkt: { steg: 3, ord: "Starkt" },
};

/**
 * Kraven, som bockas av medan man skriver. Samma två som `granska()` i
 * losenordskrav.ts dömer efter på servern; servern har sista ordet.
 */
function Krav({ losenord }: { losenord: string }) {
  const krav = [
    { ok: [...losenord].length >= MIN_TECKEN, text: `Minst ${MIN_TECKEN} tecken` },
    { ok: /\d/.test(losenord), text: "Minst en siffra" },
  ];
  return (
    <ul className="in-krav" aria-label="Krav på lösenordet">
      {krav.map((k) => (
        <li key={k.text} data-ok={k.ok ? "" : undefined}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
            {k.ok ? (
              <path d="m5.25 8.25 1.9 1.9 3.6-3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            ) : null}
          </svg>
          {k.text}
          <span className="in-sr">{k.ok ? " (uppfyllt)" : " (inte uppfyllt än)"}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Mätlinjen räknas i webbläsaren och avgör ingenting. Den finns för att en
 * människa ska se skillnad på tre ord och ett ord med en trea i. Ett godkänt
 * lösenord kan visa "Svagt": raden är ett råd, inget krav.
 */
function Styrkemat({ losenord }: { losenord: string }) {
  if (losenord.length === 0) return null;
  const t = TON[styrka(losenord)];
  return (
    <div className="in-styrka" data-steg={t.steg}>
      <span className="in-styrka-spar" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        {t.ord} · <span className="in-mono">{bitar(losenord)} bitar</span>
      </span>
    </div>
  );
}

/**
 * Raden under ett föreslaget lösenord. Förslaget står i klartext i fältet så
 * att det går att läsa av; Kopiera lägger det i urklipp. Går urklipp inte att
 * nå (en äldre webbläsare, en sida utan behörighet) markeras texten i fältet
 * i stället, så att det går att kopiera själv.
 */
function Forslagsrad({ forslag }: { forslag: string }) {
  const [kopierat, setKopierat] = useState<"ja" | "markerat" | null>(null);

  useEffect(() => {
    if (!kopierat) return;
    const t = window.setTimeout(() => setKopierat(null), 2500);
    return () => window.clearTimeout(t);
  }, [kopierat]);

  async function kopiera() {
    try {
      await navigator.clipboard.writeText(forslag);
      setKopierat("ja");
    } catch {
      document.querySelector<HTMLInputElement>("#nytt")?.select();
      setKopierat("markerat");
    }
  }

  return (
    <div className="in-forslagsrad">
      <span>Spara det i lösenordshanteraren.</span>
      <button type="button" className="in-lank" onClick={kopiera}>
        {kopierat === "ja" ? "Kopierat" : kopierat === "markerat" ? "Markerat" : "Kopiera"}
      </button>
      <span className="in-sr" role="status">
        {kopierat === "ja" ? "Lösenordet är kopierat." : kopierat === "markerat" ? "Lösenordet är markerat i fältet." : ""}
      </span>
    </div>
  );
}

function rubrik(orsak: Bytesorsak, fornamn: string | null): string {
  if (orsak === "glomt") return "Välj ett nytt lösenord";
  if (orsak === "tvingat") return fornamn ? `Välkommen till navet, ${fornamn}` : "Välkommen till navet";
  return "Byt lösenord";
}

function ingress(orsak: Bytesorsak, fore: string | null): string {
  if (orsak === "glomt") {
    return `Du loggade in med en kod. Välj ett nytt lösenord${fore ? ` före ${fore}` : ""}; det gamla slutar gälla när du sparat.`;
  }
  if (orsak === "tvingat") {
    return "Välj ett eget lösenord. Det du fick är känt av den som lade upp dig, det här blir bara ditt.";
  }
  return "Det gamla slutar gälla så fort du sparat det nya.";
}

export function Formular({
  orsak,
  epost,
  fornamn,
  fore,
}: {
  orsak: Bytesorsak;
  epost: string;
  /** Förnamnet, vid första inloggningen. */
  fornamn: string | null;
  /** När kvittot från koden går ut ("22:02"), vid "Glömt lösenordet?". */
  fore: string | null;
}) {
  const [state, action, vantar] = useActionState(BYT, TOM);
  // "Glömt det?": en kod i stället för det gamla lösenordet.
  const [kodVag, setKodVag] = useState(false);
  const [nytt, setNytt] = useState("");
  const [upprepat, setUpprepat] = useState("");
  const [forslag, setForslag] = useState<string | null>(null);
  // Fokus i upprepningen: så länge den är början på det nya skriver man fortfarande.
  const [skriverIgen, setSkriverIgen] = useState(false);
  const [nr, setNr] = useState(0);

  // React tömmer formuläret efter svaret; fälten får nya nycklar och
  // speglingen av dem nollas, så att mätaren inte visar ett ord som är borta.
  useEffect(() => {
    if (state === TOM) return;
    setNr((n) => n + 1);
    setNytt("");
    setUpprepat("");
    setForslag(null);
  }, [state]);

  if (state.klar) {
    return (
      <Klar
        rubrik={orsak === "tvingat" && fornamn ? `Klart, ${fornamn}` : "Lösenordet är bytt"}
        text="Öppnar navet…"
        till="/nav2"
      />
    );
  }

  if (state.ut) {
    return (
      <>
        <h1 className="in-rubrik">Du är utloggad</h1>
        <p className="in-ingress">Sessionen tog slut innan lösenordet hann sparas. Logga in igen, så kommer du tillbaka hit.</p>
        <a className="in-knapp" href="/logga-in?nasta=%2Fbyt-losenord">
          Logga in igen
        </a>
      </>
    );
  }

  if (kodVag || state.utgatt) {
    return <KodForByte epost={epost} utgatt={Boolean(state.utgatt)} tillbaka={state.utgatt ? undefined : () => setKodVag(false)} />;
  }

  function foresla() {
    const f = foreslaLosenord();
    setForslag(f);
    setNytt(f);
    setUpprepat(f);
  }

  // Olika när upprepningen inte längre kan bli rätt: den har gått ifrån det
  // nya, eller man har lämnat den. Mitt i ordet är det alltid olika, och ett
  // fel innan man skrivit klart är bara störande. Ändrar man det nya efteråt
  // syns det direkt.
  const olika = upprepat.length > 0 && upprepat !== nytt && (!skriverIgen || !nytt.startsWith(upprepat));
  // Förslaget som det står: fyra slumpade ord och ett tal, runt 37 bitar.
  // Mätaren räknar ur längden och teckenslagen och hade sagt över hundra.
  const orortForslag = forslag !== null && nytt === forslag;
  const felId = "in-formfel";

  return (
    <>
      <h1 className="in-rubrik">{rubrik(orsak, fornamn)}</h1>
      <p className="in-ingress">{ingress(orsak, fore)}</p>

      <form action={action} className="in-form" noValidate aria-busy={vantar}>
        {/* Användarnamnet följer med osynligt, så att lösenordshanteraren vet
            vilket konto det nya lösenordet hör till. */}
        <input type="text" name="username" autoComplete="username" value={epost} readOnly hidden />
        <input type="hidden" name="orsak" value={orsak} />

        {orsak !== "glomt" ? (
          <LosenordsFalt
            key={`g-${nr}`}
            id="gammalt"
            etikett={orsak === "tvingat" ? "Lösenordet du fick" : "Nuvarande lösenord"}
            autoComplete="current-password"
            hjalp={orsak === "tvingat" ? "Samma som du precis loggade in med." : undefined}
            beskrivs={state.fel ? felId : undefined}
            tillagg={
              <button type="button" className="in-lank" onClick={() => setKodVag(true)}>
                Glömt det?
              </button>
            }
          />
        ) : null}

        <div className="in-falt">
          <LosenordsFalt
            key={`n-${nr}-${forslag ?? ""}`}
            id="nytt"
            etikett="Nytt lösenord"
            autoComplete="new-password"
            minLength={MIN_TECKEN}
            defaultValue={forslag ?? undefined}
            synligtStart={forslag !== null}
            onVarde={setNytt}
            tillagg={
              <button type="button" className="in-lank" onClick={foresla}>
                {forslag ? "Ett annat förslag" : "Föreslå ett åt mig"}
              </button>
            }
          />
          {orortForslag ? <Forslagsrad forslag={forslag} /> : null}
          <Krav losenord={nytt} />
          {orortForslag ? null : <Styrkemat losenord={nytt} />}
        </div>

        <div className="in-falt" onFocus={() => setSkriverIgen(true)} onBlur={() => setSkriverIgen(false)}>
          <LosenordsFalt
            key={`u-${nr}-${forslag ?? ""}`}
            id="upprepat"
            etikett="Nytt lösenord igen"
            autoComplete="new-password"
            defaultValue={forslag ?? undefined}
            fel={olika}
            beskrivs={olika ? "upprepat-olika" : undefined}
            onVarde={setUpprepat}
          />
          {olika ? (
            <p id="upprepat-olika" className="in-fel" aria-live="polite">
              De två stämmer inte överens.
            </p>
          ) : null}
        </div>

        {state.fel && state.fel.length > 0 ? (
          <Fel id={felId}>
            {state.fel.length === 1 ? (
              state.fel[0]
            ) : (
              <span className="in-fellista">
                {state.fel.map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </span>
            )}
          </Fel>
        ) : null}

        <button type="submit" className="in-knapp" disabled={vantar}>
          {vantar ? "Sparar…" : orsak === "frivilligt" ? "Byt lösenord" : "Spara och fortsätt"}
        </button>
      </form>
    </>
  );
}
