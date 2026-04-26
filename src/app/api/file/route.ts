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

    // Pin the proxy to THIS project's Supabase host and only the public
    // storage prefix. Without this, anyone could use the edge proxy to fetch
    // any file from any Supabase project (free CDN / scraping vehicle), or
    // poke at non-public storage paths.
    const allowedHost = (() => {
      try {
        const env = process.env.NEXT_PUBLIC_SUPABASE_URL;
        return env ? new URL(env).hostname : null;
      } catch {
        return null;
      }
    })();

    // Allow proxying public files and short-lived signed URLs (used by DM
    // attachments). Both flow through Supabase storage's standard paths.
    const isPublic = parsedUrl.pathname.startsWith("/storage/v1/object/public/");
    const isSigned = parsedUrl.pathname.startsWith("/storage/v1/object/sign/");

    if (
      parsedUrl.protocol !== "https:" ||
      !allowedHost ||
      parsedUrl.hostname !== allowedHost ||
      (!isPublic && !isSigned)
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
