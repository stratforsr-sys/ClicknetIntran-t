#!/usr/bin/env node
/**
 * Bara en `npm test` i taget på datorn. Flera sessioner arbetar i var sin klon mot SAMMA produktionsdatabas, och
 * rls- och rekryteringsproven skapar och städar riktiga provkonton: två körningar samtidigt raderar varandras konton
 * mitt i, och båda faller utan att något är fel i koden (2026-11-14).
 *
 *   node scripts/provlas.mjs <kommando ...>     kör kommandot när låset är ledigt, och släpper det efteråt
 *
 * Låset är en katalog i hemkatalogen, gemensamt för alla kloner: `~/.nav-provlas`, eller `NAV_PROVLAS`. Den byggs
 * färdig bredvid (med `agare.json`: pid, klon, start) och byts in med `rename`, som är atomärt och nekar när låset
 * finns: ett lås har därför alltid en ägare. Lever inte ägarprocessen längre flyttas låset undan med `rename` (bara en
 * väntare lyckas) och kontrolleras att det var den döda ägarens; annars läggs det tillbaka.
 * Väntan är högst `NAV_PROVLAS_MAX_MIN` minuter (45); sedan avbryts körningen hellre än att den krockar.
 * `NAV_PROVLAS=av` kör utan lås.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const kommando = process.argv.slice(2);
if (!kommando.length) {
  console.error("provlas: ange kommandot som ska köras");
  process.exit(2);
}

const kor = () =>
  new Promise((klar) => {
    const barn = spawn(kommando[0], kommando.slice(1), { stdio: "inherit", shell: false });
    const vidare = (sig) => barn.kill(sig);
    process.on("SIGINT", vidare);
    process.on("SIGTERM", vidare);
    barn.on("exit", (kod, sig) => klar(kod ?? (sig ? 1 : 0)));
  });

if (process.env.NAV_PROVLAS === "av") process.exit(await kor());

const LAS = process.env.NAV_PROVLAS || join(homedir(), ".nav-provlas");
const AGARE = join(LAS, "agare.json");
const MAX_MS = Number(process.env.NAV_PROVLAS_MAX_MIN || 45) * 60_000;

const lever = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
const agare = () => {
  try {
    return JSON.parse(readFileSync(AGARE, "utf8"));
  } catch {
    return null;
  }
};
const taLas = () => {
  const ny = `${LAS}.ny-${process.pid}-${randomUUID()}`;
  mkdirSync(ny);
  writeFileSync(join(ny, "agare.json"), JSON.stringify({ pid: process.pid, klon: process.cwd(), start: new Date().toISOString() }));
  try {
    renameSync(ny, LAS);
    return true;
  } catch (e) {
    rmSync(ny, { recursive: true, force: true });
    if (e.code === "ENOTEMPTY" || e.code === "EEXIST") return false;
    throw e;
  }
};
/** Flytta undan den döda ägarens lås. Bara en väntare lyckas; tog den fel lås (någon annan hann ta det) läggs det tillbaka. */
const taOver = (dod) => {
  const undan = `${LAS}.dod-${process.pid}-${randomUUID()}`;
  try {
    renameSync(LAS, undan);
  } catch {
    return;
  }
  let flyttad = null;
  try {
    flyttad = JSON.parse(readFileSync(join(undan, "agare.json"), "utf8"));
  } catch {
    // utan ägare: övergivet
  }
  if (flyttad && flyttad.pid !== dod.pid && lever(flyttad.pid)) {
    try {
      renameSync(undan, LAS);
      return;
    } catch {
      // Någon annan tog låset under tiden. Den levande ägarens katalog lämnas där den ligger (raderas aldrig).
      return;
    }
  }
  console.error(`provlas: tog över ett övergivet lås (pid ${dod.pid}, ${dod.klon})`);
  rmSync(undan, { recursive: true, force: true });
};

const borjan = Date.now();
let sagt = "";
while (!taLas()) {
  const a = agare();
  if (a && !lever(a.pid)) {
    taOver(a);
    continue;
  }
  const rad = a ? `provlas: väntar på npm test i ${a.klon} (pid ${a.pid}, sedan ${a.start})` : "provlas: väntar på låset";
  if (rad !== sagt) console.error((sagt = rad));
  if (Date.now() - borjan > MAX_MS) {
    console.error(`provlas: gav upp efter ${MAX_MS / 60_000} minuter. Kör igen när den andra körningen är klar.`);
    process.exit(75);
  }
  await new Promise((r) => setTimeout(r, 5_000));
}

const slapp = () => {
  const a = agare();
  if (a && a.pid === process.pid) rmSync(LAS, { recursive: true, force: true });
};
process.on("exit", slapp);
let kod = 1;
try {
  kod = await kor();
} finally {
  slapp();
}
process.exit(kod);
