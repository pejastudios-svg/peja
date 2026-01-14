"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/Skeleton";
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
  X,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface EmergencyContact {
  id: string;
  contact_user_id: string;
  relationship: string;
  created_at: string;
  contact_user?: {
    id: string;
    full_name: string;
    avatar_url?: string;
    phone?: string;
  };
}

interface SearchUser {
  id: string;
  full_name: string;
  avatar_url?: string;
}

const RELATIONSHIPS = [
  "Parent",
  "Spouse",
  "Sibling",
  "Child",
  "Friend",
  "Colleague",
  "Neighbor",
  "Other",
];

export default function EmergencyContactsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);
  const [relationship, setRelationship] = useState("");
  const [error, setError] = useState("");
  const [showNotOnPeja, setShowNotOnPeja] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      fetchContacts();
    }
  }, [user]);

  // Search for users when query changes
  useEffect(() => {
    const searchUsers = async () => {
      if (searchQuery.length < 2) {
        setSearchResults([]);
        setShowNotOnPeja(false);
        return;
      }

      setSearching(true);
      try {
        const { data, error } = await supabase
          .from("users")
          .select("id, full_name, avatar_url")
          .neq("id", user?.id)
          .ilike("full_name", `%${searchQuery}%`)
          .limit(10);

        if (error) throw error;

        if (data && data.length > 0) {
          setSearchResults(data);
          setShowNotOnPeja(false);
        } else {
          setSearchResults([]);
          setShowNotOnPeja(true);
        }
      } catch (error) {
        console.error("Search error:", error);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    };

    const debounce = setTimeout(searchUsers, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, user?.id]);

  const fetchContacts = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("emergency_contacts")
        .select(`
          id,
          contact_user_id,
          relationship,
          created_at
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Fetch user details for each contact
      if (data && data.length > 0) {
        const contactUserIds = data.map(c => c.contact_user_id);
        const { data: usersData } = await supabase
          .from("users")
          .select("id, full_name, avatar_url, phone")
          .in("id", contactUserIds);

        const usersMap: Record<string, any> = {};
        if (usersData) {
          usersData.forEach(u => {
            usersMap[u.id] = u;
          });
        }

        const contactsWithUsers = data.map(c => ({
          ...c,
          contact_user: usersMap[c.contact_user_id] || null,
        }));

        setContacts(contactsWithUsers);
      } else {
        setContacts([]);
      }
    } catch (error) {
      console.error("Error fetching contacts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddContact = async () => {
    if (!selectedUser) {
      setError("Please select a user");
      return;
    }
    if (!relationship) {
      setError("Please select a relationship");
      return;
    }
    if (contacts.length >= 5) {
      setError("Maximum 5 emergency contacts allowed");
      return;
    }

    // Check if already added
    if (contacts.some(c => c.contact_user_id === selectedUser.id)) {
      setError("This person is already in your emergency contacts");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const { data, error } = await supabase
        .from("emergency_contacts")
        .insert({
          user_id: user?.id,
          contact_user_id: selectedUser.id,
          relationship,
        })
        .select()
        .single();

      if (error) throw error;

      // Add the new contact with user details
      const newContact: EmergencyContact = {
        ...data,
        contact_user: selectedUser,
      };

      setContacts((prev) => [...prev, newContact]);
      handleCloseModal();
    } catch (error) {
      console.error("Error adding contact:", error);
      setError("Failed to add contact. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteContact = async () => {
    if (!deleteId) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from("emergency_contacts")
        .delete()
        .eq("id", deleteId);

      if (error) throw error;

      setContacts((prev) => prev.filter((c) => c.id !== deleteId));
      setDeleteId(null);
    } catch (error) {
      console.error("Error deleting contact:", error);
    } finally {
      setDeleting(false);
    }
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setSearchQuery("");
    setSearchResults([]);
    setSelectedUser(null);
    setRelationship("");
    setError("");
    setShowNotOnPeja(false);
  };

  const handleShare = async () => {
    const shareText = "Join Peja - Stay safe with real-time incident alerts in your area!";
    const shareUrl = "https://peja.ng"; // Your app URL

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Peja - Community Safety",
          text: shareText,
          url: shareUrl,
        });
      } catch (e) {
        // User cancelled
      }
    } else {
      await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      alert("Link copied! Share it with your contact.");
    }
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
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="glass-card flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-full shrink-0" />
            <div className="flex-1">
              <Skeleton className="h-4 w-40 mb-2" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        ))}
        <Skeleton className="h-12 w-full rounded-2xl" />
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
          <h1 className="text-lg font-semibold text-dark-100">Emergency Contacts</h1>
          <div className="w-9" />
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto px-4 py-6">
        {/* Info Card */}
        <div className="glass-card mb-6 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-dark-200 text-sm">
              These Peja users will be notified when you trigger an SOS alert.
              They must be registered on Peja to receive notifications.
            </p>
          </div>
        </div>

        {/* Contacts List */}
        <div className="space-y-3 mb-6">
          {contacts.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-dark-600 mx-auto mb-4" />
              <p className="text-dark-400 mb-2">No emergency contacts yet</p>
              <p className="text-sm text-dark-500 mb-4">
                Add Peja users who should be notified in emergencies
              </p>
            </div>
          ) : (
            contacts.map((contact) => (
              <div
                key={contact.id}
                className="glass-card flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0 overflow-hidden">
                  {contact.contact_user?.avatar_url ? (
                    <img 
                      src={contact.contact_user.avatar_url} 
                      alt="" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-6 h-6 text-primary-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-dark-100">
                      {contact.contact_user?.full_name || "Unknown User"}
                    </p>
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  </div>
                  <p className="text-xs text-dark-500">{contact.relationship}</p>
                </div>
                <button
                  onClick={() => setDeleteId(contact.id)}
                  className="p-2 hover:bg-white/10 rounded-lg text-dark-400 hover:text-red-400"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add Button */}
        {contacts.length < 5 && (
          <Button
            variant="primary"
            className="w-full"
            onClick={() => setShowAddModal(true)}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            Add Emergency Contact
          </Button>
        )}

        {contacts.length >= 5 && (
          <p className="text-center text-sm text-dark-500">
            Maximum 5 contacts reached
          </p>
        )}
      </main>

      {/* Add Contact Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={handleCloseModal}
        title="Add Emergency Contact"
        size="lg"
      >
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Search Input */}
          {!selectedUser ? (
            <div>
              <label className="block text-sm font-medium text-dark-200 mb-1.5">
                Search for a Peja user
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Type a name to search..."
                  className="w-full pl-10 pr-4 py-3 glass-input"
                  autoFocus
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded"
                  >
                    <X className="w-4 h-4 text-dark-400" />
                  </button>
                )}
              </div>

              {/* Search Results */}
              {searching && (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                </div>
              )}

              {!searching && searchResults.length > 0 && (
                <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
                  {searchResults.map((resultUser) => (
                    <button
                      key={resultUser.id}
                      onClick={() => setSelectedUser(resultUser)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/10 transition-colors text-left"
                    >
                      <div className="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0 overflow-hidden">
                        {resultUser.avatar_url ? (
                          <img src={resultUser.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-5 h-5 text-primary-400" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-dark-100">{resultUser.full_name}</p>
                        <p className="text-xs text-dark-500">Peja User</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Not on Peja Message */}
              {showNotOnPeja && !searching && (
                <div className="mt-4 p-4 glass-sm rounded-xl text-center">
                  <p className="text-dark-300 mb-3">
                    No users found with that name.
                  </p>
                  <p className="text-sm text-dark-400 mb-4">
                    Your contact must be registered on Peja to receive SOS alerts.
                    Share Peja with them!
                  </p>
                  <Button
                    variant="secondary"
                    onClick={handleShare}
                    leftIcon={<Share2 className="w-4 h-4" />}
                  >
                    Share Peja
                  </Button>
                </div>
              )}

              {!searching && searchQuery.length > 0 && searchQuery.length < 2 && (
                <p className="text-xs text-dark-500 mt-2">
                  Type at least 2 characters to search
                </p>
              )}
            </div>
          ) : (
            // Selected User & Relationship
            <div>
              <label className="block text-sm font-medium text-dark-200 mb-2">
                Selected Contact
              </label>
              <div className="flex items-center gap-3 p-3 glass-sm rounded-xl mb-4">
                <div className="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0 overflow-hidden">
                  {selectedUser.avatar_url ? (
                    <img src={selectedUser.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-5 h-5 text-primary-400" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-dark-100">{selectedUser.full_name}</p>
                </div>
                <button
                  onClick={() => setSelectedUser(null)}
                  className="p-1 hover:bg-white/10 rounded text-dark-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <label className="block text-sm font-medium text-dark-200 mb-2">
                Relationship
              </label>
              <div className="flex flex-wrap gap-2">
                {RELATIONSHIPS.map((rel) => (
                  <button
                    key={rel}
                    type="button"
                    onClick={() => setRelationship(rel)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      relationship === rel
                        ? "bg-primary-600 text-white"
                        : "glass-sm text-dark-300 hover:bg-white/10"
                    }`}
                  >
                    {rel}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={handleCloseModal}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleAddContact}
              isLoading={saving}
              disabled={!selectedUser || !relationship}
            >
              Add Contact
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Remove Contact"
      >
        <div className="space-y-4">
          <p className="text-dark-300">
            Are you sure you want to remove this emergency contact?
          </p>

          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setDeleteId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleDeleteContact}
              isLoading={deleting}
            >
              Remove
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}