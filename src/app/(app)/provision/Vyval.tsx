"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Styrningen i den mörka panelen: VILKEN MÅNAD och VEMS SIFFROR.
 *
 * ===========================================================================
 * DEN LIGGER I PANELEN OCH INTE OVANFÖR DEN, OCH DET FÖLJER AV VAD DEN GÖR.
 *
 * Väljarna byter ut precis det som står i panelen — talet, delarna, banan. En
 * kontroll som står utanför den yta den styr läses som en sidfilter som råkar
 * påverka något; en som står i ytan läses som ytans egen rubrikrad. Det är
 * samma resonemang som gav korten sina flikar i `Flikar.tsx`: styrningen hör
 * till det den styr.
 *
 * ---------------------------------------------------------------------------
 * PERIODEN ÄR EN MÅNAD, INTE ETT FRITT DATUMSPANN, OCH DET ÄR INTE EN GENVÄG.
 *
 * Volymbonusen är en egenskap hos HELA MÅNADEN — nivån bestäms av månadens
 * samlade ordervolym och gäller sedan samtliga order i den (avsnitt 5.2). Ett
 * fritt spann som "1–15 september" har därför ingen bonusnivå att visa: halva
 * månadens order når kanske nivå 5, men de pengarna finns inte förrän månaden
 * är slut, och de kan gå upp eller ner beroende på vad som händer efter den
 * 15:e.
 *
 * Ett sådant spann hade alltså gett ett tal som ser ut som provision och som
 * ingen kan betala ut. Månaden är den minsta enhet som HAR ett svar — det är
 * också den enhet perioden stängs i, bonusen räknas i och lönen betalas i.
 *
 * Vill man se rörelsen inne i månaden finns stapelraden. Den är den frågan.
 * ===========================================================================
 *
 * INGEN `useSearchParams` HÄR. Den kräver en Suspense-gräns och gör
 * komponenten beroende av renderingsläget; sidan vet redan vilka två
 * parametrar som finns och skickar in dem. Två parametrar är hela adressen, så
 * länken går att bygga utan att läsa den.
 */

export type Vyalternativ = { varde: string; etikett: string };

export function Vyval({
  manad,
  manader,
  vy,
  vyer,
}: {
  manad: string;
  manader: Vyalternativ[];
  /** `jag`, `foretag` eller ett employee-id. */
  vy: string;
  /** Tom lista döljer vemväljaren helt — det är säljarens läge. */
  vyer: Vyalternativ[];
}) {
  const router = useRouter();

  // ===========================================================================
  // KNAPPEN FINNS BARA UTAN JAVASCRIPT, och det är därför den mäts fram i
  // stället för att bara döljas med CSS.
  //
  // Med javascript navigerar `onChange` direkt och en Visa-knapp bredvid är en
  // knapp som inte gör något — det värsta slaget, för den lär användaren att
  // val inte gäller förrän man tryckt. Utan javascript är formuläret ett
  // vanligt GET-formulär och knappen är enda vägen vidare.
  //
  // `useEffect` körs bara i webbläsaren, så serverns HTML bär alltid knappen.
  // ===========================================================================
  const [harJs, setHarJs] = useState(false);
  useEffect(() => setHarJs(true), []);

  const ga = (nyManad: string, nyVy: string) =>
    router.push(`/provision?manad=${nyManad}&vy=${nyVy}`);

  return (
    <form
      method="get"
      action="/provision"
      className="flex flex-wrap items-center gap-2"
      aria-label="Vad panelen visar"
    >
      {vyer.length > 0 && (
        <Valjare
          namn="vy"
          etikett="Vems siffror"
          varde={vy}
          alternativ={vyer}
          onVal={(v) => ga(manad, v)}
        />
      )}

      <Valjare
        namn="manad"
        etikett="Period"
        varde={manad}
        alternativ={manader}
        onVal={(m) => ga(m, vy)}
      />

      {/* Utan vemväljare måste `vy` ändå följa med, annars nollställs den av
          ett periodbyte gjort utan javascript. */}
      {vyer.length === 0 && <input type="hidden" name="vy" value={vy} />}

      {!harJs && (
        <button
          type="submit"
          className="min-h-9 rounded-full bg-brand-500 px-4 text-small font-semibold text-brand-950"
        >
          Visa
        </button>
      )}
    </form>
  );
}

/**
 * En väljare på mörk platta.
 *
 * INGA HEXVÄRDEN (UI-PRD §11) — varje ton är en token. `Select` i `Field.tsx`
 * används inte: den är byggd för vit yta med `bg-surface` och `shadow-elev-1`,
 * och en vit ruta mitt i den mörka panelen hade blivit det ögat fastnade på i
 * stället för talet ovanför.
 *
 * Etiketten är `sr-only`. Den behövs för skärmläsaren — "september 2026" utan
 * sammanhang säger inte vad kontrollen gör — men utskriven hade den lagt två
 * rader text ovanför ett tal som ska vara det man ser först.
 */
function Valjare({
  namn,
  etikett,
  varde,
  alternativ,
  onVal,
}: {
  namn: string;
  etikett: string;
  varde: string;
  alternativ: Vyalternativ[];
  onVal: (varde: string) => void;
}) {
  return (
    <span className="relative inline-flex items-center">
      <label htmlFor={`vyval-${namn}`} className="sr-only">
        {etikett}
      </label>
      <select
        id={`vyval-${namn}`}
        name={namn}
        defaultValue={varde}
        onChange={(e) => onVal(e.target.value)}
        className={[
          "min-h-9 appearance-none rounded-full bg-brand-800 py-1.5 pr-9 pl-4",
          "text-small font-semibold text-ink-inv",
          "ring-1 ring-brand-700 transition-shadow duration-fast ease-brand",
          "hover:ring-brand-500 focus:ring-2 focus:ring-brand-500 focus:outline-none",
        ].join(" ")}
      >
        {alternativ.map((a) => (
          <option key={a.varde} value={a.varde}>
            {a.etikett}
          </option>
        ))}
      </select>
      {/* Pilen ritas för hand — `appearance-none` tar bort webbläsarens egen,
          och systemets pil är svart och försvinner mot `brand-800`. */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-4 text-micro text-brand-200"
      >
        ▾
      </span>
    </span>
  );
}
