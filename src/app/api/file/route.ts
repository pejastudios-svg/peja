import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// Simple in-memory rate limit for file proxy
const fileRateStore = new Map<string, { count: number; resetAt: number }>();

export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const now = Date.now();
    const entry = fileRateStore.get(ip);
    if (!entry || now > entry.resetAt) {
      fileRateStore.set(ip, { count: 1, resetAt: now + 60000 });
    } else {
      entry.count++;
      if (entry.count > 30) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
      }
    }
    const url = req.nextUrl.searchParams.get("url");
    const name = req.nextUrl.searchParams.get("name");

    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    if (
      parsedUrl.protocol !== "https:" ||
      !parsedUrl.hostname.endsWith(".supabase.co") ||
      !parsedUrl.pathname.startsWith("/storage/")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const response = await fetch(url);
    if (!response.ok) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const body = response.body;

    const rawName = name || "document";
    const fileName = rawName.replace(/[^\w\s.\-()]/g, "_").slice(0, 200);

    const isInline = contentType.includes("pdf") || contentType.startsWith("image/");
    const disposition = isInline
      ? `inline; filename="${fileName}"`
      : `attachment; filename="${fileName}"`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
