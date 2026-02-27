import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  try {
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
