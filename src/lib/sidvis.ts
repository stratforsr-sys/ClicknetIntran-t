/**
 * Sidvis lasning, och listor i omgangar.
 *
 * Supabase-API:t kapar ett svar vid 1000 rader, och det gor det TYST: svaret
 * ser ut som hela tabellen. En `.in()` med tusen uuid blir dessutom en URL pa
 * runt 37 kB, som API-lagret kan neka. Bada felen ger en kortare lista och
 * inget annat tecken, och for ett registerutdrag ar en kortare lista ett fel
 * svar pa artikel 15.
 *
 * Ren: ingen databas har, bara anropen. `sida` ar en `.range(fran, till)` pa en
 * fraga med STABIL ordning — utan `.order()` pa en unik nyckel kan tva sidor
 * overlappa eller hoppa over rader.
 */

type Sidsvar<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Laser sida for sida tills en sida ar kortare an `storlek`.
 *
 * Exakt `storlek` rader ger ett anrop till, som kommer tillbaka tomt. Det ar
 * priset for att aldrig behova fraga efter antalet forst.
 *
 * Ett fel KASTAS, aven pa en senare sida. Forsta sidans rader far aldrig
 * lamnas ut som om de vore allt.
 */
export async function lasSidvis<T>(
  sida: (fran: number, till: number) => PromiseLike<Sidsvar<T>>,
  storlek = 1000,
): Promise<T[]> {
  const alla: T[] = [];
  for (let fran = 0; ; fran += storlek) {
    const { data, error } = await sida(fran, fran + storlek - 1);
    if (error) throw new Error(error.message);
    const rader = data ?? [];
    alla.push(...rader);
    if (rader.length < storlek) return alla;
  }
}

/** Delar en lista i omgangar om hogst `storlek`, i ordning. */
export function delaUpp<T>(lista: readonly T[], storlek: number): T[][] {
  const omgangar: T[][] = [];
  for (let i = 0; i < lista.length; i += storlek) omgangar.push(lista.slice(i, i + storlek));
  return omgangar;
}

/**
 * Kor `gor` for varje element, hogst `samtidigt` at gangen, och ger svaren i
 * listans ordning. For lasningar som ar for manga for att ga i tur och ordning
 * inom en funktions tidsgrans, men inte ska oversvamma databasen med alla pa
 * en gang.
 */
export async function iTur<T, R>(lista: readonly T[], samtidigt: number, gor: (t: T) => Promise<R>): Promise<R[]> {
  const ut = new Array<R>(lista.length);
  let nasta = 0;
  const arbetare = async () => {
    while (nasta < lista.length) {
      const i = nasta++;
      ut[i] = await gor(lista[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(samtidigt, lista.length) }, arbetare));
  return ut;
}
