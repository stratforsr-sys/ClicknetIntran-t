import { NextResponse } from "next/server";

/**
 * Ett JSON-svar från en rutt under /salesboard.
 *
 * Aldrig cachat, varken av webbläsaren eller av något på vägen: svaren bär en
 * skärms åtkomst, en parningskod eller en ögonblicksbild som gäller just nu.
 * Rubriken står här en gång, så att ingen rutt kan glömma den.
 */
export function svar(kropp: unknown, status = 200): NextResponse {
  return NextResponse.json(kropp, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
