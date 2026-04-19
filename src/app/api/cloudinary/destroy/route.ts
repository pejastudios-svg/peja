import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireUser } from "../../_auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);

    const { publicId, resourceType } = await req.json();
    if (!publicId || typeof publicId !== "string") {
      return NextResponse.json({ ok: false, error: "Missing publicId" }, { status: 400 });
    }

    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return NextResponse.json({ ok: false, error: "Cloudinary not configured" }, { status: 500 });
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto
      .createHash("sha1")
      .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
      .digest("hex");

    const form = new FormData();
    form.append("public_id", publicId);
    form.append("timestamp", timestamp);
    form.append("api_key", apiKey);
    form.append("signature", signature);

    const type = resourceType === "image" ? "image" : "video";
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${type}/destroy`,
      { method: "POST", body: form }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ ok: false, error: text }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
