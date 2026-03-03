import crypto from "crypto";
import readline from "readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("Enter your new admin PIN: ", (pin) => {
  if (!pin || pin.length < 4) {
    console.log("PIN must be at least 4 characters");
    rl.close();
    return;
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pin, salt, 64).toString("hex");
  const pinHash = salt + ":" + hash;
  const sessionSecret = crypto.randomBytes(32).toString("hex");

  console.log("\n========================================");
  console.log("  Add these to .env.local AND Vercel:");
  console.log("========================================\n");
  console.log("ADMIN_PIN_HASH=" + pinHash);
  console.log("ADMIN_SESSION_SECRET=" + sessionSecret);
  console.log("ADMIN_ALERT_EMAIL=your-email@example.com");
  console.log("\nDELETE the old NEXT_PUBLIC_ADMIN_PIN from everywhere!\n");

  rl.close();
});
