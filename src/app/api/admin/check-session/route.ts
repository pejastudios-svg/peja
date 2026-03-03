// src/app/api/admin/check-session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, ADMIN_COOKIE_NAME } from "@/lib/adminSession";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(ADMIN_COOKIE_NAME);
  const valid = !!cookie?.value && verifySessionToken(cookie.value);
  return NextResponse.json({ valid });
}