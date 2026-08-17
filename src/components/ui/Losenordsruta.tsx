import { Notis } from "./Notis";

/**
 * Visar ett tillfalligt losenord en enda gang.
 *
 * Ingen kopieringsknapp med flit: ett losenord i urklipp foljer med till nasta
 * fonster utan att nagon ber om det. Det har ska lasas upp eller skrivas av,
 * och sedan bytas av den som ager kontot.
 */
export function Losenordsruta({ losenord, namn }: { losenord: string; namn?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <Notis ton="ok">
        Kontot är klart{namn ? ` för ${namn}` : ""}. Lösenordet visas bara nu — lämnas det här
        fönstret går det inte att få fram igen, bara att sätta ett nytt.
      </Notis>

      <p
        className="select-all rounded-sm bg-surface-alt px-4 py-3 text-center font-mono text-h2 tracking-wide text-ink-900"
        aria-label={`Tillfälligt lösenord: ${losenord.split("").join(" ")}`}
      >
        {losenord}
      </p>

      <p className="max-w-[70ch] text-small text-ink-500">
        Läs upp det för personen och be hen byta lösenord under Profil vid första inloggningen.
        Så länge ni delar ordet är det inte längre bara hens konto — och loggen bygger på att det
        är det.
      </p>
    </div>
  );
}
