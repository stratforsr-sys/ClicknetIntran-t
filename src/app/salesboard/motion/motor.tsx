"use client";

/**
 * Rörelsemotorn för Säljtavlan: den del av Remotion som kompositionerna behöver,
 * utan beroende. Se matte.ts för varför och för vad som medvetet skiljer.
 *
 * En komposition är en komponent som är en ren funktion av bildrutan:
 * `useCurrentFrame()` ger bildrutan, `useVideoConfig()` ger fps och duk, och
 * `Sequence` förskjuter bildrutan för sina barn. Ingenting rör sig av sig självt.
 * `Spelare` är det enda som har en klocka, och den ger bildrutan åt hela trädet.
 *
 * Filen är en klientfil, så den kan bara importeras från andra klientfiler.
 * Vill en servermodul åt matematiken importeras den från matte.ts.
 */

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type ComponentType,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { BREDD, FPS, HOJD, sekvensFonster, stegaSpelare, type Spelstatus } from "./matte.ts";

// Remotions API. Kompositionerna importerar härifrån, och den dag bolaget köper
// licensen byts den här sökvägen mot "remotion". Matematiken ligger i matte.ts
// (ren, provad med node) och exporteras om här, så att en komposition bara
// behöver en import.
export { BREDD, Easing, FPS, HOJD, interpolate, measureSpring, spring } from "./matte.ts";
export type { EasingFunction, ExtrapolateType, InterpolateOptions, SpringArgs, SpringConfig } from "./matte.ts";

export type VideoConfig = {
  width: number;
  height: number;
  fps: number;
  /** Kompositionens längd, och inne i en Sequence dess längd (som i Remotion). */
  durationInFrames: number;
};

// Bildrutan som hela trädet läser. null utanför en Spelare, så att en komposition
// som renderas på fel ställe kastar i stället för att tyst stå på bildruta 0.
const Bildruta = createContext<number | null>(null);
const Videokonfig = createContext<VideoConfig | null>(null);

/** Bildrutan, räknad från närmaste Sequence (eller från Spelarens start). */
export function useCurrentFrame(): number {
  const bildruta = useContext(Bildruta);
  if (bildruta === null) {
    throw new Error("useCurrentFrame() kan bara anropas inuti en komposition som spelas av <Spelare>");
  }
  return bildruta;
}

/** Fps, duk och längd. Duken är alltid 1920×1080 vid 60 bilder per sekund. */
export function useVideoConfig(): VideoConfig {
  const config = useContext(Videokonfig);
  if (config === null) {
    throw new Error("useVideoConfig() kan bara anropas inuti en komposition som spelas av <Spelare>");
  }
  return config;
}

const FYLL: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
};

/**
 * Fyller sin förälder, som Remotions AbsoluteFill: en absolut placerad div med
 * `display: flex` i kolumn. Egna `style` läggs ovanpå.
 */
export function AbsoluteFill({ style, ...ovrigt }: ComponentPropsWithRef<"div">): ReactElement {
  return <div style={style ? { ...FYLL, ...style } : FYLL} {...ovrigt} />;
}

export type SequenceProps = {
  /** Bildrutan, räknad från den omgivande, då barnen börjar. Ett heltal, negativt tillåtet. Standard 0. */
  from?: number;
  /** Hur många bildrutor barnen finns. Standard Infinity: för alltid. */
  durationInFrames?: number;
  /** "absolute-fill" (standard) lägger barnen i en AbsoluteFill, "none" lägger dem rakt av. */
  layout?: "absolute-fill" | "none";
  children?: ReactNode;
};

/**
 * Visar sina barn från bildruta `from` till men inte med `from + durationInFrames`,
 * och ger dem `frame - from` som bildruta. Utanför fönstret renderas ingenting,
 * så barnen monteras och avmonteras vid kanterna. Sekvenser kan ligga i varandra:
 * det inre `from` är relativt den yttre.
 *
 * Som i Remotion ger `useVideoConfig()` inne i en Sequence dess längd och inte
 * kompositionens, så att en komponent som tonar ut vid sin sista bildruta fungerar
 * likadant var den än placeras.
 */
