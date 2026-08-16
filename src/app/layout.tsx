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
