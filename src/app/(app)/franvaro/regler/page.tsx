import Link from "next/link";
import { Ikon } from "@/components/shell/Ikon";
import { RegelInnehall } from "./Innehall";

export const dynamic = "force-dynamic";
export const metadata = { title: "Frånvaroregler — Clicknet Nav" };

export default function Reglersida() {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/franvaro"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till frånvaro
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Frånvaroregler</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Reglerna bor i databasen och inte i koden. Ändrar du ett tal här gäller det direkt, både
          för regelmotorn och för texten den anställda ser innan hen skickar in. Varje ändring
          hamnar i händelseloggen.
        </p>
        <p className="mt-2 max-w-[70ch] text-small text-ink-500">
          Värdena som står nu är <strong>semesterlagens och LAS miniminivå</strong>. A2 besvarades
          2026-08-20 med att kollektivavtal saknas. Tecknas ett avtal är det de här raderna som ska
          ändras.
        </p>
      </div>

      <RegelInnehall />
    </div>
  );
}
