import Link from "next/link";
import { cn } from "@/components/ui/cn";
import {
  SLAG_TON,
  arHelg,
  dagssumma,
  langd,
  veckodag,
  type Kalenderpost,
} from "@/lib/kalender";

/**
 * Veckan.
 *
 * =============================================================================
 * INGEN RUTNÄTSVECKA, OCH DET ÄR ETT VAL SOM SPARAR EN HALV DAGS ARBETE
 *
 * Den vanliga veckovyn är sju smala spalter med ett timrutnät i. Den ser
 * imponerande ut och är oanvändbar på det enda ställe den behövs: en spalt som
 * är en sjundedel av skärmen rymmer ungefär nio tecken, så varje post blir
 * "Ring Nord…" — och då säger vyn inte mer än att tiden är tagen, vilket man
 * ser ändå.
 *
 * Här är veckan i stället SJU KOLONNER MED LISTOR. Posterna får sin fulla
 * rubrik, dagarna får sin summa, och den som vill planera går till dagen — dit
 * kolumnrubriken leder med ett klick.
 *
 * VECKOSLUTET STÅR MED men är nedtonat. Att dölja lördag och söndag hade gjort
 * vyn smalare och ljugit om den halvdag någon faktiskt lade in.
 * =============================================================================
 */
export function Veckovy({
  poster,
  dagar,
  idag,
}: {
  poster: Kalenderpost[];
  dagar: string[];
  idag: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {dagar.map((d) => {
        const dagens = poster
          .filter((p) => p.dag === d)
          .sort((a, b) => (a.tid ?? "99:99").localeCompare(b.tid ?? "99:99"));
        const summa = dagssumma(dagens);

        return (
          <div
            key={d}
            className={cn(
              "flex min-h-32 flex-col gap-2 rounded-sm p-3",
              d === idag ? "bg-brand-100" : arHelg(d) ? "bg-canvas/60" : "bg-canvas",
            )}
          >
            <Link href={`/kalender?dag=${d}&vy=dag`} className="group flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  "text-small font-semibold transition-colors duration-fast group-hover:text-brand-700",
                  d === idag ? "text-brand-700" : arHelg(d) ? "text-ink-300" : "text-ink-900",
                )}
              >
                {VECKODAG[veckodag(d)]} {Number(d.slice(8, 10))}
              </span>
              {summa.minuter > 0 && (
                <span
                  className={cn(
                    "tnum text-micro",
                    summa.over ? "font-semibold text-warn-ink" : "text-ink-500",
                  )}
                >
                  {langd(summa.minuter)}
                </span>
              )}
            </Link>

            {dagens.length === 0 ? (
              <p className="text-micro text-ink-300">—</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {dagens.map((p) => (
                  <li key={p.id}>
                    <Post post={p} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Post({ post }: { post: Kalenderpost }) {
  const innehall = (
    <>
      <span
        aria-hidden
        className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", PRICK[SLAG_TON[post.slag]] ?? "bg-brand-500")}
      />
      <span className="min-w-0 flex-1">
        {post.tid && <span className="tnum pr-1 text-micro text-ink-500">{post.tid}</span>}
        <span
          className={cn(
            "text-small",
            post.klar ? "text-ink-300 line-through" : post.forsenad ? "text-danger-ink" : "text-ink-700",
          )}
        >
          {post.rubrik ?? "Upptagen"}
        </span>
      </span>
    </>
  );

  const klasser = "flex items-start gap-1.5 rounded-sm bg-surface px-2 py-1.5";

  return post.href ? (
    <Link href={post.href} className={cn(klasser, "transition-colors duration-fast hover:text-brand-700")}>
      {innehall}
    </Link>
  ) : (
    <span className={klasser}>{innehall}</span>
  );
}

const PRICK: Record<string, string> = {
  brand: "bg-brand-500",
  info: "bg-info",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
};

const VECKODAG: Record<number, string> = {
  1: "Mån", 2: "Tis", 3: "Ons", 4: "Tors", 5: "Fre", 6: "Lör", 7: "Sön",
};
