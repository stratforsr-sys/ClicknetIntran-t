/**
 * Säljtavlans ljud: tio inspelningar genom Web Audio, schemalagda mot ljudklockan.
 *
 * ===========================================================================
 * ETT AudioContext PER SIDA, OCH DET STÄNGS ALDRIG.
 *
 * Webbläsaren släpper bara fram ljud efter en gest, och en kontext som stängs
 * kan inte öppnas igen. Motorn bygger därför sin kontext en gång, låser upp den
 * med `resume()` i klicket, och lever sedan lika länge som sidan. Stänger
 * webbläsaren den själv (Safari kan) byggs en ny vid nästa upplåsning, och
 * ljuden som redan lästs in följer med: en AudioBuffer hör inte till en kontext.
 * ===========================================================================
 *
 * Kedjan: källa → källans förstärkning (normalisering × styrka × kurva) →
 * huvudvolymen → kompressorn → högtalaren. Varje fil normaliseras efter sin
 * topp, så att styrkan i kompositionernas ljudspår betyder samma sak för alla
 * tio, och kompressorn tar de toppar som ändå hamnar på varandra (en smäll,
 * trumpeter och publik på samma bildruta).
 *
 * Ljudspåret ligger i kompositionen (motion/tider.ts): bildruta, ljud, styrka,
 * start i filen och en volymkurva. Här finns bara uppspelningen.
 *
 * LICENS: ljuden kommer från Mixkit (Mixkit Sound Effects Free License,
 * https://mixkit.co/license/#sfxFree), utom kassaapparaten, som är en inspelning
 * från Wikimedia Commons i public domain. Licensen står också på
 * inställningssidan (`LJUD_LICENS`).
 */

/** De tio ljuden, i den ordning de läses in. Filerna ligger i public/salesboard/ljud. */
export const LJUD = ["kassa", "svisch", "horn", "trumvirvel", "small", "trumpeter", "publik", "pengar", "fanfar", "arena"] as const;

export type LjudId = (typeof LJUD)[number];

/** Licensen, som den står på inställningssidan. */
export const LJUD_LICENS =
  "Ljuden kommer från Mixkit (Mixkit Sound Effects Free License), utom kassaapparaten, som är en inspelning från Wikimedia Commons i public domain.";

/** Adressen till ett ljud. Under /salesboard, så att en parad TV utan inloggning når det. */
export const ljudAdress = (id: LjudId): string => `/salesboard/ljud/${id}.m4a`;

/**
 * Hur ett ljud spelas.
 *
 * - `styrka`: 0–1 efter normaliseringen. Standard 1.
 * - `fran`: start i filen, sekunder. Trumvirveln börjar 0,33 s in, så att dess
 *   cymbal (2,00 s in i filen) slår exakt på den stora affärens bildruta D.
 * - `kurva`: [[sekunder från start, faktor], …], linjärt mellan punkterna, till
 *   exempel en trumvirvel som stiger mot cymbalen. Faktorn gånger styrkan.
 * - `tona`: [efter sekunder, under sekunder]: tonas bort, så att ett långt ljud
 *   (publiken, arenan) inte hänger kvar efter bilden.
 */
export type Ljudparametrar = {
  styrka?: number;
  fran?: number;
  kurva?: readonly (readonly [number, number])[];
  tona?: readonly [number, number];
};

export type Ljudtillstand = "igang" | "blockerat" | "saknas";

/** Kompressorn: tar topparna när flera ljud möts, som i prototypen. */
const KOMPRESSOR = { troskel: -10, kna: 6, ratio: 3, attack: 0.003, release: 0.25 };
/** Huvudvolymen ovanpå volymreglaget: lite luft under kompressorn. */
const HUVUD = 0.9;
/** Normaliseringen siktar på den här toppen. */
const TOPP = 0.9;
/** Volymändringar glider på 15 ms, så att de aldrig knäpper. */
const RAMP_TAU = 0.015;
/** Så länge väntar upplåsningen på resume() innan den svarar. */
const UPPLASNING_MS = 1500;
/** Så länge väntar upplåsningen på att filerna lästs in. Tavlan spelar ändå när de kommer. */
const LADDNING_MS = 4000;
/** Ett ljud som skulle börjat så här länge sedan spelas ändå, från rätt ställe i filen. */
const SENAST_S = 0.1;
/** Längre fram än så schemaläggs inget: det är ett fel, inte en plan. */
const LANGST_FRAM_S = 60;

const klamp = (x: number, lag: number, hog: number): number => Math.min(hog, Math.max(lag, x));
const andligt = (x: unknown, annars: number): number => (typeof x === "number" && Number.isFinite(x) ? x : annars);

