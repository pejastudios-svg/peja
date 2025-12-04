// src/app/api/sms/route.ts
import { NextRequest, NextResponse } from "next/server";

const TERMII_API_KEY = process.env.TERMII_API_KEY; // Note: NOT NEXT_PUBLIC_
const TERMII_SENDER_ID = "Peja";

interface SMSRequest {
  phone: string;
  message: string;
  recipientName?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: SMSRequest = await request.json();
    const { phone, message, recipientName } = body;

    if (!phone || !message) {
      return NextResponse.json(
        { success: false, error: "Phone and message are required" },
        { status: 400 }
      );
    }

    if (!TERMII_API_KEY) {
      console.error("TERMII_API_KEY is not set");
      return NextResponse.json(
        { success: false, error: "SMS service not configured" },
        { status: 500 }
      );
    }

    // Format phone number
    let formattedPhone = phone.replace(/\s+/g, "").replace(/^0/, "234");
    if (!formattedPhone.startsWith("234") && !formattedPhone.startsWith("+")) {
      formattedPhone = "234" + formattedPhone;
    }
    formattedPhone = formattedPhone.replace("+", "");

    console.log(`Sending SMS to ${formattedPhone} (${recipientName || "Unknown"})`);

    // Try DND channel first (reaches all numbers including DND)
    const response = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: formattedPhone,
        from: "N-Alert", // Use N-Alert for DND bypass
        sms: message,
        type: "plain",
        channel: "dnd", // DND channel for better delivery
        api_key: TERMII_API_KEY,
      }),
    });

    const result = await response.json();
    console.log("Termii response:", result);

    if (result.code === "ok") {
      return NextResponse.json({
        success: true,
        message_id: result.message_id,
        balance: result.balance,
      });
    } else {
      // Log the error for debugging
      console.error("Termii error:", result);
      return NextResponse.json({
        success: false,
        error: result.message || "Failed to send SMS",
        details: result,
      });
    }
  } catch (error: any) {
    console.error("SMS API error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}