import Link from "next/link";
import { Ikon } from "@/components/shell/Ikon";
import { SatsInnehall } from "./Innehall";

export const dynamic = "force-dynamic";
export const metadata = { title: "Satser och löner — Clicknet Nav" };

export default function Satssida() {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/lonekostnad"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till lönekostnad
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Satser och löner</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Varje sats som lönekostnaden räknar med står här. Ingen av dem finns i koden, så en
          ändring gäller i samma stund — även för en omräkning av en gammal period.
        </p>
      </div>

      <SatsInnehall />
    </div>
  );
}