/**
 * Normaliseringen för en fil: faktorn som tar dess topp till 0,9. Var fjärde
 * sampel räcker för att hitta toppen. En tyst fil får 1, aldrig oändligt.
 */
export function normalisering(kanaler: readonly Float32Array[]): number {
  let topp = 0;
  for (const d of kanaler) for (let i = 0; i < d.length; i += 4) topp = Math.max(topp, Math.abs(d[i]));
  return topp > 0 ? TOPP / topp : 1;
}

/** En händelse på källans förstärkning: sätt eller glid linjärt till `v` vid tiden `t`. */
export type Gainsteg = { typ: "satt" | "glid"; t: number; v: number };

/**
 * Förstärkningen för ett ljud som börjar vid `t` med grundnivån `n`
 * (normalisering × styrka), som en lista. Ren, så att provet läser den.
 */
export function gainplan(t: number, n: number, p: Ljudparametrar = {}): Gainsteg[] {
  const kurva = p.kurva && p.kurva.length > 0 ? p.kurva : null;
  const steg: Gainsteg[] = [{ typ: "satt", t, v: n * (kurva ? andligt(kurva[0][1], 1) : 1) }];
  if (kurva) for (const [tid, x] of kurva.slice(1)) steg.push({ typ: "glid", t: t + andligt(tid, 0), v: n * andligt(x, 1) });
  if (p.tona) {
    const [efter, under] = p.tona;
    steg.push({ typ: "satt", t: t + efter, v: n }, { typ: "glid", t: t + efter + Math.max(0.01, under), v: 0.0001 });
  }
  return steg;
}

function standardKontext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Kontext = w.AudioContext ?? w.webkitAudioContext;
  return Kontext ? new Kontext() : null;
}

async function standardHamtning(id: LjudId): Promise<ArrayBuffer> {
  const svar = await fetch(ljudAdress(id), { cache: "force-cache" });
  if (!svar.ok) throw new Error(`${id}: ${svar.status}`);
  return svar.arrayBuffer();
}

/** Ett inläst ljud och dess normalisering. */
type Inlast = { buffer: AudioBuffer; norm: number };

export class Ljudmotor {
  private readonly skapa: () => AudioContext | null;
  private readonly hamta: (id: LjudId) => Promise<ArrayBuffer>;
  private ctx: AudioContext | null = null;
  private huvud: GainNode | null = null;
  private readonly ljud = new Map<LjudId, Inlast>();
  private laddning: Promise<void> | null = null;
  private volym = 70;
  private tyst = false;
  private huvudmal = Number.NaN;

  constructor(skapa?: () => AudioContext | null, hamta?: (id: LjudId) => Promise<ArrayBuffer>) {
    this.skapa = skapa ?? standardKontext;
    this.hamta = hamta ?? standardHamtning;
  }

  get tillstand(): Ljudtillstand {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed") return "saknas";
    return ctx.state === "running" ? "igang" : "blockerat";
  }

  /** Hur många av de tio som lästs in. */
  get inlasta(): number {
    return this.ljud.size;
  }

  /**
   * Låser upp ljudet: bygger kontexten första gången, ber om resume() och läser
   * in filerna. Anropas i ett klick (Safari släpper bara fram ljud i själva
   * gesten), eller utan klick på en parad skärm, där kioskläget tillåter det.
   * Svarar när kontexten går eller efter 1,5 s, och väntar högst 4 s på filerna.
   */
  async lasUpp(): Promise<boolean> {
    let vakt: ReturnType<typeof setTimeout> | undefined;
    try {
      if (this.ctx?.state === "closed") this.slapp();
      if (!this.ctx) this.bygg();
      const ctx = this.ctx;
      if (!ctx) return false;
      const laddning = this.lasIn(ctx);
      if (ctx.state !== "running") {
        // Synkront, inom klicket.
        const svar = Promise.resolve(ctx.resume()).catch(() => undefined);
        await Promise.race([svar, new Promise((klar) => (vakt = setTimeout(klar, UPPLASNING_MS)))]);
      }
      if (this.tillstand === "igang") await Promise.race([laddning, new Promise((klar) => setTimeout(klar, LADDNING_MS))]);
      return this.tillstand === "igang";
    } catch {
      return this.tillstand === "igang";
    } finally {
      if (vakt !== undefined) clearTimeout(vakt);
    }
  }

