"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  AlertTriangle,
  MapPin,
  Clock,
  User,
  Loader2,
  CheckCircle,
  XCircle,
  Eye,
  Phone,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface SOSData {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  address: string;
  status: string;
  tag: string;
  message: string;
  voice_note_url: string;
  created_at: string;
  resolved_at: string;
  users?: { full_name: string; email: string; phone: string; avatar_url: string };
}

export default function AdminSOSPage() {
  const [sosAlerts, setSOSAlerts] = useState<SOSData[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedSOS, setSelectedSOS] = useState<SOSData | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchSOS();

    // Real-time updates
    const channel = supabase
      .channel('admin-sos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => {
        fetchSOS();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [statusFilter]);

  const fetchSOS = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("sos_alerts")
        .select(`
          *,
          users:user_id (full_name, email, phone, avatar_url)
        `)
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query.limit(100);

      if (error) throw error;
      setSOSAlerts(data || []);
    } catch (error) {
      console.error("Error fetching SOS:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (sosId: string, newStatus: string) => {
    setActionLoading(true);
    try {
      const updates: any = { status: newStatus };
      if (newStatus === "resolved" || newStatus === "false_alarm" || newStatus === "cancelled") {
        updates.resolved_at = new Date().toISOString();
      }

      await supabase.from("sos_alerts").update(updates).eq("id", sosId);

      await supabase.from("admin_logs").insert({
        admin_id: (await supabase.auth.getUser()).data.user?.id,
        action: `Changed SOS status to ${newStatus}`,
        target_type: "sos",
        target_id: sosId,
      });

      fetchSOS();
      setShowModal(false);
      setSelectedSOS(null);
    } catch (error) {
      console.error("Error updating SOS:", error);
      alert("Failed to update SOS status");
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-red-500/20 text-red-400 border-red-500/30";
      case "resolved": return "bg-green-500/20 text-green-400 border-green-500/30";
      case "cancelled": return "bg-gray-500/20 text-gray-400 border-gray-500/30";
      case "false_alarm": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      default: return "bg-dark-600 text-dark-400";
    }
  };

  const activeCount = sosAlerts.filter(s => s.status === "active").length;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark-100">SOS Alerts</h1>
        <p className="text-dark-400 mt-1">Monitor and manage emergency alerts</p>
      </div>

      {/* Active Alert Banner */}
      {activeCount > 0 && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-red-400 animate-pulse" />
          <div>
            <p className="font-semibold text-red-400">{activeCount} Active SOS Alert{activeCount > 1 ? "s" : ""}</p>
            <p className="text-sm text-dark-400">Requires immediate attention</p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {["all", "active", "resolved", "cancelled", "false_alarm"].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              statusFilter === status
                ? "bg-primary-600 text-white"
                : "glass-sm text-dark-300 hover:bg-white/10"
            }`}
          >
            {status === "all" ? "All" : status.replace("_", " ").charAt(0).toUpperCase() + status.replace("_", " ").slice(1)}
          </button>
        ))}
      </div>

      {/* SOS List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      ) : sosAlerts.length === 0 ? (
        <div className="glass-card text-center py-12">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <p className="text-dark-400">No SOS alerts found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sosAlerts.map((sos) => (
            <div
              key={sos.id}
              onClick={() => { setSelectedSOS(sos); setShowModal(true); }}
              className={`glass-card cursor-pointer hover:bg-white/5 transition-colors ${
                sos.status === "active" ? "border-red-500/30" : ""
              }`}
            >
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className={`w-12 h-12 rounded-full overflow-hidden shrink-0 ${
                  sos.status === "active" ? "border-2 border-red-500" : "border border-dark-600"
                }`}>
                  {sos.users?.avatar_url ? (
                    <img src={sos.users.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-dark-700 flex items-center justify-center">
                      <User className="w-6 h-6 text-dark-400" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-dark-100">{sos.users?.full_name || "Unknown User"}</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${getStatusColor(sos.status)}`}>
                      {sos.status === "false_alarm" ? "False Alarm" : sos.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-dark-400">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      <span className="truncate max-w-[200px]">{sos.address || "Unknown location"}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(sos.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>

                {/* Action */}
                <button className="p-2 hover:bg-white/10 rounded-lg shrink-0">
                  <Eye className="w-5 h-5 text-primary-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SOS Detail Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setSelectedSOS(null); }}
        title="SOS Alert Details"
        size="lg"
      >
        {selectedSOS && (
          <div className="space-y-4">
            {/* User Info */}
            <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-red-500 shrink-0">
                {selectedSOS.users?.avatar_url ? (
                  <img src={selectedSOS.users.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-dark-700 flex items-center justify-center">
                    <User className="w-8 h-8 text-dark-400" />
                  </div>
                )}
              </div>
              <div>
                <p className="font-bold text-dark-100 text-lg">{selectedSOS.users?.full_name || "Unknown"}</p>
                <p className="text-sm text-dark-400">{selectedSOS.users?.email}</p>
                {selectedSOS.users?.phone && (
                  <a href={`tel:${selectedSOS.users.phone}`} className="text-sm text-primary-400 flex items-center gap-1 mt-1">
                    <Phone className="w-3 h-3" />
                    {selectedSOS.users.phone}
                  </a>
                )}
              </div>
            </div>

            {/* SOS Details */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-dark-500">Status</p>
                <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-sm border ${getStatusColor(selectedSOS.status)}`}>
                  {selectedSOS.status}
                </span>
              </div>
              <div>
                <p className="text-xs text-dark-500">Tag</p>
                <p className="text-dark-200 capitalize">{selectedSOS.tag || "No tag"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-dark-500">Location</p>
                <p className="text-dark-200">{selectedSOS.address || "Unknown"}</p>
                <p className="text-xs text-dark-500 mt-1">
                  {selectedSOS.latitude?.toFixed(6)}, {selectedSOS.longitude?.toFixed(6)}
                </p>
              </div>
              <div>
                <p className="text-xs text-dark-500">Created</p>
                <p className="text-dark-200">{format(new Date(selectedSOS.created_at), "PPpp")}</p>
              </div>
              {selectedSOS.resolved_at && (
                <div>
                  <p className="text-xs text-dark-500">Resolved</p>
                  <p className="text-dark-200">{format(new Date(selectedSOS.resolved_at), "PPpp")}</p>
                </div>
              )}
            </div>

            {selectedSOS.message && (
              <div>
                <p className="text-xs text-dark-500 mb-1">Message</p>
                <p className="text-dark-200 p-3 bg-white/5 rounded-lg">{selectedSOS.message}</p>
              </div>
            )}

            {selectedSOS.voice_note_url && (
              <div>
                <p className="text-xs text-dark-500 mb-2">Voice Note</p>
                <audio src={selectedSOS.voice_note_url} controls className="w-full" />
              </div>
            )}

            {/* Actions */}
            {selectedSOS.status === "active" && (
              <div className="border-t border-white/10 pt-4">
                <p className="text-sm text-dark-400 mb-3">Change Status:</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleStatusChange(selectedSOS.id, "resolved")}
                    disabled={actionLoading}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="w-4 h-4 mr-1" />
                    Mark Resolved
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleStatusChange(selectedSOS.id, "cancelled")}
                    disabled={actionLoading}
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleStatusChange(selectedSOS.id, "false_alarm")}
                    disabled={actionLoading}
                  >
                    <AlertTriangle className="w-4 h-4 mr-1" />
                    False Alarm
                  </Button>
                </div>
              </div>
            )}

            {/* View on Map */}
            <div className="pt-2">
              <a
                href={`https://www.google.com/maps?q=${selectedSOS.latitude},${selectedSOS.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-400 text-sm hover:underline flex items-center gap-1"
              >
                <MapPin className="w-4 h-4" />
                View on Google Maps
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}