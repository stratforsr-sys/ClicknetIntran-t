/**
 * Säljtavlans ljud: de tio inspelningarna, normaliseringen, förstärkningens plan
 * och motorn mot en låtsad AudioContext. Kör: TZ=UTC node --experimental-strip-types tests/salesboard-ljud.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { LJUD, LJUD_LICENS, Ljudmotor, gainplan, ljudAdress, normalisering } from "../src/app/salesboard/ljud.ts";
import { maletLjud, orderLjud, serieLjud } from "../src/app/salesboard/motion/tider.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const nara = (a, b) => Math.abs(a - b) < 1e-9;

/** En låtsad kontext som minns allt som schemaläggs. */
function falskKontext({ starta = "running", resume = true } = {}) {
  const logg = { kallor: [], stangd: 0, resume: 0 };
  const param = (v = 1) => {
    const p = { value: v, steg: [], setValueAtTime: (x, t) => p.steg.push(["satt", x, t]), linearRampToValueAtTime: (x, t) => p.steg.push(["glid", x, t]), setTargetAtTime: (x, t) => p.steg.push(["mot", x, t]), cancelScheduledValues: () => {} };
    return p;
  };
  const nod = () => ({ connect: (n) => n, disconnect: () => {} });
  const ctx = {
    state: starta,
    currentTime: 10,
    destination: nod(),
    createDynamicsCompressor: () => ({ ...nod(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createGain: () => ({ ...nod(), gain: param() }),
    createBufferSource() {
      const k = { ...nod(), buffer: null, onended: null, start: (t, fran) => (k.startad = [t, fran]) };
      logg.kallor.push(k);
      return k;
    },
    decodeAudioData: async (data) => {
      if (data.byteLength === 0) throw new Error("trasig");
      const kanal = new Float32Array(400).fill(0.25);
      kanal[8] = -0.5;
      return { duration: 3, numberOfChannels: 1, getChannelData: () => kanal };
    },
    resume: async () => {
      logg.resume++;
      if (resume) ctx.state = "running";
    },
    close: async () => {
      logg.stangd++;
      ctx.state = "closed";
    },
  };
  return { ctx, logg };
}

console.log("\nFilerna");
{
  const filer = readdirSync(new URL("../public/salesboard/ljud/", import.meta.url)).filter((f) => f.endsWith(".m4a")).map((f) => f.slice(0, -4)).sort();
  ok("de tio ljuden finns som filer, och inga andra", JSON.stringify(filer) === JSON.stringify([...LJUD].sort()), filer.join(" "));
  ok("adressen ligger under /salesboard, som en parad TV når utan inloggning", ljudAdress("kassa") === "/salesboard/ljud/kassa.m4a");
  ok("licensen nämner Mixkit och Wikimedia Commons", /Mixkit Sound Effects Free License/.test(LJUD_LICENS) && /Wikimedia Commons/.test(LJUD_LICENS) && /public domain/.test(LJUD_LICENS));
  const kod = readFileSync(new URL("../src/app/salesboard/ljud.ts", import.meta.url), "utf8");
  ok("licensen står också i koden", /LICENS: ljuden kommer från Mixkit/.test(kod));
  const spar = [...orderLjud("vanlig", 18900), ...orderLjud("stor", 52800), ...orderLjud("forsta", 9800), ...serieLjud(3), ...maletLjud()];
  ok("varje ljud i spåren är en av de tio filerna", spar.every((p) => LJUD.includes(p.ljud)), spar.map((p) => p.ljud).join(","));
}

console.log("\nNormaliseringen och förstärkningen");
{
  ok("toppen tas till 0,9", nara(normalisering([Float32Array.from([0.5, 0, 0, 0, -0.25])]), 1.8));
  ok("en tyst fil får 1, aldrig oändligt", normalisering([new Float32Array(16)]) === 1);
  ok("utan kurva sätts nivån en gång", JSON.stringify(gainplan(5, 0.8)) === JSON.stringify([{ typ: "satt", t: 5, v: 0.8 }]));
  const kurva = gainplan(5, 1, { kurva: [[0, 1.4], [1.6, 3.2], [1.64, 1]] });
  ok("kurvan börjar på sin första faktor och glider sedan", kurva[0].v === 1.4 && kurva[1].typ === "glid" && nara(kurva[1].t, 6.6) && kurva[2].v === 1, JSON.stringify(kurva));
  const tona = gainplan(2, 0.5, { tona: [5, 1.6] });
  ok("tona håller nivån och glider sedan nästan till noll", tona[1].v === 0.5 && nara(tona[1].t, 7) && nara(tona[2].t, 8.6) && tona[2].v < 0.001);
}

console.log("\nMotorn");
await (async () => {
  const { ctx, logg } = falskKontext();
  const hamtade = [];
  const motor = new Ljudmotor(() => ctx, async (id) => (hamtade.push(id), new ArrayBuffer(8)));
  ok("utan kontext finns inget ljud", motor.tillstand === "saknas");
  ok("upplåsningen går", (await motor.lasUpp()) === true && motor.tillstand === "igang");
  ok("och läser in alla tio", motor.inlasta === 10 && hamtade.length === 10);
  await motor.lasUpp();
  ok("en andra upplåsning läser inte in dem igen", hamtade.length === 10);

  motor.satt({ volym: 70, tyst: false });
  motor.spela("kassa", 10.5, { styrka: 0.5 });
  const k = logg.kallor.at(-1);
  ok("ett ljud startar på sin tid, från filens början", k?.startad?.[0] === 10.5 && k.startad[1] === 0, JSON.stringify(k?.startad));
  motor.spela("trumvirvel", 11, { fran: 0.33 });
  ok("ett ljud kan börja längre in i filen", nara(logg.kallor.at(-1).startad[1], 0.33));
  motor.spela("horn", 9.95, { fran: 0.1 });
  ok("ett ljud som kommer lite sent börjar längre in, i takt med bilden", nara(logg.kallor.at(-1).startad[0], 10) && nara(logg.kallor.at(-1).startad[1], 0.15));
  const fore = logg.kallor.length;
  motor.spela("horn", 9.5);
  motor.spela("horn", 100);
  motor.spela("horn", Number.NaN);
  motor.spela("finns-inte", 11);
  ok("för sent, för långt fram, inget tal eller ett okänt ljud spelas inte", logg.kallor.length === fore);
  motor.satt({ volym: 70, tyst: true });
  motor.spela("kassa", 11);
  ok("tyst spelar ingenting", logg.kallor.length === fore);
  motor.satt({ volym: 0, tyst: false });
  motor.spela("kassa", 11);
  ok("volym 0 spelar ingenting", logg.kallor.length === fore);
  ok("kontexten stängs aldrig", logg.stangd === 0);
})();

await (async () => {
  const { ctx, logg } = falskKontext({ starta: "suspended", resume: false });
  const motor = new Ljudmotor(() => ctx, async () => new ArrayBuffer(8));
  const svar = await motor.lasUpp();
  ok("en blockerad kontext ger blockerat, och upplåsningen ber om resume", svar === false && motor.tillstand === "blockerat" && logg.resume === 1);
  ctx.state = "running";
  ok("när webbläsaren släpper fram ljudet går den", motor.tillstand === "igang");
})();

await (async () => {
  const { ctx } = falskKontext();
  let forsok = 0;
  const motor = new Ljudmotor(() => ctx, async (id) => {
    forsok++;
    return id === "arena" && forsok <= 10 ? new ArrayBuffer(0) : new ArrayBuffer(8);
  });
  const tyst = console.warn;
  console.warn = () => {};
  await motor.lasUpp();
  ok("en fil som inte går att läsa hoppas över", motor.inlasta === 9);
  await motor.lasUpp();
  console.warn = tyst;
  ok("och läses vid nästa upplåsning", motor.inlasta === 10 && forsok === 11, String(forsok));
})();

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mallt gick igenom\x1b[0m");
process.exit(fel ? 1 : 0);
