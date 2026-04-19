// src/app/settings/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { isOffline, loadFromCache, saveToCache, enqueueAction, getQueue, clearQueue } from "@/lib/offlineStorage";
import { NIGERIAN_STATES } from "@/lib/types";
import { apiUrl } from "@/lib/api";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import { PasswordStrength, isPasswordStrong } from "@/components/ui/PasswordStrength";
import { resetTutorial } from "@/components/tutorial/TutorialOverlay";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";
import {
  ArrowLeft,
  Bell,
  Shield,
  HelpCircle,
  FileText,
  LogOut,
  ChevronRight,
  Check,
  X,
  CheckCircle,
  Users,
  MapPin,
  AlertTriangle,
  Lock,
  Eye,
  EyeOff,
  KeyRound,
  Copy,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

export default function SettingsPage() {
  useScrollRestore("settings");
  const router = useRouter();
  const { user, session, signOut, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [settingsId, setSettingsId] = useState<string | null>(null);

  // Notification settings
  const [pushEnabled, setPushEnabled] = useState(true);
  const [dangerAlerts, setDangerAlerts] = useState(true);
  const [cautionAlerts, setCautionAlerts] = useState(true);
  const [awarenessAlerts, setAwarenessAlerts] = useState(false);
  const [infoAlerts, setInfoAlerts] = useState(false);

  // Alert zone settings
  const [alertZoneType, setAlertZoneType] = useState<string>("all_nigeria");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [alertRadius, setAlertRadius] = useState(5);


  // Social notifications
  const [socialSilenced, setSocialSilenced] = useState(false);

  // Modals
  const [showStatesModal, setShowStatesModal] = useState(false);

  // Delete account
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // ─── Change Password State ───
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [pwStep, setPwStep] = useState<1 | 2>(1);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwCode, setPwCode] = useState("");
  const [pwCodeDisplay, setPwCodeDisplay] = useState<string | null>(null);
  const [pwCopied, setPwCopied] = useState(false);
  const [showPwOld, setShowPwOld] = useState(false);
  const [showPwNew, setShowPwNew] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  useScrollFreeze(showChangePassword || showStatesModal);

  // Drain queued settings when connectivity is restored
  useEffect(() => {
    const drainQueue = async () => {
      if (!user) return;
      const queue = getQueue("settings");
      if (!queue.length) return;
      const latest = queue[queue.length - 1];
      const { _settingsId, _queuedAt, ...data } = latest;
      try {
        let result;
        if (_settingsId) {
          result = await supabase.from("user_settings").update(data).eq("id", _settingsId).select().single();
        } else {
          result = await supabase.from("user_settings").insert(data).select().single();
        }
        if (!result.error) {
          setSettingsId(result.data.id);
          clearQueue("settings");
        }
      } catch {}
    };
    window.addEventListener("online", drainQueue);
    return () => window.removeEventListener("online", drainQueue);
  }, [user]);
  
  useEffect(() => {
    if (authLoading) return;
    if (user) {
      loadSettings();
    } else {
      const timer = setTimeout(() => {
        router.replace("/login");
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [user, authLoading, router]);

  const applySettings = (settings: any) => {
    setSettingsId(settings.id ?? null);
    setPushEnabled(settings.push_enabled ?? true);
    setDangerAlerts(settings.danger_alerts ?? true);
    setCautionAlerts(settings.caution_alerts ?? true);
    setAwarenessAlerts(settings.awareness_alerts ?? false);
    setInfoAlerts(settings.info_alerts ?? false);
    setAlertZoneType(settings.alert_zone_type ?? "all_nigeria");
    setSelectedStates(settings.selected_states ?? []);
    setAlertRadius(settings.alert_radius_km ?? 5);
    setSocialSilenced(settings.social_notifications_silenced ?? false);
  };

  const loadSettings = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    // Paint from cache instantly so the UI reflects the last known state
    // without waiting for the (potentially slow) DB round-trip.
    const cached = loadFromCache<any>(`settings-${user.id}`);
    if (cached) {
      applySettings(cached);
      setLoading(false);
    }

    try {
      const { data: settings } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (settings) {
        applySettings(settings);
        saveToCache(`settings-${user.id}`, settings);
      }
    } catch {
      // keep cached values on error
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!user) return;

    setSaving(true);
    setSaveSuccess(false);

    const settingsData = {
      user_id: user.id,
      push_enabled: pushEnabled,
      danger_alerts: dangerAlerts,
      caution_alerts: cautionAlerts,
      awareness_alerts: awarenessAlerts,
      info_alerts: infoAlerts,
      alert_zone_type: alertZoneType,
      selected_states: selectedStates,
      alert_radius_km: alertRadius,
      social_notifications_silenced: socialSilenced,
      updated_at: new Date().toISOString(),
    };

    if (isOffline()) {
      enqueueAction("settings", { ...settingsData, _settingsId: settingsId });
      setSaveSuccess(true);
      setSaving(false);
      setTimeout(() => setSaveSuccess(false), 2000);
      return;
    }

    const doSave = async (data: typeof settingsData) => {
      if (settingsId) {
        return supabase.from("user_settings").update(data).eq("id", settingsId).select().single();
      }
      return supabase.from("user_settings").insert(data).select().single();
    };

    try {
      let result = await doSave(settingsData);

      // Only strip the column if the DB says it doesn't exist (PostgREST 42703 / PGRST204).
      const err: any = result.error;
      const missingCol =
        err &&
        (err.code === "42703" ||
          err.code === "PGRST204" ||
          /social_notifications_silenced/i.test(err.message || ""));
      if (missingCol) {
        const { social_notifications_silenced: _drop, ...coreData } = settingsData;
        void _drop;
        result = await doSave(coreData as typeof settingsData);
      }

      if (!result.error) {
        setSettingsId(result.data.id);
        saveToCache(`settings-${user.id}`, result.data);
        setSaveSuccess(true);
        setSaveError("");
        setTimeout(() => setSaveSuccess(false), 2000);
      } else {
        setSaveError(result.error.message || "Failed to save");
        setTimeout(() => setSaveError(""), 4000);
      }
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save settings");
      setTimeout(() => setSaveError(""), 4000);
    } finally {
      setSaving(false);
    }
  };


  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const handleDeleteAccount = async () => {
    if (!user) return;

    if (deleteConfirmText !== "DELETE") {
      setDeleteError("Please type DELETE to confirm");
      return;
    }

    setDeleting(true);
    setDeleteError("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("No active session");

      const response = await fetch(apiUrl("/api/delete-account"), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete account");

      await signOut();
      router.push("/login");
    } catch (err: any) {
      setDeleteError(err.message || "Failed to delete account. Please try again.");
      setDeleting(false);
    }
  };

  const toggleState = (state: string) => {
    setSelectedStates((prev) =>
      prev.includes(state) ? prev.filter((s) => s !== state) : [...prev, state]
    );
  };

  // ─── Change Password Handlers ───
  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError("");

    if (!oldPassword) {
      setPwError("Enter your current password");
      return;
    }

    if (!isPasswordStrong(newPassword)) {
      setPwError("New password doesn't meet requirements");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPwError("Passwords don't match");
      return;
    }

    setPwLoading(true);

    try {
      const res = await fetch("/api/auth/request-password-change/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ oldPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setPwError(data.error || "Something went wrong");
        setPwLoading(false);
        return;
      }

      // Show code from response + notification
      if (data.code) {
        setPwCodeDisplay(data.code);
      }
      setPwStep(2);
    } catch {
      setPwError("Connection error. Try again.");
    } finally {
      setPwLoading(false);
    }
  };

  const handleConfirmChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError("");

    if (!pwCode.trim()) {
      setPwError("Enter the verification code");
      return;
    }

    setPwLoading(true);

    try {
      const res = await fetch("/api/auth/confirm-password-change/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ code: pwCode.trim(), newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setPwError(data.error || "Something went wrong");
        setPwLoading(false);
        return;
      }

      setPwSuccess(true);
      setTimeout(() => {
        setShowChangePassword(false);
        setPwStep(1);
        setOldPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
        setPwCode("");
        setPwCodeDisplay(null);
        setPwSuccess(false);
      }, 2500);
    } catch {
      setPwError("Connection error. Try again.");
    } finally {
      setPwLoading(false);
    }
  };

  const copyCode = async () => {
    if (!pwCodeDisplay) return;
    try {
      await navigator.clipboard.writeText(pwCodeDisplay);
      setPwCopied(true);
      setTimeout(() => setPwCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = pwCodeDisplay;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setPwCopied(true);
      setTimeout(() => setPwCopied(false), 2000);
    }
  };

  const resetPasswordModal = () => {
    setShowChangePassword(false);
    setPwStep(1);
    setOldPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setPwCode("");
    setPwCodeDisplay(null);
    setPwError("");
    setPwSuccess(false);
    setPwCopied(false);
  };

  const ToggleSwitch = ({
    enabled,
    onChange,
  }: {
    enabled: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
        enabled ? "bg-primary-600" : "bg-dark-600"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition duration-200 ease-in-out ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
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
          <Icon className={`w-5 h-5 ${danger ? "text-red-500" : "text-primary-400"}`} />
        </div>
        <div>
          <p className={`font-medium ${danger ? "text-red-500" : "text-dark-100"}`}>{label}</p>
          {description && <p className="text-sm text-dark-400">{description}</p>}
        </div>
      </div>
      {children || (onClick && <ChevronRight className="w-5 h-5 text-dark-400" />)}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen pb-20">
        <header className="fixed top-0 left-0 right-0 z-50 glass-header">
          <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-20 rounded-lg" />
          </div>
        </header>
        <main className="pt-14 max-w-2xl mx-auto px-4 py-6 space-y-4">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass-header">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-lg font-semibold text-dark-100">Settings</h1>
          <button
            onClick={saveSettings}
            disabled={saving}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 text-sm font-medium ${
              saveSuccess
                ? "bg-green-500/20 text-green-400"
                : saveError
                ? "bg-red-500/20 text-red-400"
                : "bg-primary-600 text-white hover:bg-primary-700 active:scale-95"
            }`}
          >
            {saving ? (
              <PejaSpinner className="w-4 h-4" />
            ) : saveSuccess ? (
              <><CheckCircle className="w-4 h-4" /><span>Saved</span></>
            ) : saveError ? (
              <span>Failed</span>
            ) : (
              <span>Save</span>
            )}
          </button>
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto px-4">
        {saveError && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-sm text-red-400 text-center">{saveError}</p>
          </div>
        )}

        {/* Notifications Section */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Notifications</h2>

          <SettingRow
            icon={Bell}
            label="Push Notifications"
            description="Receive alerts on your device"
          >
            <ToggleSwitch enabled={pushEnabled} onChange={setPushEnabled} />
          </SettingRow>

          {pushEnabled && (
            <div className="ml-4 mt-2 space-y-4 p-4 glass-sm rounded-xl">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-dark-100 font-medium">Danger Alerts</p>
                    <p className="text-xs text-dark-400">
                      Kidnapping, Terrorist Attack
                    </p>
                  </div>
                  <ToggleSwitch enabled={dangerAlerts} onChange={setDangerAlerts} />
                </div>
              </div>

              <div className="pt-3 border-t border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-dark-100 font-medium">Info Alerts</p>
                    <p className="text-xs text-dark-400">General Alert</p>
                  </div>
                  <ToggleSwitch enabled={infoAlerts} onChange={setInfoAlerts} />
                </div>
              </div>

              <div className="mt-4 p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
                <p className="text-xs text-primary-400 font-medium">
                  Danger and Caution alerts are enabled by default for your safety
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Alert Zone Section */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Alert Zone</h2>
          <p className="text-sm text-dark-400 mb-4">
            Choose where you want to receive incident alerts from
          </p>

          <div className="mb-4 p-3 glass-sm rounded-xl">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-primary-400" />
              <span className="text-dark-200">Current:</span>
              <span className="text-primary-400 font-medium">
                {alertZoneType === "all_nigeria" && "All of Nigeria"}
                {alertZoneType === "states" &&
                  (selectedStates.length > 0
                    ? selectedStates.join(", ")
                    : "No states selected")}
                {alertZoneType === "radius" && `${alertRadius}km radius`}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <label
              className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-colors ${
                alertZoneType === "all_nigeria"
                  ? "bg-primary-600/20 border border-primary-500/50"
                  : "glass-sm hover:bg-white/5"
              }`}
            >
              <input
                type="radio"
                name="alertZone"
                checked={alertZoneType === "all_nigeria"}
                onChange={() => setAlertZoneType("all_nigeria")}
                className="sr-only"
              />
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  alertZoneType === "all_nigeria"
                    ? "border-primary-500 bg-primary-500"
                    : "border-dark-500"
                }`}
              >
                {alertZoneType === "all_nigeria" && <Check className="w-3 h-3 text-white" />}
              </div>
              <div>
                <p className="text-dark-100 font-medium">All of Nigeria</p>
                <p className="text-sm text-dark-400">Receive alerts from anywhere in Nigeria</p>
              </div>
            </label>

            <label
              className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-colors ${
                alertZoneType === "radius"
                  ? "bg-primary-600/20 border border-primary-500/50"
                  : "glass-sm hover:bg-white/5"
              }`}
            >
              <input
                type="radio"
                name="alertZone"
                checked={alertZoneType === "radius"}
                onChange={() => setAlertZoneType("radius")}
                className="sr-only"
              />
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  alertZoneType === "radius"
                    ? "border-primary-500 bg-primary-500"
                    : "border-dark-500"
                }`}
              >
                {alertZoneType === "radius" && <Check className="w-3 h-3 text-white" />}
              </div>
              <div className="flex-1">
                <p className="text-dark-100 font-medium">Custom Radius</p>
                <p className="text-sm text-dark-400">{alertRadius}km from your location</p>
              </div>
            </label>

            {alertZoneType === "radius" && (
              <div className="ml-8 p-4 glass-sm rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-dark-400">Radius</span>
                  <span className="text-primary-400 font-medium">{alertRadius} km</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="50"
                  step="1"
                  value={alertRadius}
                  onChange={(e) => setAlertRadius(Number(e.target.value))}
                  className="w-full accent-primary-500"
                />
                <div className="flex justify-between text-xs text-dark-500 mt-1">
                  <span>1 km</span>
                  <span>25 km</span>
                  <span>50 km</span>
                </div>
              </div>
            )}

            <label
              className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-colors ${
                alertZoneType === "states"
                  ? "bg-primary-600/20 border border-primary-500/50"
                  : "glass-sm hover:bg-white/5"
              }`}
            >
              <input
                type="radio"
                name="alertZone"
                checked={alertZoneType === "states"}
                onChange={() => setAlertZoneType("states")}
                className="sr-only"
              />
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  alertZoneType === "states"
                    ? "border-primary-500 bg-primary-500"
                    : "border-dark-500"
                }`}
              >
                {alertZoneType === "states" && <Check className="w-3 h-3 text-white" />}
              </div>
              <div className="flex-1">
                <p className="text-dark-100 font-medium">Selected States</p>
                <p className="text-sm text-dark-400">
                  {selectedStates.length > 0
                    ? `${selectedStates.length} states selected`
                    : "Choose specific states"}
                </p>
              </div>
              {alertZoneType === "states" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowStatesModal(true);
                  }}
                  className="text-primary-400 text-sm px-3 py-1 rounded-lg hover:bg-white/10"
                >
                  Edit
                </button>
              )}
            </label>

            {alertZoneType === "states" && selectedStates.length > 0 && (
              <div className="ml-8 p-4 glass-sm rounded-xl">
                <p className="text-xs text-dark-400 mb-2">Selected states:</p>
                <div className="flex flex-wrap gap-2">
                  {selectedStates.map((state) => (
                    <span
                      key={state}
                      className="px-2 py-1 bg-primary-600/20 text-primary-400 text-xs rounded-lg"
                    >
                      {state}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {alertZoneType === "states" && selectedStates.length === 0 && (
              <div className="ml-8 p-4 glass-sm rounded-xl flex items-center gap-2 text-orange-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm">Please select at least one state</span>
              </div>
            )}
          </div>
        </section>

        {/* Social Notifications */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Social Notifications</h2>
          <SettingRow
            icon={Bell}
            label="Silence Social Notifications"
            description="Mute likes, comments, and confirms"
          >
            <ToggleSwitch enabled={socialSilenced} onChange={setSocialSilenced} />
          </SettingRow>
        </section>

        {/* Security Section — NEW */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Security</h2>
          <SettingRow
            icon={KeyRound}
            label="Change Password"
            description="Update your account password"
            onClick={() => setShowChangePassword(true)}
          />
        </section>

        {/* Support */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Support</h2>
          <SettingRow
            icon={Users}
            label="Emergency Contacts"
            description="Manage SOS contacts"
            onClick={() => router.push("/emergency-contacts")}
          />
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
                <button
  onClick={() => {
    resetTutorial();
    window.dispatchEvent(new Event("peja-start-tutorial"));
    router.push("/");
  }}
  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
>
  <div className="flex items-center gap-3">
    <HelpCircle className="w-5 h-5 text-dark-400" />
    <span className="text-sm text-dark-200">App Tutorial</span>
  </div>
  <ChevronRight className="w-4 h-4 text-dark-500" />
</button>
        </section>

        {/* Account */}
        <section className="py-6">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Account</h2>
          <SettingRow icon={LogOut} label="Sign Out" onClick={handleSignOut} danger />
          <SettingRow
            icon={Trash2}
            label="Delete Account"
            onClick={() => setShowDeleteModal(true)}
            danger
          />
        </section>

        <p className="text-center text-sm text-dark-500 py-4">Peja v1.0.8</p>
      </main>

      {/* ─── Change Password Modal ─── */}
      {showChangePassword && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={resetPasswordModal}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md max-h-[85vh] overflow-y-auto">
            <div className="glass-card">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary-600/20">
                    <Lock className="w-5 h-5 text-primary-400" />
                  </div>
                  <h2 className="text-lg font-semibold text-dark-100">Change Password</h2>
                </div>
                <button
                  onClick={resetPasswordModal}
                  className="p-1 hover:bg-white/10 rounded-lg"
                >
                  <X className="w-5 h-5 text-dark-400" />
                </button>
              </div>

              {pwSuccess ? (
                <div className="text-center py-8">
                  <ShieldCheck className="w-14 h-14 text-green-400 mx-auto mb-4" />
                  <p className="text-green-400 font-semibold text-lg">Password Changed!</p>
                  <p className="text-dark-400 text-sm mt-2">
                    Your password has been updated successfully.
                  </p>
                </div>
              ) : pwStep === 1 ? (
                <form onSubmit={handleRequestCode} className="space-y-4">
                  {pwError && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                      <p className="text-sm text-red-400">{pwError}</p>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-dark-200 mb-1.5">
                      Current Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                      <input
                        type={showPwOld ? "text" : "password"}
                        value={oldPassword}
                        onChange={(e) => {
                          setOldPassword(e.target.value);
                          setPwError("");
                        }}
                        placeholder="Enter current password"
                        className="w-full pl-10 pr-10 py-3 glass-input"
                        disabled={pwLoading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwOld(!showPwOld)}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        {showPwOld ? (
                          <EyeOff className="w-4 h-4 text-dark-500" />
                        ) : (
                          <Eye className="w-4 h-4 text-dark-500" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-dark-200 mb-1.5">
                      New Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                      <input
                        type={showPwNew ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => {
                          setNewPassword(e.target.value);
                          setPwError("");
                        }}
                        placeholder="Create new password"
                        className="w-full pl-10 pr-10 py-3 glass-input"
                        disabled={pwLoading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwNew(!showPwNew)}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        {showPwNew ? (
                          <EyeOff className="w-4 h-4 text-dark-500" />
                        ) : (
                          <Eye className="w-4 h-4 text-dark-500" />
                        )}
                      </button>
                    </div>
                    <PasswordStrength password={newPassword} />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-dark-200 mb-1.5">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                      <input
                        type={showPwNew ? "text" : "password"}
                        value={confirmNewPassword}
                        onChange={(e) => {
                          setConfirmNewPassword(e.target.value);
                          setPwError("");
                        }}
                        placeholder="Confirm new password"
                        className="w-full pl-10 pr-10 py-3 glass-input"
                        disabled={pwLoading}
                      />
                    </div>
                    {confirmNewPassword && confirmNewPassword !== newPassword && (
                      <p className="text-xs text-red-400 mt-1">Passwords don't match</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={pwLoading || !oldPassword || !newPassword || !confirmNewPassword}
                    className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-primary-500 transition-colors flex items-center justify-center gap-2"
                  >
                    {pwLoading ? (
                      <>
                        <PejaSpinner className="w-4 h-4" />
                        Verifying...
                      </>
                    ) : (
                      "Send Verification Code"
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleConfirmChange} className="space-y-4">
                  {pwError && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                      <p className="text-sm text-red-400">{pwError}</p>
                    </div>
                  )}

                  {/* Code display with copy button */}
                  {pwCodeDisplay && (
                    <div className="p-4 rounded-xl bg-primary-600/10 border border-primary-500/30">
                      <p className="text-xs text-dark-400 mb-2 text-center">
                        Your verification code
                      </p>
                      <div className="flex items-center justify-center gap-3">
                        <span className="text-2xl font-mono font-bold text-primary-400 tracking-[0.3em]">
                          {pwCodeDisplay}
                        </span>
                        <button
                          type="button"
                          onClick={copyCode}
                          className={`p-2 rounded-lg transition-colors ${
                            pwCopied
                              ? "bg-green-500/20 text-green-400"
                              : "bg-white/5 text-dark-400 hover:bg-white/10"
                          }`}
                        >
                          {pwCopied ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-dark-500 mt-2 text-center">
                        Also sent to your notifications. Expires in 5 minutes.
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-dark-200 mb-1.5">
                      Enter Verification Code
                    </label>
                    <input
                      type="text"
                      value={pwCode}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                        setPwCode(v);
                        setPwError("");
                      }}
                      placeholder="Enter 6-digit code"
                      className="w-full px-4 py-3 glass-input text-xl tracking-[0.4em] text-center font-mono"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      disabled={pwLoading}
                      autoFocus
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={pwLoading || pwCode.length < 6}
                    className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-primary-500 transition-colors flex items-center justify-center gap-2"
                  >
                    {pwLoading ? (
                      <>
                        <PejaSpinner className="w-4 h-4" />
                        Changing...
                      </>
                    ) : (
                      "Confirm Password Change"
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPwStep(1);
                      setPwCode("");
                      setPwCodeDisplay(null);
                      setPwError("");
                    }}
                    className="w-full text-sm text-dark-400 hover:text-dark-200 py-2"
                  >
                    Go back
                  </button>
                </form>
              )}
            </div>
          </div>
          </div>
        </>
      )}



      {/* States Selection Modal */}
      {showStatesModal && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={() => setShowStatesModal(false)}
          />
          <div className="fixed inset-4 z-50 max-w-md mx-auto my-auto max-h-[80vh] overflow-hidden flex flex-col">
            <div className="glass-card flex flex-col h-full">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <h2 className="text-lg font-semibold text-dark-100">Select States</h2>
                <button
                  onClick={() => setShowStatesModal(false)}
                  className="p-1 hover:bg-white/10 rounded-lg"
                >
                  <X className="w-5 h-5 text-dark-400" />
                </button>
              </div>

              <div className="overflow-y-auto flex-1 -mx-6 px-6">
                <div className="grid grid-cols-2 gap-2">
                  {NIGERIAN_STATES.map((state) => (
                    <button
                      key={state}
                      type="button"
                      onClick={() => toggleState(state)}
                      className={`p-3 rounded-lg text-left text-sm transition-colors ${
                        selectedStates.includes(state)
                          ? "bg-primary-600/20 text-primary-400 border border-primary-500/50"
                          : "glass-sm text-dark-300 hover:bg-white/5"
                      }`}
                    >
                      {state}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-white/5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowStatesModal(false)}
                  className="w-full py-3 bg-primary-600 text-white rounded-xl font-medium"
                >
                  Done ({selectedStates.length} selected)
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/80"
            onClick={() => !deleting && setShowDeleteModal(false)}
          />
          <div className="relative glass-strong rounded-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Delete Account</h3>
                <p className="text-sm text-dark-400">This action cannot be undone</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                <p className="text-sm text-red-300 mb-2">This will permanently delete:</p>
                <ul className="text-sm text-red-400 space-y-1">
                  <li>• All your posts and media</li>
                  <li>• Your profile information</li>
                  <li>• Your emergency contacts</li>
                  <li>• All your notifications</li>
                  <li>• Your account settings</li>
                </ul>
              </div>

              <div>
                <label className="block text-sm text-dark-300 mb-2">
                  Type <span className="font-bold text-red-400">DELETE</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => {
                    setDeleteConfirmText(e.target.value.toUpperCase());
                    setDeleteError("");
                  }}
                  placeholder="DELETE"
                  className="w-full px-4 py-3 glass-input text-base"
                  disabled={deleting}
                />
              </div>

              {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteConfirmText("");
                    setDeleteError("");
                  }}
                  disabled={deleting}
                  className="flex-1 py-3 bg-dark-700 text-dark-300 rounded-xl font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting || deleteConfirmText !== "DELETE"}
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <PejaSpinner className="w-4 h-4" />
                      Deleting...
                    </>
                  ) : (
                    "Delete Forever"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>

  );
}