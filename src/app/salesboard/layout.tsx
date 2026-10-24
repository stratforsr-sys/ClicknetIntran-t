import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./tavla.css";

/**
 * Säljtavlans skal: typsnitten och ingen Nav-ram. Tavlan är en duk på hela
 * skärmen, och parningen och inställningarna har sina egna sidor under den.
 *
 * Typsnitten är Nav 2.0:s egna filer i public/nav2/fonts, laddade genom
 * next/font som i logga-in/Skal.tsx: adressen /nav2/fonts kräver inloggning i
 * mellanvaran, och en parad TV är inte inloggad. next/font lägger dem under
 * /_next/static, som mellanvaran släpper förbi. Variablerna heter som i
 * utkastet (--f-display, --f-body, --f-mono), och tavla.css läser dem.
 */
const brodtext = localFont({
  src: "../../../public/nav2/fonts/geist.woff2",
  weight: "100 900",
  variable: "--f-body",
  display: "swap",
});

const rubrik = localFont({
  src: "../../../public/nav2/fonts/bricolage.woff2",
  weight: "200 800",
  variable: "--f-display",
  display: "swap",
});

const mono = localFont({
  src: "../../../public/nav2/fonts/geist-mono.woff2",
  weight: "100 900",
  variable: "--f-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Säljtavlan",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0F2A22",
};

export default function SaljtavlansSkal({ children }: { children: React.ReactNode }) {
  return <div className={`${brodtext.variable} ${rubrik.variable} ${mono.variable}`}>{children}</div>;
}
