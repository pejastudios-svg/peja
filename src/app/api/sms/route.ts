import { NextRequest, NextResponse } from "next/server";

const TERMII_API_KEY = process.env.TERMII_API_KEY;

export async function POST(request: NextRequest) {
  try {
    const { phone, message, recipientName } = await request.json();

    if (!phone || !message) {
      return NextResponse.json(
        { success: false, error: "Phone and message required" },
        { status: 400 }
      );
    }

    if (!TERMII_API_KEY) {
      console.error("TERMII_API_KEY not set");
      return NextResponse.json(
        { success: false, error: "SMS not configured" },
        { status: 500 }
      );
    }

    // Format phone: remove spaces, convert 0 to 234
    let formattedPhone = phone.replace(/\s+/g, "").replace(/^0/, "234");
    if (!formattedPhone.startsWith("234") && !formattedPhone.startsWith("+")) {
      formattedPhone = "234" + formattedPhone;
    }
    formattedPhone = formattedPhone.replace("+", "");

    console.log(`Sending SMS to ${formattedPhone}`);

    // Use "generic" channel with "Termii" sender - THIS WORKS WITHOUT REGISTRATION
    const response = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: formattedPhone,
        from: "Termii",  // Use Termii's default sender
        sms: message,
        type: "plain",
        channel: "generic",  // Generic channel works without custom sender ID
        api_key: TERMII_API_KEY,
      }),
    });

    const result = await response.json();
    console.log("Termii response:", result);

    if (result.code === "ok") {
      return NextResponse.json({
        success: true,
        message_id: result.message_id,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.message || "SMS failed",
      });
    }
  } catch (error: any) {
    console.error("SMS error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}