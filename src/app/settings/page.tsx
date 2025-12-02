"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  ArrowLeft,
  Bell,
  Shield,
  HelpCircle,
  FileText,
  LogOut,
  ChevronRight,
  Smartphone,
} from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [loading, setLoading] = useState(false);

  // Notification settings
  const [pushEnabled, setPushEnabled] = useState(true);
  const [dangerAlerts, setDangerAlerts] = useState(true);
  const [cautionAlerts, setCautionAlerts] = useState(true);
  const [awarenessAlerts, setAwarenessAlerts] = useState(false);
  const [infoAlerts, setInfoAlerts] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    await signOut();
    router.push("/login");
  };

  // Toggle Switch Component
  const ToggleSwitch = ({
    enabled,
    onChange,
  }: {
    enabled: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`
        relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer 
        rounded-full border-2 border-transparent 
        transition-colors duration-200 ease-in-out
        focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-900
        ${enabled ? "bg-primary-600" : "bg-dark-600"}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-5 w-5 
          transform rounded-full bg-white shadow-lg
          ring-0 transition duration-200 ease-in-out
          ${enabled ? "translate-x-5" : "translate-x-0"}
        `}
      />
    </button>
  );

  const SettingRow = ({
    icon: Icon,
    label,
    description,
    children,
    onClick,
    danger,
  }: {
    icon: any;
    label: string;
    description?: string;
    children?: React.ReactNode;
    onClick?: () => void;
    danger?: boolean;
  }) => (
    <div
      className={`flex items-center justify-between py-4 px-2 rounded-lg ${
        onClick ? "cursor-pointer hover:bg-white/5 active:bg-white/10" : ""
      } transition-colors`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${danger ? "bg-red-500/10" : "bg-dark-700"}`}>
          <Icon className={`w-5 h-5 ${danger ? "text-red-400" : "text-primary-400"}`} />
        </div>
        <div>
          <p className={`font-medium ${danger ? "text-red-400" : "text-dark-100"}`}>
            {label}
          </p>
          {description && <p className="text-sm text-dark-400">{description}</p>}
        </div>
      </div>
      {children || (onClick && <ChevronRight className="w-5 h-5 text-dark-400" />)}
    </div>
  );

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/5">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-lg font-semibold text-dark-100">Settings</h1>
          <div className="w-9" />
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto px-4">
        {/* Notifications Section */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">
            Notifications
          </h2>

          <SettingRow
            icon={Bell}
            label="Push Notifications"
            description="Receive alerts on your device"
          >
            <ToggleSwitch enabled={pushEnabled} onChange={setPushEnabled} />
          </SettingRow>

          {pushEnabled && (
            <div className="ml-4 mt-2 space-y-3 p-4 glass-sm rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-dark-100">🔴 Danger Alerts</p>
                  <p className="text-xs text-dark-400">Crime, Fire, Accidents</p>
                </div>
                <ToggleSwitch enabled={dangerAlerts} onChange={setDangerAlerts} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-dark-100">🟠 Caution Alerts</p>
                  <p className="text-xs text-dark-400">Traffic, Outages, Flooding</p>
                </div>
                <ToggleSwitch enabled={cautionAlerts} onChange={setCautionAlerts} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-dark-100">🟡 Awareness Alerts</p>
                  <p className="text-xs text-dark-400">Protests, Events</p>
                </div>
                <ToggleSwitch enabled={awarenessAlerts} onChange={setAwarenessAlerts} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-dark-100">🔵 Info Alerts</p>
                  <p className="text-xs text-dark-400">General information</p>
                </div>
                <ToggleSwitch enabled={infoAlerts} onChange={setInfoAlerts} />
              </div>
            </div>
          )}
        </section>

        {/* General Section */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">General</h2>

          <SettingRow
            icon={Smartphone}
            label="App Version"
            description="1.0.0"
          />
        </section>

        {/* Support Section */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Support</h2>

          <SettingRow
            icon={Shield}
            label="Privacy Policy"
            onClick={() => router.push("/privacy")}
          />
          <SettingRow
            icon={HelpCircle}
            label="Help & Support"
            onClick={() => router.push("/help")}
          />
          <SettingRow
            icon={FileText}
            label="Terms of Service"
            onClick={() => router.push("/terms")}
          />
        </section>

        {/* Account Section */}
        <section className="py-6">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Account</h2>

          <SettingRow icon={LogOut} label="Log Out" onClick={handleLogout} danger />
        </section>

        {/* App Info */}
        <p className="text-center text-sm text-dark-500 py-4">
          Peja v1.0.0 • Made with ❤️ in Nigeria
        </p>
      </main>
    </div>
  );
}