  /** Volymen 0–100 och tystnaden (ljudtiden, skärmens val). Gäller direkt, med en kort glidning. */
  satt(o: { volym: number; tyst: boolean }): void {
    if (Number.isFinite(o.volym)) this.volym = klamp(o.volym, 0, 100);
    this.tyst = o.tyst === true;
    const ctx = this.ctx;
    const huvud = this.huvud;
    const mal = this.huvudvarde();
    if (!ctx || !huvud || mal === this.huvudmal) return;
    try {
      const t = ctx.currentTime;
      huvud.gain.cancelScheduledValues(t);
      huvud.gain.setTargetAtTime(mal, t, RAMP_TAU);
      this.huvudmal = mal;
    } catch {
      // hellre fel volym en stund än en tavla som faller
    }
  }

  /** Ljudklockan när den går, annars väggklockan, i sekunder. */
  nu(): number {
    const ctx = this.ctx;
    return ctx && ctx.state === "running" ? ctx.currentTime : performance.now() / 1000;
  }

  /**
   * Spelar ljudet `id` vid ljudklockans tid `vid`. Tyst, avstängt, inte inläst,
   * för sent eller för långt fram: ingenting, och aldrig ett fel. Kommer det upp
   * till 0,1 s sent börjar det längre in i filen, så att det håller takten med bilden.
   */
  spela(id: LjudId, vid: number, p: Ljudparametrar = {}): void {
    const ctx = this.ctx;
    const huvud = this.huvud;
    const ljud = this.ljud.get(id);
    if (!ctx || !huvud || !ljud || ctx.state !== "running") return;
    if (this.tyst || this.volym <= 0) return;
    const nu = ctx.currentTime;
    if (!Number.isFinite(vid) || vid < nu - SENAST_S || vid > nu + LANGST_FRAM_S) return;
    const t = Math.max(vid, nu);
    const fran = Math.max(0, andligt(p.fran, 0)) + (t - vid);
    if (fran >= ljud.buffer.duration) return;
    let kalla: AudioBufferSourceNode | null = null;
    let gain: GainNode | null = null;
    try {
      kalla = ctx.createBufferSource();
      kalla.buffer = ljud.buffer;
      gain = ctx.createGain();
      for (const s of gainplan(t, ljud.norm * klamp(andligt(p.styrka, 1), 0, 1.5), p)) {
        if (s.typ === "satt") gain.gain.setValueAtTime(s.v, s.t);
        else gain.gain.linearRampToValueAtTime(s.v, s.t);
      }
      kalla.connect(gain).connect(huvud);
      const k = kalla;
      const g = gain;
      kalla.onended = () => {
        try {
          k.disconnect();
          g.disconnect();
        } catch {
          // redan urkopplad
        }
      };
      kalla.start(t, fran);
    } catch {
      // Ett ljud får aldrig fälla tavlan.
      try {
        kalla?.disconnect();
        gain?.disconnect();
      } catch {
        // redan urkopplad
      }
    }
  }

  private huvudvarde(): number {
    return this.tyst ? 0 : HUVUD * (this.volym / 100) ** 2;
  }

  /**
   * Läser in de filer som inte redan finns. En inläsning i taget; en fil som inte
   * går att läsa hoppas över, och nästa upplåsning försöker med den igen.
   */
  private lasIn(ctx: AudioContext): Promise<void> {
    if (this.laddning) return this.laddning;
    const laddning = Promise.all(
      LJUD.filter((id) => !this.ljud.has(id)).map(async (id) => {
        try {
          const data = await this.hamta(id);
          const buffer = await ctx.decodeAudioData(data);
          const kanaler = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
          this.ljud.set(id, { buffer, norm: normalisering(kanaler) });
        } catch (e) {
          console.warn("Säljtavlan: ljudet gick inte att läsa:", id, e instanceof Error ? e.message : e);
        }
      }),
    ).then(() => {
      if (this.ljud.size < LJUD.length && this.laddning === laddning) this.laddning = null;
    });
    this.laddning = laddning;
    return laddning;
  }

  private bygg(): void {
    const ctx = this.skapa();
    if (!ctx) return;
    const komp = ctx.createDynamicsCompressor();
    komp.threshold.value = KOMPRESSOR.troskel;
    komp.knee.value = KOMPRESSOR.kna;
    komp.ratio.value = KOMPRESSOR.ratio;
    komp.attack.value = KOMPRESSOR.attack;
    komp.release.value = KOMPRESSOR.release;
    komp.connect(ctx.destination);
    const huvud = ctx.createGain();
    // Talet sparas, inte det som läses tillbaka: AudioParam avrundar till float32.
    this.huvudmal = this.huvudvarde();
    huvud.gain.value = this.huvudmal;
    huvud.connect(komp);
    this.ctx = ctx;
    this.huvud = huvud;
  }

  /** En kontext som webbläsaren stängt släpps, men ljuden står kvar till nästa. */
  private slapp(): void {
    this.ctx = null;
    this.huvud = null;
    this.laddning = null;
  }
}
