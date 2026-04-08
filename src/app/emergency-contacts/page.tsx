"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/context/ToastContext";
import { SafetyCheckIn } from "@/components/safety/SafetyCheckIn";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Search,
  User,
  Users,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Clock,
  X,
  Share2,
  Check,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

interface EmergencyContact {
  id: string;
  user_id: string;
  contact_user_id: string;
  relationship: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  contact_user?: {
    id: string;
    full_name: string;
    avatar_url?: string;
    phone?: string;
  };
}

interface PendingInvite {
  id: string;
  user_id: string;
  relationship: string;
  status: string;
  created_at: string;
  requester?: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
}

interface SearchUser {
  id: string;
  full_name: string;
  avatar_url?: string;
}

const RELATIONSHIPS = ["Parent", "Spouse", "Sibling", "Child", "Friend", "Colleague", "Neighbor", "Other"];

export default function EmergencyContactsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);
  const [relationship, setRelationship] = useState("");
  const [error, setError] = useState("");
  const [showNotOnPeja, setShowNotOnPeja] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      fetchContacts();
      fetchPendingInvites();
    }
  }, [user]);

  useEffect(() => {
    const searchUsers = async () => {
      if (searchQuery.length < 2) { setSearchResults([]); setShowNotOnPeja(false); return; }
      setSearching(true);
      try {
        const { data } = await supabase
          .from("users")
          .select("id, full_name, avatar_url")
          .neq("id", user?.id)
          .ilike("full_name", `%${searchQuery}%`)
          .limit(10);

        if (data && data.length > 0) { setSearchResults(data); setShowNotOnPeja(false); }
        else { setSearchResults([]); setShowNotOnPeja(true); }
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    };
    const t = setTimeout(searchUsers, 300);
    return () => clearTimeout(t);
  }, [searchQuery, user?.id]);

  // Listen for responses from notification page
  useEffect(() => {
    const handleRefresh = () => {
      fetchContacts();
      fetchPendingInvites();
    };
    window.addEventListener("peja-emergency-contact-responded", handleRefresh);
    return () => window.removeEventListener("peja-emergency-contact-responded", handleRefresh);
  }, []);

  const fetchContacts = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("emergency_contacts")
        .select("id, user_id, contact_user_id, relationship, status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (data && data.length > 0) {
        const ids = data.map(c => c.contact_user_id);
        const { data: usersData } = await supabase
          .from("users").select("id, full_name, avatar_url, phone").in("id", ids);

        const map: Record<string, any> = {};
        (usersData || []).forEach(u => { map[u.id] = u; });

        setContacts(data.map(c => ({ ...c, contact_user: map[c.contact_user_id] || null })));
      } else {
        setContacts([]);
      }
    } catch {} finally { setLoading(false); }
  };

  const fetchPendingInvites = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("emergency_contacts")
        .select("id, user_id, relationship, status, created_at")
        .eq("contact_user_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (data && data.length > 0) {
        const requesterIds = data.map(d => d.user_id);
        const { data: usersData } = await supabase
          .from("users").select("id, full_name, avatar_url").in("id", requesterIds);

        const map: Record<string, any> = {};
        (usersData || []).forEach(u => { map[u.id] = u; });

        setPendingInvites(data.map(d => ({ ...d, requester: map[d.user_id] || null })));
      } else {
        setPendingInvites([]);
      }
    } catch {}
  };

  const handleAddContact = async () => {
    if (!selectedUser) { setError("Please select a user"); return; }
    if (!relationship) { setError("Please select a relationship"); return; }
    if (contacts.length >= 10) { setError("Maximum 10 emergency contacts allowed"); return; }

    // Check if already in active contacts (pending or accepted)
    const existing = contacts.find(c => c.contact_user_id === selectedUser.id);
    if (existing && (existing.status === "pending" || existing.status === "accepted")) {
      setError("This person is already in your emergency contacts");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      // If there's a declined entry, delete it first via API
      if (existing && existing.status === "declined") {
        await fetch("/api/sos/delete-emergency-contact", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ contactId: existing.id }),
        });
        setContacts(prev => prev.filter(c => c.id !== existing.id));
      }

      const { data, error: insertError } = await supabase
        .from("emergency_contacts")
        .insert({
          user_id: user?.id,
          contact_user_id: selectedUser.id,
          relationship,
          status: "pending",
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Send notification to the contact
      await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        type: "system",
        title: "Emergency Contact Request",
        body: `${user?.full_name || "Someone"} wants to add you as their emergency contact (${relationship}).`,
        data: {
          type: "emergency_contact_invite",
          contact_id: data.id,
          requester_name: user?.full_name,
          requester_avatar: user?.avatar_url,
          relationship: relationship,
        },
        is_read: false,
      });

      setContacts(prev => [...prev, { ...data, contact_user: selectedUser }]);
      toast.success("Invite sent! Waiting for acceptance.");
      handleCloseModal();
    } catch (err) {
      console.error("Add contact error:", err);
      setError("Failed to add contact. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleRespondToInvite = async (inviteId: string, accept: boolean) => {
    setRespondingId(inviteId);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const res = await fetch("/api/sos/respond-emergency-contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ contactId: inviteId, accept }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          toast.info(`This request was already ${result.status || "handled"}.`);
        } else {
          toast.danger(result.error || "Failed to respond. Try again.");
        }
        setPendingInvites(prev => prev.filter(i => i.id !== inviteId));
        return;
      }

      setPendingInvites(prev => prev.filter(i => i.id !== inviteId));
      toast.success(accept ? "Accepted! You're now their emergency contact." : "Declined.");
      window.dispatchEvent(new Event("peja-emergency-contact-responded"));
    } catch {
      toast.danger("Failed to respond. Try again.");
    } finally {
      setRespondingId(null);
    }
  };

  const handleDeleteContact = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const res = await fetch("/api/sos/delete-emergency-contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ contactId: deleteId }),
      });

      const result = await res.json();

      if (!res.ok) {
        toast.danger(result.error || "Failed to remove contact.");
        return;
      }

      setContacts(prev => prev.filter(c => c.id !== deleteId));
      setDeleteId(null);
      toast.success("Contact removed.");
    } catch {
      toast.danger("Failed to remove contact.");
    } finally {
      setDeleting(false);
    }
  };

  const handleCloseModal = () => {
    setShowAddModal(false); setSearchQuery(""); setSearchResults([]);
    setSelectedUser(null); setRelationship(""); setError(""); setShowNotOnPeja(false);
  };

  const handleShare = async () => {
    const text = "Join Peja - Stay safe with real-time incident alerts!";
    const url = "https://peja.life";
    if (navigator.share) {
      try { await navigator.share({ title: "Peja", text, url }); } catch {}
    } else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast.success("Link copied!");
    }
  };

  const statusBadge = (status: string) => {
    if (status === "accepted") return (
      <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3.5 h-3.5" />Accepted</span>
    );
    if (status === "pending") return (
      <span className="flex items-center gap-1 text-xs text-yellow-400"><Clock className="w-3.5 h-3.5" />Pending</span>
    );
    return (
      <span className="flex items-center gap-1 text-xs text-red-400"><XCircle className="w-3.5 h-3.5" />Declined</span>
    );
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen pb-20">
        <header className="fixed top-0 left-0 right-0 z-50 glass-header">
          <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        </header>
        <main className="pt-14 max-w-2xl mx-auto px-4 py-6 space-y-3">
          <Skeleton className="h-16 w-full rounded-2xl" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card flex items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-full shrink-0" />
              <div className="flex-1"><Skeleton className="h-4 w-40 mb-2" /><Skeleton className="h-3 w-24" /></div>
            </div>
          ))}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <header className="fixed top-0 left-0 right-0 z-50 glass-header">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-white/10 rounded-lg"><ArrowLeft className="w-5 h-5 text-dark-200" /></button>
          <h1 className="text-lg font-semibold text-dark-100">Emergency Contacts</h1>
          <div className="w-9" />
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto px-4 py-6">
        <div className="glass-card mb-6 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
          <p className="text-dark-200 text-sm">
            These Peja users will be notified when you trigger an SOS alert. They must accept your invite to receive notifications.
          </p>
