#!/usr/bin/env node
/**
 * Appens huvud: Apples apptaggar, fältzoomen på iPhone och versionen (uppgift 7).
 *
 *   TZ=UTC node --experimental-strip-types tests/app-huvud.mjs
 *
 * /nav2 skickar sitt eget <head>, och inloggningssidorna ritas av Next med
 * rotlayouten. Båda ska ge samma app: Navs ikon, titeln Nav, appläge och ljus
 * statusrad. Utseendet är orört: ingen viewport-fit, ingen theme-color.
 */
import { readFileSync } from "node:fs";
import { appHuvud, skal, APP_METADATA } from "../src/lib/nav2/app.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const las = (sokvag, kod) => readFileSync(new URL("../" + sokvag, import.meta.url), kod);
const lika = (a, b) => Buffer.compare(a, b) === 0;

const ios = appHuvud("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", null);
const and = appHuvud("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", null);

console.log("\nHuvudet i /nav2");
ok("apple-touch-icon", ios.includes('<link rel="apple-touch-icon" href="/nav2/ikon/apple-touch-180.png">'));
ok("apptitel Nav", ios.includes('<meta name="apple-mobile-web-app-title" content="Nav">'));
ok("standalone på iPhone", ios.includes('<meta name="apple-mobile-web-app-capable" content="yes">'));
ok("statusraden default (utseendet orört)", ios.includes('content="default"'));
ok("iPhone: maximum-scale=1 (ingen fältzoom; nypzoom finns kvar på iOS)", /name="viewport"[^>]*maximum-scale=1/.test(ios));
ok("Android: ingen maximum-scale (där skulle den stänga av nypzoomen)", !/maximum-scale/.test(and));
ok("ingen viewport-fit=cover", !/viewport-fit/.test(ios + and));
ok("ingen theme-color", !/theme-color/.test(ios + and));
ok("skal() börjar med doctype och lang=sv", skal("", null).startsWith('<!doctype html><html lang="sv"><head><meta charset="utf-8">'));
ok("versionen står i huvudet", appHuvud("", "abc123").includes('<meta name="nav-version" content="abc123">'));
ok("ingen version: ingen versionstagg", !appHuvud("", null).includes("nav-version"));
ok("versionen escapas", !appHuvud("", '"><x').includes('"><x'));

console.log("\nInloggningssidorna");
ok("inloggningssidorna länkar manifestet", APP_METADATA.manifest === "/nav2/manifest.webmanifest");
ok("inloggningssidorna är appläge med titeln Nav och ljus statusrad", APP_METADATA.appleWebApp.capable === true && APP_METADATA.appleWebApp.title === "Nav" && APP_METADATA.appleWebApp.statusBarStyle === "default");
ok("Nexts apple-icon är Navs ikon", lika(las("src/app/apple-icon.png"), las("public/nav2/ikon/apple-touch-180.png")));
ok("layouten använder APP_METADATA", /\.\.\.APP_METADATA/.test(las("src/app/layout.tsx", "utf8")));
ok("rutten använder skal(ua, version)", /skal\(ua, version\)/.test(las("src/app/nav2/route.ts", "utf8")) && !/\bSKAL\b/.test(las("src/app/nav2/route.ts", "utf8")));

console.log(fel ? `\n\x1b[31m${fel} prov foll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
