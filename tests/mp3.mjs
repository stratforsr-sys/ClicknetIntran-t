#!/usr/bin/env node
/**
 * Längden på ett uppladdat säljsamtal (0280): `mp3Sekunder` i src/lib/mp3.ts.
 *
 *   node --experimental-strip-types tests/mp3.mjs
 *
 * Filerna byggs här, ram för ram, så att svaret är känt i förväg: 1152 prover
 * per ram i MPEG 1 och 576 i MPEG 2. Spärren släpper ett uppladdat samtal på
 * den här siffran, så ett fel åt ena hållet släpper igenom ett samtal på en
 * minut och ett fel åt andra stoppar ett riktigt.
 */
import { mp3Sekunder } from "../src/lib/mp3.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const nara = (a, b) => a !== null && Math.abs(a - b) < 0.01;

/** `antal` ramar med huvudet `h` (fyra byte), varannan med utfyllnad om `fyll`. */
function ramar(h, langd, antal, fyll = false) {
  const delar = [];
  for (let k = 0; k < antal; k++) {
    const pad = fyll && k % 2 === 1;
    const r = new Uint8Array(langd + (pad ? 1 : 0));
    r.set(h);
    if (pad) r[2] |= 0x02;
    delar.push(r);
  }
  return delar;
}
const ihop = (...delar) => {
  const alla = delar.flat();
  const ut = new Uint8Array(alla.reduce((s, d) => s + d.length, 0));
  let i = 0;
  for (const d of alla) { ut.set(d, i); i += d.length; }
  return ut;
};
function id3(storlek) {
  const t = new Uint8Array(10 + storlek).fill(0xff, 10);
  t.set([0x49, 0x44, 0x33, 3, 0, 0, (storlek >> 21) & 0x7f, (storlek >> 14) & 0x7f, (storlek >> 7) & 0x7f, storlek & 0x7f]);
  return t;
}

// MPEG 1 lager III, 128 kbit/s, 44,1 kHz, stereo: 417 byte per ram.
const V1 = [0xff, 0xfb, 0x90, 0x00];
const RAM_V1 = 1152 / 44100;

console.log("\n\x1b[1mFast bithastighet\x1b[0m");
const fem = Math.ceil(300 / RAM_V1); // 11 485 ramar = strax över fem minuter
ok("11 485 ramar ger 300,0 s", nara(mp3Sekunder(ihop(ramar(V1, 417, fem))), fem * RAM_V1), String(mp3Sekunder(ihop(ramar(V1, 417, fem)))));
ok("en ram färre ger under fem minuter", mp3Sekunder(ihop(ramar(V1, 417, fem - 1))) < 300);
ok("utfyllnaden följs (varannan ram 418 byte)", nara(mp3Sekunder(ihop(ramar(V1, 417, 2000, true))), 2000 * RAM_V1));

console.log("\n\x1b[1mTaggar runt ljudet\x1b[0m");
const id3fil = ihop([id3(5000)], ramar(V1, 417, 1000));
ok("ID3v2 först (fylld med 0xFF) hoppas över", nara(mp3Sekunder(id3fil), 1000 * RAM_V1), String(mp3Sekunder(id3fil)));
const tag = new Uint8Array(128); tag.set([0x54, 0x41, 0x47]);
ok("ID3v1 sist räknas inte", nara(mp3Sekunder(ihop(ramar(V1, 417, 1000), [tag])), 1000 * RAM_V1));
const skrap = new Uint8Array(300).fill(0x11); skrap[40] = 0xff; skrap[41] = 0xfb; skrap[42] = 0x90;
ok("skräp mitt i hoppas över", nara(mp3Sekunder(ihop(ramar(V1, 417, 500), [skrap], ramar(V1, 417, 500))), 1000 * RAM_V1));

console.log("\n\x1b[1mXing och VBRI\x1b[0m");
const xing = new Uint8Array(417); xing.set(V1); xing.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 0x0f, 0, 0, 0x59, 0xd8], 36); // 23 000 ramar
ok("Xing: antalet ramar ur huvudet", nara(mp3Sekunder(ihop([xing], ramar(V1, 417, 3))), 23000 * RAM_V1));
const info = new Uint8Array(417); info.set(V1); info.set([0x49, 0x6e, 0x66, 0x6f, 0, 0, 0, 0x01, 0, 0, 0x2e, 0xe0], 36); // 12 000
ok("Info: samma sak", nara(mp3Sekunder(ihop([info], ramar(V1, 417, 3))), 12000 * RAM_V1));
const vbri = new Uint8Array(417); vbri.set(V1); vbri.set([0x56, 0x42, 0x52, 0x49], 36); vbri.set([0, 0, 0x27, 0x10], 50); // 10 000
ok("VBRI: antalet ramar ur huvudet", nara(mp3Sekunder(ihop([vbri], ramar(V1, 417, 3))), 10000 * RAM_V1));

console.log("\n\x1b[1mMPEG 2, mono\x1b[0m");
// 64 kbit/s, 22,05 kHz, mono: 576 prover och 208 byte per ram.
ok("1 000 ramar ger 26,1 s", nara(mp3Sekunder(ihop(ramar([0xff, 0xf3, 0x80, 0xc0], 208, 1000))), 1000 * 576 / 22050));

console.log("\n\x1b[1mInte mp3\x1b[0m");
ok("en PDF", mp3Sekunder(new TextEncoder().encode("%PDF-1.7\n" + "x".repeat(5000))) === null);
const wav = new Uint8Array(4000); wav.set(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "));
ok("en WAV", mp3Sekunder(wav) === null);
const ensam = new Uint8Array(4000).fill(0x22); ensam.set(V1, 100);
ok("ett ensamt huvud utan nästa ram", mp3Sekunder(ensam) === null);
ok("lager II (inte mp3)", mp3Sekunder(ihop(ramar([0xff, 0xfd, 0x90, 0x00], 417, 100))) === null);
ok("tom fil", mp3Sekunder(new Uint8Array(0)) === null);

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAlla prov gick igenom\x1b[0m");
process.exit(fel ? 1 : 0);
