"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { NIGERIAN_STATES } from "@/lib/types";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import {
  ArrowLeft,
  Bell,
  Shield,
  HelpCircle,
  FileText,
  LogOut,
  ChevronRight,
  Smartphone,
  Clock,
  Check,
  X,
  Loader2,
  CheckCircle,
  Users,
  Save,
  MapPin,
  AlertTriangle,
} from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
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

  // Quiet hours
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState("23:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState("07:00");

  // Modals
  const [showStatesModal, setShowStatesModal] = useState(false);

  // Debug info
  const [debugInfo, setDebugInfo] = useState<string>("");
useScrollRestore("settings");
  useEffect(() => {
    if (user) {
      loadSettings();
    } else {
      setLoading(false);
    }
  }, [user]);

  const loadSettings = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      console.log("Loading settings for user:", user.id);
      
      const { data: settings, error } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      console.log("Loaded settings:", settings);
      console.log("Load error:", error);

      if (error && error.code !== "PGRST116") {
        console.error("Load settings error:", error);
        setDebugInfo(`Load error: ${error.message}`);
      }

      if (settings) {
        setSettingsId(settings.id);
        setPushEnabled(settings.push_enabled ?? true);
        setDangerAlerts(settings.danger_alerts ?? true);
        setCautionAlerts(settings.caution_alerts ?? true);
        setAwarenessAlerts(settings.awareness_alerts ?? false);
        setInfoAlerts(settings.info_alerts ?? false);
        setAlertZoneType(settings.alert_zone_type ?? "all_nigeria");
        setSelectedStates(settings.selected_states ?? []);
        setAlertRadius(settings.alert_radius_km ?? 5);
        setQuietHoursEnabled(settings.quiet_hours_enabled ?? false);
        setQuietHoursStart(settings.quiet_hours_start ?? "23:00");
        setQuietHoursEnd(settings.quiet_hours_end ?? "07:00");
        
        setDebugInfo(`Loaded: zone=${settings.alert_zone_type}, states=${JSON.stringify(settings.selected_states)}`);
      } else {
        setDebugInfo("No settings found, using defaults");
      }
    } catch (error: any) {
      console.error("Error loading settings:", error);
      setDebugInfo(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!user) {
      setSaveError("Please sign in to save settings");
      return;
    }

    setSaving(true);
    setSaveSuccess(false);
    setSaveError("");

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
      quiet_hours_enabled: quietHoursEnabled,
      quiet_hours_start: quietHoursStart,
      quiet_hours_end: quietHoursEnd,
      updated_at: new Date().toISOString(),
    };

    console.log("Saving settings:", settingsData);

    try {
      let result;
      
      if (settingsId) {
        // Update existing
        result = await supabase
          .from("user_settings")
          .update(settingsData)
          .eq("id", settingsId)
          .select()
          .single();
      } else {
        // Insert new
        result = await supabase
          .from("user_settings")
          .insert(settingsData)
          .select()
          .single();
      }

      console.log("Save result:", result);

      if (result.error) {
        console.error("Save error:", result.error);
        setSaveError(`Failed to save: ${result.error.message}`);
        setDebugInfo(`Save error: ${result.error.message}`);
      } else {
        setSettingsId(result.data.id);
        setSaveSuccess(true);
        setDebugInfo(`Saved! zone=${result.data.alert_zone_type}, states=${JSON.stringify(result.data.selected_states)}`);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (error: any) {
      console.error("Error saving settings:", error);
      setSaveError(`Error: ${error.message}`);
      setDebugInfo(`Exception: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  const toggleState = (state: string) => {
    setSelectedStates((prev) =>
      prev.includes(state) ? prev.filter((s) => s !== state) : [...prev, state]
    );
  };

  const ToggleSwitch = ({ enabled, onChange }: { enabled: boolean; onChange: (value: boolean) => void }) => (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${enabled ? "bg-primary-600" : "bg-dark-600"}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition duration-200 ease-in-out ${enabled ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );

  const SettingRow = ({ icon: Icon, label, description, children, onClick, danger }: { icon: any; label: string; description?: string; children?: React.ReactNode; onClick?: () => void; danger?: boolean }) => (
    <div className={`flex items-center justify-between py-4 px-2 rounded-lg ${onClick ? "cursor-pointer hover:bg-white/5 active:bg-white/10" : ""} transition-colors`} onClick={onClick}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${danger ? "bg-red-500/10" : "bg-dark-700"}`}>
          <Icon className={`w-5 h-5 ${danger ? "text-red-400" : "text-primary-400"}`} />
        </div>
        <div>
          <p className={`font-medium ${danger ? "text-red-400" : "text-dark-100"}`}>{label}</p>
          {description && <p className="text-sm text-dark-400">{description}</p>}
        </div>
      </div>
      {children || (onClick && <ChevronRight className="w-5 h-5 text-dark-400" />)}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass-header">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-lg font-semibold text-dark-100">Settings</h1>
          <button
            onClick={saveSettings}
            disabled={saving}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              saveSuccess 
                ? "bg-green-500/20 text-green-400" 
                : "bg-primary-600 text-white hover:bg-primary-700"
            }`}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saveSuccess ? (
              <>
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm">Saved</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span className="text-sm">Save</span>
              </>
            )}
          </button>
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto px-4">
        {/* Debug Info */}
        {debugInfo && (
          <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p className="text-xs text-blue-400 font-mono">{debugInfo}</p>
          </div>
        )}

        {/* Save feedback */}
        {saveSuccess && (
          <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <p className="text-sm text-green-400 text-center">✓ Settings saved successfully!</p>
          </div>
        )}

        {saveError && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-sm text-red-400 text-center">{saveError}</p>
          </div>
        )}

        {/* Notifications Section */}
<section className="py-6 border-b border-white/5">
  <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Notifications</h2>

  <SettingRow icon={Bell} label="Push Notifications" description="Receive alerts on your device">
    <ToggleSwitch enabled={pushEnabled} onChange={setPushEnabled} />
  </SettingRow>

  {pushEnabled && (
    <div className="ml-4 mt-2 space-y-4 p-4 glass-sm rounded-xl">
      {/* 🔴 DANGER ALERTS */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-dark-100 font-medium">🔴 Danger Alerts</p>
            <p className="text-xs text-dark-400">Crime, Fire, Accidents, Police, Flooding</p>
          </div>
          <ToggleSwitch enabled={dangerAlerts} onChange={setDangerAlerts} />
        </div>
      </div>

      {/* 🟠 CAUTION ALERTS */}
      <div className="pt-3 border-t border-white/5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-dark-100 font-medium">🟠 Caution Alerts</p>
            <p className="text-xs text-dark-400">Road Work, Traffic, Power Outages</p>
          </div>
          <ToggleSwitch enabled={cautionAlerts} onChange={setCautionAlerts} />
        </div>
      </div>

      {/* 🟡 AWARENESS ALERTS */}
      <div className="pt-3 border-t border-white/5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-dark-100 font-medium">🟡 Awareness Alerts</p>
            <p className="text-xs text-dark-400">Protests, Events, Animal Hazards, Disturbances</p>
          </div>
          <ToggleSwitch enabled={awarenessAlerts} onChange={setAwarenessAlerts} />
        </div>
      </div>

      {/* 🔵 INFO ALERTS */}
      <div className="pt-3 border-t border-white/5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-dark-100 font-medium">🔵 Info Alerts</p>
            <p className="text-xs text-dark-400">General Info, Store Closures, Transport Issues</p>
          </div>
          <ToggleSwitch enabled={infoAlerts} onChange={setInfoAlerts} />
        </div>
      </div>

      {/* Info message about defaults */}
      <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <p className="text-xs text-blue-400">
          💡 Danger and Caution alerts are enabled by default for your safety
        </p>
      </div>
    </div>
  )}
</section>

        {/* Alert Zone Section */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Alert Zone</h2>
          <p className="text-sm text-dark-400 mb-4">Choose where you want to receive incident alerts from</p>

          {/* Current Selection Display */}
          <div className="mb-4 p-3 glass-sm rounded-xl">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-primary-400" />
              <span className="text-dark-200">Current:</span>
              <span className="text-primary-400 font-medium">
                {alertZoneType === "all_nigeria" && "All of Nigeria"}
                {alertZoneType === "states" && (selectedStates.length > 0 ? selectedStates.join(", ") : "No states selected")}
                {alertZoneType === "radius" && `${alertRadius}km radius`}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {/* All of Nigeria */}
            <label className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-colors ${alertZoneType === "all_nigeria" ? "bg-primary-600/20 border border-primary-500/50" : "glass-sm hover:bg-white/5"}`}>
              <input 
                type="radio" 
                name="alertZone" 
                checked={alertZoneType === "all_nigeria"} 
                onChange={() => setAlertZoneType("all_nigeria")} 
                className="sr-only" 
              />
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${alertZoneType === "all_nigeria" ? "border-primary-500 bg-primary-500" : "border-dark-500"}`}>
                {alertZoneType === "all_nigeria" && <Check className="w-3 h-3 text-white" />}
              </div>
              <div>
                <p className="text-dark-100 font-medium">All of Nigeria</p>
                <p className="text-sm text-dark-400">Receive alerts from anywhere in Nigeria</p>
              </div>
            </label>

            {/* Custom Radius */}
            <label className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-colors ${alertZoneType === "radius" ? "bg-primary-600/20 border border-primary-500/50" : "glass-sm hover:bg-white/5"}`}>
              <input 
                type="radio" 
                name="alertZone" 
                checked={alertZoneType === "radius"} 
                onChange={() => setAlertZoneType("radius")} 
                className="sr-only" 
              />
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${alertZoneType === "radius" ? "border-primary-500 bg-primary-500" : "border-dark-500"}`}>
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

            {/* Selected States */}
            <label className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-colors ${alertZoneType === "states" ? "bg-primary-600/20 border border-primary-500/50" : "glass-sm hover:bg-white/5"}`}>
              <input 
                type="radio" 
                name="alertZone" 
                checked={alertZoneType === "states"} 
                onChange={() => setAlertZoneType("states")} 
                className="sr-only" 
              />
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${alertZoneType === "states" ? "border-primary-500 bg-primary-500" : "border-dark-500"}`}>
                {alertZoneType === "states" && <Check className="w-3 h-3 text-white" />}
              </div>
              <div className="flex-1">
                <p className="text-dark-100 font-medium">Selected States</p>
                <p className="text-sm text-dark-400">
                  {selectedStates.length > 0 ? `${selectedStates.length} states selected` : "Choose specific states"}
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

            {/* Show selected states */}
            {alertZoneType === "states" && selectedStates.length > 0 && (
              <div className="ml-8 p-4 glass-sm rounded-xl">
                <p className="text-xs text-dark-400 mb-2">Selected states:</p>
                <div className="flex flex-wrap gap-2">
                  {selectedStates.map((state) => (
                    <span key={state} className="px-2 py-1 bg-primary-600/20 text-primary-400 text-xs rounded-lg">
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

        {/* Quiet Hours */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Quiet Hours</h2>

          <SettingRow icon={Clock} label="Enable Quiet Hours" description="Only Danger alerts during set hours">
            <ToggleSwitch enabled={quietHoursEnabled} onChange={setQuietHoursEnabled} />
          </SettingRow>

          {quietHoursEnabled && (
            <div className="ml-4 mt-2 p-4 glass-sm rounded-xl flex gap-4">
              <div className="flex-1">
                <label className="text-xs text-dark-400 block mb-1">Start Time</label>
                <input 
                  type="time" 
                  value={quietHoursStart} 
                  onChange={(e) => setQuietHoursStart(e.target.value)} 
                  className="w-full px-3 py-2 glass-input text-base" 
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-dark-400 block mb-1">End Time</label>
                <input 
                  type="time" 
                  value={quietHoursEnd} 
                  onChange={(e) => setQuietHoursEnd(e.target.value)} 
                  className="w-full px-3 py-2 glass-input text-base" 
                />
              </div>
            </div>
          )}
        </section>

        {/* Support */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Support</h2>
          <SettingRow icon={Users} label="Emergency Contacts" description="Manage SOS contacts" onClick={() => router.push("/emergency-contacts")} />
          <SettingRow icon={Shield} label="Privacy Policy" onClick={() => router.push("/privacy")} />
          <SettingRow icon={HelpCircle} label="Help & Support" onClick={() => router.push("/help")} />
          <SettingRow icon={FileText} label="Terms of Service" onClick={() => router.push("/terms")} />
        </section>

        {/* Account */}
        <section className="py-6">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">Account</h2>
          <SettingRow icon={LogOut} label="Log Out" onClick={handleLogout} danger />
        </section>

        <p className="text-center text-sm text-dark-500 py-4">Peja v1.0.0 • Made with ❤️ in Nigeria</p>
      </main>

      {/* States Selection Modal */}
      {showStatesModal && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => setShowStatesModal(false)} />
          <div className="fixed inset-4 z-50 max-w-md mx-auto my-auto max-h-[80vh] overflow-hidden flex flex-col">
            <div className="glass-card flex flex-col h-full">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <h2 className="text-lg font-semibold text-dark-100">Select States</h2>
                <button onClick={() => setShowStatesModal(false)} className="p-1 hover:bg-white/10 rounded-lg">
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
    </div>
  );
}