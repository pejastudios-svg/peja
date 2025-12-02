"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { NIGERIAN_STATES } from "@/lib/types";
import {
  ArrowLeft,
  Bell,
  Shield,
  HelpCircle,
  FileText,
  LogOut,
  ChevronRight,
  Smartphone,
  MapPin,
  Clock,
  Check,
  X,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";

interface SavedLocation {
  id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radius_km: number;
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);

  // Quiet hours
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState("23:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState("07:00");

  // Modals
  const [showStatesModal, setShowStatesModal] = useState(false);
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationRadius, setNewLocationRadius] = useState(2);

  useEffect(() => {
    loadSettings();
  }, [user]);

  const loadSettings = async () => {
    if (!user) return;

    try {
      // Load user settings
      const { data: settings } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (settings) {
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
      }

      // Load saved locations
      const { data: locations } = await supabase
        .from("saved_locations")
        .select("*")
        .eq("user_id", user.id);

      if (locations) {
        setSavedLocations(locations);
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!user) return;

    setSaving(true);
    try {
      await supabase.from("user_settings").upsert({
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
      });
    } catch (error) {
      console.error("Error saving settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleAddLocation = async () => {
    if (!user || !newLocationName) return;

    // Get current location
    if (!navigator.geolocation) {
      alert("Geolocation is not supported");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { data, error } = await supabase
            .from("saved_locations")
            .insert({
              user_id: user.id,
              name: newLocationName,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              radius_km: newLocationRadius,
            })
            .select()
            .single();

          if (error) throw error;

          setSavedLocations((prev) => [...prev, data]);
          setShowAddLocationModal(false);
          setNewLocationName("");
          setNewLocationRadius(2);
        } catch (error) {
          console.error("Error adding location:", error);
        }
      },
      (error) => {
        alert("Could not get your location. Please enable location services.");
      }
    );
  };

  const handleDeleteLocation = async (id: string) => {
    try {
      await supabase.from("saved_locations").delete().eq("id", id);
      setSavedLocations((prev) => prev.filter((l) => l.id !== id));
    } catch (error) {
      console.error("Error deleting location:", error);
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
      onClick={() => onChange(!enabled)}
      className={`
        relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer 
        rounded-full border-2 border-transparent 
        transition-colors duration-200 ease-in-out
        ${enabled ? "bg-primary-600" : "bg-dark-600"}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-5 w-5 
          transform rounded-full bg-white shadow-lg
          transition duration-200 ease-in-out
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
      <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/5">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-lg font-semibold text-dark-100">Settings</h1>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="p-2 -mr-2 hover:bg-white/5 rounded-lg transition-colors text-primary-400"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto px-4">
        {/* Notifications Section */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">
            Notifications
          </h2>

          <SettingRow icon={Bell} label="Push Notifications" description="Receive alerts on your device">
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

        {/* Alert Zone Section */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">
            Alert Zone
          </h2>
          <p className="text-sm text-dark-400 mb-4">
            Choose where you want to receive incident alerts from
          </p>

          <div className="space-y-3">
            {/* All Nigeria */}
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
                {alertZoneType === "all_nigeria" && (
                  <Check className="w-3 h-3 text-white" />
                )}
              </div>
              <div>
                <p className="text-dark-100 font-medium">All of Nigeria</p>
                <p className="text-sm text-dark-400">Receive alerts from anywhere</p>
              </div>
            </label>

            {/* Selected States */}
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
                  onClick={(e) => {
                    e.preventDefault();
                    setShowStatesModal(true);
                  }}
                  className="text-primary-400 text-sm"
                >
                  Edit
                </button>
              )}
            </label>

            {/* Custom Radius */}
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

            {/* Saved Locations */}
            <label
              className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-colors ${
                alertZoneType === "saved_locations"
                  ? "bg-primary-600/20 border border-primary-500/50"
                  : "glass-sm hover:bg-white/5"
              }`}
            >
              <input
                type="radio"
                name="alertZone"
                checked={alertZoneType === "saved_locations"}
                onChange={() => setAlertZoneType("saved_locations")}
                className="sr-only"
              />
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  alertZoneType === "saved_locations"
                    ? "border-primary-500 bg-primary-500"
                    : "border-dark-500"
                }`}
              >
                {alertZoneType === "saved_locations" && (
                  <Check className="w-3 h-3 text-white" />
                )}
              </div>
              <div>
                <p className="text-dark-100 font-medium">Saved Locations</p>
                <p className="text-sm text-dark-400">Home, Work, School, etc.</p>
              </div>
            </label>

            {alertZoneType === "saved_locations" && (
              <div className="ml-8 space-y-2">
                {savedLocations.map((location) => (
                  <div
                    key={location.id}
                    className="flex items-center justify-between p-3 glass-sm rounded-xl"
                  >
                    <div className="flex items-center gap-3">
                      <MapPin className="w-4 h-4 text-primary-400" />
                      <div>
                        <p className="text-dark-100 text-sm font-medium">{location.name}</p>
                        <p className="text-xs text-dark-400">{location.radius_km}km radius</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteLocation(location.id)}
                      className="p-1 hover:bg-white/5 rounded"
                    >
                      <Trash2 className="w-4 h-4 text-dark-500 hover:text-red-400" />
                    </button>
                  </div>
                ))}

                {savedLocations.length < 5 && (
                  <button
                    onClick={() => setShowAddLocationModal(true)}
                    className="flex items-center gap-2 p-3 w-full glass-sm rounded-xl text-primary-400 hover:bg-white/5"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-sm">Add Location</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Quiet Hours */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">
            Quiet Hours
          </h2>

          <SettingRow
            icon={Clock}
            label="Enable Quiet Hours"
            description="Only Danger alerts during set hours"
          >
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
                  className="w-full px-3 py-2 glass-input text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-dark-400 block mb-1">End Time</label>
                <input
                  type="time"
                  value={quietHoursEnd}
                  onChange={(e) => setQuietHoursEnd(e.target.value)}
                  className="w-full px-3 py-2 glass-input text-sm"
                />
              </div>
            </div>
          )}
        </section>

        {/* General Section */}
        <section className="py-6 border-b border-white/5">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">General</h2>

          <SettingRow icon={Smartphone} label="App Version" description="1.0.0" />
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

        <p className="text-center text-sm text-dark-500 py-4">
          Peja v1.0.0 • Made with ❤️ in Nigeria
        </p>
      </main>

      {/* States Selection Modal */}
      {showStatesModal && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={() => setShowStatesModal(false)}
          />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto max-h-[80vh] overflow-hidden">
            <div className="glass-card flex flex-col max-h-[80vh]">
              <div className="flex items-center justify-between mb-4">
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

              <div className="pt-4 mt-4 border-t border-white/5">
                <button
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

      {/* Add Location Modal */}
      {showAddLocationModal && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={() => setShowAddLocationModal(false)}
          />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto">
            <div className="glass-card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-dark-100">Add Location</h2>
                <button
                  onClick={() => setShowAddLocationModal(false)}
                  className="p-1 hover:bg-white/10 rounded-lg"
                >
                  <X className="w-5 h-5 text-dark-400" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm text-dark-300 block mb-1">Location Name</label>
                  <input
                    type="text"
                    value={newLocationName}
                    onChange={(e) => setNewLocationName(e.target.value)}
                    placeholder="e.g., Home, Work, School"
                    className="w-full px-4 py-3 glass-input"
                  />
                </div>

                <div>
                  <label className="text-sm text-dark-300 block mb-1">
                    Alert Radius: {newLocationRadius} km
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={newLocationRadius}
                    onChange={(e) => setNewLocationRadius(Number(e.target.value))}
                    className="w-full accent-primary-500"
                  />
                  <div className="flex justify-between text-xs text-dark-500 mt-1">
                    <span>500m</span>
                    <span>5 km</span>
                    <span>10 km</span>
                  </div>
                </div>

                <p className="text-sm text-dark-400">
                  Your current location will be used for this saved location.
                </p>

                <button
                  onClick={handleAddLocation}
                  disabled={!newLocationName}
                  className="w-full py-3 bg-primary-600 text-white rounded-xl font-medium disabled:opacity-50"
                >
                  Save Location
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}