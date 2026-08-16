import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * UI-PRD §4.4. Plus Jakarta Sans ar sajtens eget typsnitt (avlast fran
 * clicknet.se) och star pa PRD:ns kandidatlista for bade display och brodtext.
 * Inter, Roboto, Open Sans och Helvetica ar forbjudna.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-data",
  display: "swap",
});

/**
 * Allt renderas dynamiskt. Skalet: CSP:n satter ett nytt nonce per svar, och
 * ett prerenderat svar kan inte bara ett nonce som varierar. Utan detta far
 * Next:s egna inline-skript inget nonce och blockeras av 'strict-dynamic' —
 * sidan renderar men hydrerar aldrig.
 *
 * Kostnaden ar noll i praktiken: varje vy bakom inloggning ar redan dynamisk
 * eftersom den laser sessionscookien. Endast /logga-in var statisk.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Clicknet Nav",
  description: "Intranät för Clicknet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv" className={`${jakarta.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