</div>

        {/* Safety Check-In */}
        <SafetyCheckIn contacts={contacts} />

        {/* Pending Invites Received */}
        {pendingInvites.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-dark-400 uppercase mb-3">Pending Requests</h3>
            <div className="space-y-3">
              {pendingInvites.map(invite => (
                <div key={invite.id} className="glass-card flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-yellow-600/20 flex items-center justify-center shrink-0 overflow-hidden">
                    {invite.requester?.avatar_url ? (
                      <img src={invite.requester.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-6 h-6 text-yellow-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-dark-100 text-sm">{invite.requester?.full_name || "Unknown"}</p>
                    <p className="text-xs text-dark-500">Wants you as: {invite.relationship}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleRespondToInvite(invite.id, true)}
                      disabled={respondingId === invite.id}
                      className="p-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg transition-colors"
                    >
                      {respondingId === invite.id ?<PejaSpinner className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleRespondToInvite(invite.id, false)}
                      disabled={respondingId === invite.id}
                      className="p-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* My Contacts */}
        <div className="space-y-3 mb-6">
          {contacts.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-dark-600 mx-auto mb-4" />
              <p className="text-dark-400 mb-2">No emergency contacts yet</p>
              <p className="text-sm text-dark-500 mb-4">Add Peja users who should be notified in emergencies</p>
            </div>
          ) : (
            contacts.map(contact => (
              <div key={contact.id} className="glass-card flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0 overflow-hidden">
                  {contact.contact_user?.avatar_url ? (
                    <img src={contact.contact_user.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-6 h-6 text-primary-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-dark-100">{contact.contact_user?.full_name || "Unknown"}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-dark-500">{contact.relationship}</p>
                    {statusBadge(contact.status)}
                  </div>
                </div>
                <button onClick={() => setDeleteId(contact.id)} className="p-2 hover:bg-white/10 rounded-lg text-dark-400 hover:text-red-400">
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))
          )}
        </div>

        {contacts.length < 10 && (
          <Button variant="primary" className="w-full" onClick={() => setShowAddModal(true)} leftIcon={<Plus className="w-4 h-4" />}>
            Add Emergency Contact
          </Button>
        )}
        {contacts.length >= 10 && <p className="text-center text-sm text-dark-500">Maximum 10 contacts reached</p>}
      </main>

      {/* Add Modal */}
      <Modal isOpen={showAddModal} onClose={handleCloseModal} title="Add Emergency Contact" size="lg">
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20"><p className="text-sm text-red-400">{error}</p></div>
          )}

          {!selectedUser ? (
            <div>
              <label className="block text-sm font-medium text-dark-200 mb-1.5">Search for a Peja user</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
                <input ref={searchInputRef} type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Type a name to search..." className="w-full pl-10 pr-4 py-3 glass-input" autoFocus />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded">
                    <X className="w-4 h-4 text-dark-400" />
                  </button>
                )}
              </div>

              {searching && <div className="flex justify-center py-4"><PejaSpinner className="w-5 h-5" /></div>}

              {!searching && searchResults.length > 0 && (
                <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
                  {searchResults.map(r => (
                    <button key={r.id} onClick={() => setSelectedUser(r)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/10 transition-colors text-left">
                      <div className="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0 overflow-hidden">
                        {r.avatar_url ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" /> : <User className="w-5 h-5 text-primary-400" />}
                      </div>
                      <div><p className="font-medium text-dark-100">{r.full_name}</p><p className="text-xs text-dark-500">Peja User</p></div>
                    </button>
                  ))}
                </div>
              )}

              {showNotOnPeja && !searching && (
                <div className="mt-4 p-4 glass-sm rounded-xl text-center">
                  <p className="text-dark-300 mb-3">No users found.</p>
                  <p className="text-sm text-dark-400 mb-4">Your contact must be on Peja to receive SOS alerts.</p>
                  <Button variant="secondary" onClick={handleShare} leftIcon={<Share2 className="w-4 h-4" />}>Share Peja</Button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-dark-200 mb-2">Selected Contact</label>
              <div className="flex items-center gap-3 p-3 glass-sm rounded-xl mb-4">
                <div className="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0 overflow-hidden">
                  {selectedUser.avatar_url ? <img src={selectedUser.avatar_url} alt="" className="w-full h-full object-cover" /> : <User className="w-5 h-5 text-primary-400" />}
                </div>
                <div className="flex-1"><p className="font-medium text-dark-100">{selectedUser.full_name}</p></div>
                <button onClick={() => setSelectedUser(null)} className="p-1 hover:bg-white/10 rounded text-dark-400"><X className="w-4 h-4" /></button>
              </div>

              <label className="block text-sm font-medium text-dark-200 mb-2">Relationship</label>
              <div className="flex flex-wrap gap-2">
                {RELATIONSHIPS.map(rel => (
                  <button key={rel} type="button" onClick={() => setRelationship(rel)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${relationship === rel ? "bg-primary-600 text-white" : "glass-sm text-dark-300 hover:bg-white/10"}`}>
                    {rel}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" className="flex-1" onClick={handleCloseModal}>Cancel</Button>
            <Button variant="primary" className="flex-1" onClick={handleAddContact} isLoading={saving} disabled={!selectedUser || !relationship}>
              Send Invite
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Remove Contact">
        <div className="space-y-4">
          <p className="text-dark-300">Remove this emergency contact? They will no longer receive your SOS alerts. You can re-add them later.</p>
          <div className="flex gap-3 pt-4">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={handleDeleteContact} isLoading={deleting}>Remove</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}