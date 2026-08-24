import Link from "next/link";
import { Ikon } from "@/components/shell/Ikon";
import { SchemaInnehall } from "./Innehall";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scheman — Clicknet Nav" };

export default function SchemaSida() {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/tid"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till tid
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Scheman</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Arbetsschemat avgör när en glömd utstämpling stängs. Rastschemat avgör vad som räknas
          som en avvikelse. Ett schema ändras aldrig — varje ändring är en ny rad med ett datum,
          och dagar som redan varit bedöms mot det som gällde då.
        </p>
      </div>

      <SchemaInnehall />
    </div>
  );
}
