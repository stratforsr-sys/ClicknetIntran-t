import Link from "next/link";
import { Ikon } from "@/components/shell/Ikon";
import { SparrInnehall } from "./Innehall";

export const dynamic = "force-dynamic";
export const metadata = { title: "Spärrar — Clicknet Nav" };

/**
 * Var K12 bor numera.
 *
 * Tidigare låg spärren som en kommentar i `src/lib/tid.ts` och en konstant som
 * någon skulle komma ihåg att ändra i samma stund som juridiken blev klar. Två
 * saker som ska hända samtidigt, på två olika ställen, av två olika personer —
 * det håller inte över tid.
 *
 * Nu är underlaget dokument i rutinbiblioteket, villkoren en trigger i
 * databasen, och påslaget ett knapptryck som loggas med namn och datum.
 *
 * Själva innehållet ligger i `Innehall.tsx` och delas med panelen i
 * inställningsrutan. Den här filen är sidhuvudet runt det.
 */
export default function SparrSida() {
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
        <h1 className="text-display text-ink-900">Spärrar</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Vad som är påslaget, på vilken grund, och vad som saknas för resten. Villkoren
          kontrolleras i databasen — den här sidan visar dem, den bestämmer dem inte.
        </p>
      </div>

      <SparrInnehall />
    </div>
  );
}
