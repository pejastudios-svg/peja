import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.peja.app",
  appName: "Peja",
  webDir: "out",
  server: {
    url: "https://peja.vercel.app",
    cleartext: false,
  },
  android: {
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
    appendUserAgent: "CapacitorApp",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: "#0c0818",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0c0818",
    },
    CapacitorCookies: {
      enabled: true,
    },
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;