export function Sequence({
  from = 0,
  durationInFrames = Infinity,
  layout = "absolute-fill",
  children,
}: SequenceProps): ReactElement | null {
  const yttre = useVideoConfig();
  const bildruta = useCurrentFrame();
  const lokal = sekvensFonster(bildruta, from, durationInFrames);
  const langd = Math.max(0, Math.min(durationInFrames, yttre.durationInFrames - from));
  const config = useMemo(() => ({ ...yttre, durationInFrames: langd }), [yttre, langd]);
  if (lokal === null) return null;

  const barn = (
    <Videokonfig.Provider value={config}>
      <Bildruta.Provider value={lokal}>{children}</Bildruta.Provider>
    </Videokonfig.Provider>
  );
  return layout === "none" ? barn : <AbsoluteFill>{barn}</AbsoluteFill>;
}

export type SpelareProps<P extends object> = {
  /** Kompositionen: en komponent som bara beror av sina props och av useCurrentFrame(). */
  komposition: ComponentType<P>;
  props: P;
  /** Längd i bildrutor (vid 60 per sekund). Kompositionen får bildruta 0 till varaktighet - 1. */
  varaktighet: number;
  /** Sekunder sedan förloppet startade: ljudklockan när ljudet går, annars performance.now(). */
  klocka: () => number;
  /** Anropas exakt en gång, när klockan nått varaktigheten. */
  onKlar: () => void;
};

const KLIPP: CSSProperties = { overflow: "hidden" };

/**
 * Spelar en komposition efter en klocka och ger varje bildruta åt trädet under.
 *
 * Bildrutan är `Math.floor(klocka() * FPS)`, räknad om vid varje målning
 * (requestAnimationFrame). En långsam enhet målar färre gånger och hoppar över
 * bildrutor, men spelar aldrig i slowmotion, och ljudet hänger med eftersom det
 * går på samma klocka. Bildrutan går aldrig bakåt, `onKlar` anropas en gång och
 * slingan stannar då. Avmonteras Spelaren avbryts nästa målning.
 *
 * Det som beslutas, alltså bildrutan och när det är klart, ligger i
 * `stegaSpelare` (matte.ts) och är provat där. Det här är bara slingan runt den.
 *
 * Spelaren spelar ett enda förlopp. För ett nytt förlopp, byt `key`.
 */
export function Spelare<P extends object>({
  komposition,
  props,
  varaktighet,
  klocka,
  onKlar,
}: SpelareProps<P>): ReactElement {
  // Första målningen ska redan vara rätt bildruta. Börjar klockan inte på noll (en
  // fryst klocka i förhandsvisningen, eller ett förlopp som hann starta medan sidan
  // byggdes) hade annars en bildruta 0 blinkat förbi.
  const [bildruta, settBildruta] = useState(
    () => stegaSpelare({ bildruta: 0, klar: false }, klocka(), varaktighet).bildruta,
  );
  const status = useRef<Spelstatus>({ bildruta, klar: false });

  // Slingan startas en gång, men ska alltid läsa de senaste klockan, längden och
  // callbacken: en förälder som skickar nya pilfunktioner vid varje rendering
  // får inte starta om slingan.
  const senaste = useRef({ klocka, onKlar, varaktighet });
  useEffect(() => {
    senaste.current = { klocka, onKlar, varaktighet };
  });

  useEffect(() => {
    let id = 0;
    const malning = () => {
      const nu = senaste.current;
      const fore = status.current;
      const steg = stegaSpelare(fore, nu.klocka(), nu.varaktighet);
      // Först tillståndet, sedan callbacken: kastar onKlar, eller avmonterar den
      // Spelaren, ska det ändå aldrig anropas en gång till.
      status.current = { bildruta: steg.bildruta, klar: steg.klar };
      if (steg.bildruta !== fore.bildruta) settBildruta(steg.bildruta);
      if (steg.nyligenKlar) nu.onKlar();
      if (!steg.klar) id = requestAnimationFrame(malning);
    };
    id = requestAnimationFrame(malning);
    return () => cancelAnimationFrame(id);
  }, []);

  // Elementet byggs om bara när kompositionen eller dess props byts, inte vid varje
  // bildruta. React hoppar då över alla komponenter som inte läser bildrutan, och
  // bara de som anropar useCurrentFrame() renderas om.
  const innehall = useMemo(() => createElement(komposition, props), [komposition, props]);
  const config = useMemo<VideoConfig>(
    () => ({ width: BREDD, height: HOJD, fps: FPS, durationInFrames: varaktighet }),
    [varaktighet],
  );

  return (
    <Videokonfig.Provider value={config}>
      <Bildruta.Provider value={bildruta}>
        <AbsoluteFill style={KLIPP}>{innehall}</AbsoluteFill>
      </Bildruta.Provider>
    </Videokonfig.Provider>
  );
}
