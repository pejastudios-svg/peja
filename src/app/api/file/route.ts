import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get("url");
    const name = req.nextUrl.searchParams.get("name");

    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    // Only allow proxying from our Supabase storage
    const allowedOrigins = [
      "supabase.co/storage",
      "supabase.in/storage",
    ];
    if (!allowedOrigins.some((o) => url.includes(o))) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 403 });
    }

    const response = await fetch(url);
    if (!response.ok) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const body = response.body;

    const fileName = name || "document";

    // For PDFs and images, display inline (in browser viewer)
    // For everything else, force download
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
    console.error("File proxy error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}