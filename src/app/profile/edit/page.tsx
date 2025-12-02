"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Briefcase, Calendar, User, Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

export default function EditProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [formData, setFormData] = useState({
    full_name: "",
    phone: "",
    occupation: "",
    date_of_birth: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      setFormData({
        full_name: user.full_name || "",
        phone: user.phone || "",
        occupation: user.occupation || "",
        date_of_birth: "",
      });
      fetchFullProfile();
    }
  }, [user]);

  const fetchFullProfile = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();

    if (data) {
      setFormData({
        full_name: data.full_name || "",
        phone: data.phone || "",
        occupation: data.occupation || "",
        date_of_birth: data.date_of_birth || "",
      });
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setLoading(true);

    if (!user) {
      setError("Not logged in");
      setLoading(false);
      return;
    }

    try {
      const { error: updateError } = await supabase
        .from("users")
        .update({
          full_name: formData.full_name,
          phone: formData.phone,
          occupation: formData.occupation,
          date_of_birth: formData.date_of_birth || null,
        })
        .eq("id", user.id);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/profile");
      }, 1500);
    } catch (err) {
      setError("Failed to update profile");
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen pb-8">
      <header className="fixed top-0 left-0 right-0 z-40 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="font-semibold text-dark-50">Edit Profile</h1>
          <div className="w-9" />
        </div>
      </header>

      <main className="pt-20 px-4 max-w-2xl mx-auto">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <p className="text-sm text-green-400">Profile updated successfully!</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="glass-card">
          <div className="space-y-4">
            <Input
              type="text"
              name="full_name"
              label="Full Name"
              placeholder="Your full name"
              value={formData.full_name}
              onChange={handleChange}
              leftIcon={<User className="w-4 h-4" />}
            />

            <Input
              type="email"
              label="Email"
              value={user.email}
              disabled
              leftIcon={<Mail className="w-4 h-4" />}
            />

            <Input
              type="tel"
              name="phone"
              label="Phone Number"
              placeholder="+234 800 000 0000"
              value={formData.phone}
              onChange={handleChange}
              leftIcon={<Phone className="w-4 h-4" />}
            />

            <Input
              type="text"
              name="occupation"
              label="Occupation"
              placeholder="What do you do?"
              value={formData.occupation}
              onChange={handleChange}
              leftIcon={<Briefcase className="w-4 h-4" />}
            />

            <Input
              type="date"
              name="date_of_birth"
              label="Date of Birth"
              value={formData.date_of_birth}
              onChange={handleChange}
              leftIcon={<Calendar className="w-4 h-4" />}
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full mt-6"
            isLoading={loading}
          >
            Save Changes
          </Button>
        </form>
      </main>
    </div>
  );
}