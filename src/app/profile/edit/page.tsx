"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Briefcase, Calendar, User, Phone, Mail, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/Skeleton";

export default function EditProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading, refreshUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Prevent scroll on underlying page
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventScroll = (e: TouchEvent) => {
      // Allow scrolling within the container
      const target = e.target as HTMLElement;
      const isScrollable = container.scrollHeight > container.clientHeight;
      
      if (!isScrollable) {
        e.preventDefault();
      }
    };

    // Prevent touchmove on document body when overlay is open
    const preventBodyScroll = (e: TouchEvent) => {
      if (!container.contains(e.target as Node)) {
        e.preventDefault();
      }
    };

    document.addEventListener('touchmove', preventBodyScroll, { passive: false });
    
    return () => {
      document.removeEventListener('touchmove', preventBodyScroll);
    };
  }, []);

  const [formData, setFormData] = useState({
    full_name: "",
    phone: "",
    occupation: "",
    date_of_birth: "",
    avatar_url: "",
  });
  const [loading, setLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
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
        avatar_url: data.avatar_url || "",
      });
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploadingAvatar(true);
    setError("");

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("media")
        .upload(filePath, file);

      if (uploadError) {
        setError("Failed to upload image");
        setUploadingAvatar(false);
        return;
      }

      const { data: publicUrl } = supabase.storage
        .from("media")
        .getPublicUrl(filePath);

      setFormData({
        ...formData,
        avatar_url: publicUrl.publicUrl,
      });
      
      await supabase
        .from("users")
        .update({ avatar_url: publicUrl.publicUrl })
        .eq("id", user.id);

      await refreshUser();
    } catch (err) {
      setError("Failed to upload image");
    } finally {
      setUploadingAvatar(false);
    }
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
          avatar_url: formData.avatar_url || null,
        })
        .eq("id", user.id);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
      
      await refreshUser();
      setSuccess(true);
      setLoading(false);
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
      <div 
        ref={containerRef}
        className="fixed inset-0 z-50 bg-dark-950 overflow-y-auto overscroll-none"
        style={{ touchAction: 'pan-y' }}
      >
        <header className="fixed top-0 left-0 right-0 z-40 glass-header">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        </header>

        <main className="pt-20 px-4 max-w-2xl mx-auto space-y-4">
          <div className="flex justify-center">
            <Skeleton className="h-24 w-24 rounded-full" />
          </div>

          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-12 w-full rounded-2xl" />
        </main>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 z-50 bg-dark-950 overflow-y-auto overscroll-none"
      style={{ touchAction: 'pan-y' }}
    >
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

            <main className="pt-24 px-4 max-w-2xl mx-auto pb-20">
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

        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-primary-600/20 border-2 border-primary-500/50 flex items-center justify-center overflow-hidden">
              {formData.avatar_url ? (
                <img
                  src={formData.avatar_url}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-12 h-12 text-primary-400" />
              )}
              {uploadingAvatar && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                </div>
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center border-2 border-dark-950"
            >
              <Camera className="w-4 h-4 text-white" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarUpload}
              accept="image/*"
              className="hidden"
            />
          </div>
        </div>

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