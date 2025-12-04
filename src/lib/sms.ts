// lib/sms.ts

const TERMII_API_KEY = process.env.NEXT_PUBLIC_TERMII_API_KEY || '';
const TERMII_SENDER_ID = 'Peja'; // Your registered sender ID

interface SMSResponse {
  success: boolean;
  message_id?: string;
  error?: string;
}

export async function sendSMS(
  phoneNumber: string,
  message: string
): Promise<SMSResponse> {
  try {
    // Format phone number (remove spaces, add country code if needed)
    let formattedPhone = phoneNumber.replace(/\s+/g, '').replace(/^0/, '234');
    if (!formattedPhone.startsWith('234')) {
      formattedPhone = '234' + formattedPhone;
    }

    const response = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: formattedPhone,
        from: TERMII_SENDER_ID,
        sms: message,
        type: 'plain',
        channel: 'generic',
        api_key: TERMII_API_KEY,
      }),
    });

    const data = await response.json();

    if (data.code === 'ok') {
      return { success: true, message_id: data.message_id };
    } else {
      return { success: false, error: data.message || 'Failed to send SMS' };
    }
  } catch (error) {
    console.error('SMS send error:', error);
    return { success: false, error: 'Network error' };
  }
}

export function generateSOSMessage(
  userName: string,
  address: string,
  latitude: number,
  longitude: number
): string {
  const mapLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
  
  return `🚨 PEJA SOS ALERT 🚨

${userName} needs immediate help!

📍 Location: ${address || 'Unknown location'}
🗺️ Map: ${mapLink}

Please respond immediately or contact emergency services.

⚠️ IMPORTANT: Peja will NEVER ask for money or payment. If anyone contacts you requesting payment, it is a scam.

- Peja Safety Team`;
}