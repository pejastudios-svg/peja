"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Phone,
  User,
  Users,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string;
  is_verified: boolean;
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

  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [error, setError] = useState("");

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

  const fetchContacts = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("emergency_contacts")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setContacts(data || []);
    } catch (error) {
      console.error("Error fetching contacts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddContact = async () => {
    if (!name.trim()) {
      setError("Please enter a name");
      return;
    }
    if (!phone.trim()) {
      setError("Please enter a phone number");
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

    setSaving(true);
    setError("");

    try {
      const { data, error } = await supabase
        .from("emergency_contacts")
        .insert({
          user_id: user?.id,
          name: name.trim(),
          phone: phone.trim(),
          relationship,
          is_verified: false,
        })
        .select()
        .single();

      if (error) throw error;

      setContacts((prev) => [...prev, data]);
      setShowAddModal(false);
      setName("");
      setPhone("");
      setRelationship("");
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

  if (authLoading || loading) {
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
          <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-dark-200 text-sm">
              These contacts will be notified via SMS when you trigger an SOS alert.
              You can add up to 5 emergency contacts.
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
                Add contacts who should be notified in emergencies
              </p>
            </div>
          ) : (
            contacts.map((contact) => (
              <div
                key={contact.id}
                className="glass-card flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-full bg-primary-600/20 flex items-center justify-center flex-shrink-0">
                  <User className="w-6 h-6 text-primary-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-dark-100">{contact.name}</p>
                    {contact.is_verified && (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    )}
                  </div>
                  <p className="text-sm text-dark-400">{contact.phone}</p>
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
        onClose={() => {
          setShowAddModal(false);
          setError("");
        }}
        title="Add Emergency Contact"
      >
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <Input
            label="Name"
            placeholder="Contact's full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            leftIcon={<User className="w-4 h-4" />}
          />

          <Input
            label="Phone Number"
            type="tel"
            placeholder="+234 800 000 0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            leftIcon={<Phone className="w-4 h-4" />}
          />

          <div>
            <label className="block text-sm font-medium text-dark-200 mb-1.5">
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

          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setShowAddModal(false);
                setError("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleAddContact}
              isLoading={saving}
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