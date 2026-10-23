/**
 * C6. Kursredigeraren uppdaterar ett provs fragor pa plats.
 *
 * Fram till 2026-10-22 skrevs fragorna om fran grunden vid varje sparning:
 * delete och insert. `learning_answer` och `team_repetition` kaskaderar pa
 * `quiz_question.id`, och `roleplay_self` pa `roleplay_criterion.id` (0097).
 * Ett rattat stavfel i ett prov tog alltsa varje saljares repetitionsschema,
 * kunskapskarta och svit med sig, och chefens fragor i lagets repetition.
 *
 * Har raknas i stallet ut vad som ska uppdateras, laggas till och tas bort.
 * Gamla och nya paras forst pa oforandrad text, sedan pa liknande text bland
 * dem som ar kvar. Bara position hade inte racket: tas fraga 2 av 3 bort hade
 * fraga 3 tagit over fraga 2:s id och svar, och en ny fraga hade fatt en
 * annans historik for att den rakade sta pa en ledig plats. Text forst haller
 * kvar en fraga som bara flyttat, och liknande text sedan en fraga vars text
 * rattats. En fraga som skrivits om helt ar en ny fraga, och den gamla tas bort
 * med sina svar — samma som fore C6, men bara for den fragan.
 *
 * Ren: ingen databas. Actionen i `utbildning/actions.ts` gor skrivningarna.
 */

const textnyckel = (t: string) => t.trim();

/** Gemener, utan accenter och med enkla blanksteg: "Vad gäller" och "vad galler" ar samma text. */
const jamforbar = (t: string) =>
  t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Hur lika tva texter ar, 0 till 1 (Dice pa teckenpar). Ett rattat stavfel
 * eller ett tillagt ord ger langt over halften; en annan fraga gor det inte.
 */
export function likhet(a: string, b: string): number {
  const par = (t: string) => {
    const ut = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) ut.set(t.slice(i, i + 2), (ut.get(t.slice(i, i + 2)) ?? 0) + 1);
    return ut;
  };
  const x = jamforbar(a), y = jamforbar(b);
  if (x === y) return 1;
  const pa = par(x), pb = par(y);
  const antal = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);
  const summa = antal(pa) + antal(pb);
  if (summa === 0) return 0;
  let gemensamma = 0;
  for (const [k, n] of pa) gemensamma += Math.min(n, pb.get(k) ?? 0);
  return (2 * gemensamma) / summa;
}

/** Fran den har likheten raknas en kvarvarande rad som samma rad med rattad text. */
export const LIKA_NOG = 0.5;

/**
 * Parar gamla rader med nya. Ny rad nummer i far `sort` i + 1.
 *
 * `par` ar de som uppdateras (det gamla id:t med den nya radens plats),
 * `lagg` de som ar nya och `tabort` id:n som inte langre finns.
 */
export function paraIhop<G extends { id: string; sort: number }, N>(
  gamla: readonly G[],
  nya: readonly N[],
  textG: (g: G) => string,
  textN: (n: N) => string,
): { par: { gammal: G; ny: N; sort: number }[]; lagg: { ny: N; sort: number }[]; tabort: string[] } {
  const kvar = [...gamla].sort((a, b) => a.sort - b.sort);
  const tagna = new Set<string>();
  const parat: (G | null)[] = nya.map(() => null);

  // Forst: samma text. Den forsta lediga gamla med texten vinner.
  nya.forEach((n, i) => {
    const g = kvar.find((x) => !tagna.has(x.id) && textnyckel(textG(x)) === textnyckel(textN(n)));
    if (g) {
      parat[i] = g;
      tagna.add(g.id);
    }
  });

  // Sedan: den mest lika av dem som ar kvar, om den ar lik nog. En rattad text
  // behaller sitt id; en ny fraga far aldrig en annans for att den star ledig.
  nya.forEach((n, i) => {
    if (parat[i]) return;
    let bast: G | null = null;
    let poang = LIKA_NOG;
    for (const g of kvar) {
      if (tagna.has(g.id)) continue;
      const l = likhet(textG(g), textN(n));
      if (l >= poang && (!bast || l > poang)) {
        bast = g;
        poang = l;
      }
    }
    if (bast) {
      parat[i] = bast;
      tagna.add(bast.id);
    }
  });

  const par: { gammal: G; ny: N; sort: number }[] = [];
  const lagg: { ny: N; sort: number }[] = [];
  nya.forEach((n, i) => {
    const g = parat[i];
    if (g) par.push({ gammal: g, ny: n, sort: i + 1 });
    else lagg.push({ ny: n, sort: i + 1 });
  });

  return { par, lagg, tabort: kvar.filter((g) => !tagna.has(g.id)).map((g) => g.id) };
}

type NyttAlternativ = { label: string; ratt: boolean };

export type GammalFraga = {
  id: string;
  sort: number;
  prompt: string;
  alternativ: { id: string; sort: number; label: string }[];
};

export type Provplan = {
  /** `gammalSort` skiljer sig fran `sort` nar fragan flyttat. */
  uppdatera: {
    id: string;
    sort: number;
    gammalSort: number;
    prompt: string;
    alternativ: {
      uppdatera: { id: string; sort: number; gammalSort: number; label: string; ratt: boolean }[];
      lagg: { sort: number; label: string; ratt: boolean }[];
      tabort: string[];
    };
  }[];
  lagg: { sort: number; prompt: string; alternativ: { sort: number; label: string; ratt: boolean }[] }[];
  tabort: string[];
};

/**
 * Planen for ett quiz. Alternativen paras inom sin fraga pa samma satt: inget
 * pekar pa `quiz_option` med en framande nyckel, men ett gammalt provforsok
 * har sitt valda alternativ i `course_attempt.answers`, och den som har provet
 * oppet skickar alternativets id nar hen svarar.
 */
export function planeraProvfragor(
  gamla: readonly GammalFraga[],
  nya: readonly { prompt: string; alternativ: readonly NyttAlternativ[] }[],
): Provplan {
  const fragor = paraIhop(gamla, nya, (g) => g.prompt, (n) => n.prompt);

  return {
    uppdatera: fragor.par.map(({ gammal, ny, sort }) => {
      const alt = paraIhop(gammal.alternativ, ny.alternativ, (g) => g.label, (n) => n.label);
      return {
        id: gammal.id,
        sort,
        gammalSort: gammal.sort,
        prompt: ny.prompt,
        alternativ: {
          uppdatera: alt.par.map((p) => ({
            id: p.gammal.id,
            sort: p.sort,
            gammalSort: p.gammal.sort,
            label: p.ny.label,
            ratt: p.ny.ratt,
          })),
          lagg: alt.lagg.map((p) => ({ sort: p.sort, label: p.ny.label, ratt: p.ny.ratt })),
          tabort: alt.tabort,
        },
      };
    }),
    lagg: fragor.lagg.map(({ ny, sort }) => ({
      sort,
      prompt: ny.prompt,
      alternativ: ny.alternativ.map((a, j) => ({ sort: j + 1, label: a.label, ratt: a.ratt })),
    })),
    tabort: fragor.tabort,
  };
}
