"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Calendar, User, Phone, Mail, Camera, Loader2, Home, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/Skeleton";
import { Header } from "@/components/layout/Header";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { REQUIRED_PROFILE_FIELDS } from "@/lib/profileComplete";

type FormState = {
  full_name: string;
  phone: string;
  occupation: string;
  date_of_birth: string;
  avatar_url: string;
  home_address: string;
};

type DraftState = {
  data: FormState;
  touchedFields: Partial<Record<keyof FormState, true>>;
};

const profileEditDraftKey = (userId: string) => `peja-profile-edit-draft-${userId}`;

function readProfileEditDraft(userId: string): DraftState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(profileEditDraftKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FormState> | Partial<DraftState>;
    if (!parsed || typeof parsed !== "object") return null;
    const source = ("data" in parsed && parsed.data ? parsed.data : parsed) as Partial<FormState>;
    return {
      data: {
        full_name: source.full_name ?? "",
        phone: source.phone ?? "",
        occupation: source.occupation ?? "",
        date_of_birth: source.date_of_birth ?? "",
        avatar_url: source.avatar_url ?? "",
        home_address: source.home_address ?? "",
      },
      // Legacy drafts had no touched metadata; treat them as stale snapshots.
      touchedFields: ("touchedFields" in parsed && parsed.touchedFields
        ? parsed.touchedFields
        : {}) as DraftState["touchedFields"],
    };
  } catch {
    return null;
  }
}

function writeProfileEditDraft(
  userId: string,
  data: FormState,
  touchedFields: Partial<Record<keyof FormState, true>> = {}
) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(profileEditDraftKey(userId), JSON.stringify({ data, touchedFields }));
  } catch {}
}

function clearProfileEditDraft(userId: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(profileEditDraftKey(userId));
  } catch {}
}

function countFilledFields(data: FormState): number {
  return REQUIRED_PROFILE_FIELDS.filter(
    (f) => typeof (data as any)[f.key] === "string" && (data as any)[f.key].trim() !== ""
  ).length;
}

/** Prefer touched draft values, including intentional blanks; fall back to DB for untouched fields. */
function mergeFormWithDraft(db: FormState, draft: DraftState): FormState {
  return {
    full_name: draft.touchedFields.full_name ? draft.data.full_name : db.full_name,
    phone: draft.touchedFields.phone ? draft.data.phone : db.phone,
    occupation: draft.touchedFields.occupation ? draft.data.occupation : db.occupation,
    date_of_birth: draft.touchedFields.date_of_birth ? draft.data.date_of_birth : db.date_of_birth,
    avatar_url: draft.touchedFields.avatar_url ? draft.data.avatar_url : db.avatar_url,
    home_address: draft.touchedFields.home_address ? draft.data.home_address : db.home_address,
  };
}

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

  // formData stays null until the DB fetch resolves. The form (and Save
  // button) are gated on `formData != null`, so the user can never click
  // Save with a partially-seeded state and wipe fields that hadn't loaded
  // yet. The earlier dual-effect approach raced the save and silently
  // blanked unseeded fields on submit.
  const [formData, setFormData] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  // Switches to true if the avatar <img> fires onError (offline / 404 /
  // broken CDN). Resets whenever shownAvatarUrl changes — see effect
  // below. Keeps the User-icon fallback from being suppressed by a
  // truthy-but-broken URL.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  // Hydrate the form once per user id. Auth refreshes/realtime updates replace the
  // `user` object frequently — re-seeding on every change wiped in-progress edits.
  const hydratedUserIdRef = useRef<string | null>(null);
  const touchedFieldsRef = useRef<Partial<Record<keyof FormState, true>>>({});

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [avatarPreviewUrl]);

  // Allow a fresh DB load next time this screen opens (overlay may stay mounted).
  useEffect(() => {
    return () => {
      hydratedUserIdRef.current = null;
    };
  }, []);

  // Single source of truth: once auth is settled, fetch the row from Supabase and
  // seed the form. Only runs once per user id so background auth/profile refreshes
  // do not overwrite fields the user is actively typing into.
  useEffect(() => {
    if (!user?.id) {
      hydratedUserIdRef.current = null;
      return;
    }

    if (hydratedUserIdRef.current === user.id) return;

    const savedDraft = readProfileEditDraft(user.id);

    let cancelled = false;
    setFormData(null);

    (async () => {
      const fromAuth = (): FormState => ({
        full_name: user.full_name || "",
        phone: user.phone || "",
        occupation: user.occupation || "",
        date_of_birth: user.date_of_birth || "",
        avatar_url: user.avatar_url || "",
        home_address: user.home_address || "",
      });
      try {
        const { data } = await supabase
          .from("users")
          .select("full_name, phone, occupation, date_of_birth, avatar_url, home_address")
          .eq("id", user.id)
          .single();
        if (cancelled) return;
        const src = data ?? user;
        const fromDb: FormState = {
          full_name: src.full_name || "",
          phone: src.phone || "",
          occupation: src.occupation || "",
          date_of_birth: src.date_of_birth || "",
          avatar_url: src.avatar_url || "",
          home_address: src.home_address || "",
        };
        const next = savedDraft ? mergeFormWithDraft(fromDb, savedDraft) : fromDb;
        setFormData(next);
        touchedFieldsRef.current = savedDraft?.touchedFields ?? {};
        // Drop stale drafts (e.g. only avatar after picker) so mobile doesn't stick at 1/6.
        if (savedDraft && countFilledFields(savedDraft.data) < countFilledFields(fromDb)) {
          clearProfileEditDraft(user.id);
          touchedFieldsRef.current = {};
          writeProfileEditDraft(user.id, next, touchedFieldsRef.current);
        }
        hydratedUserIdRef.current = user.id;
      } catch {
        if (!cancelled) {
          const fromDb = fromAuth();
          const next = savedDraft ? mergeFormWithDraft(fromDb, savedDraft) : fromDb;
          setFormData(next);
          touchedFieldsRef.current = savedDraft?.touchedFields ?? {};
          hydratedUserIdRef.current = user.id;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Persist in-progress edits so avatar picker / app backgrounding can't wipe them.
  useEffect(() => {
    if (!user?.id || !formData) return;
    writeProfileEditDraft(user.id, formData, touchedFieldsRef.current);
  }, [formData, user?.id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const fieldName = e.target.name as keyof FormState;
    const value = e.target.value;
    touchedFieldsRef.current = { ...touchedFieldsRef.current, [fieldName]: true };
    setFormData((prev) => (prev ? { ...prev, [fieldName]: value } : prev));
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const localPreview = URL.createObjectURL(file);
    setAvatarPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return localPreview;
    });
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

      setFormData((prev) => {
        if (!prev) return prev;
        const next = { ...prev, avatar_url: publicUrl.publicUrl };
        touchedFieldsRef.current = { ...touchedFieldsRef.current, avatar_url: true };
        writeProfileEditDraft(user.id, next, touchedFieldsRef.current);
        return next;
      });

      await supabase
        .from("users")
        .update({ avatar_url: publicUrl.publicUrl })
        .eq("id", user.id);

      // Do not refreshUser() here — it can remount/rehydrate the form and wipe
      // unsaved text fields. Avatar is already in local form state + draft.
    } catch (err) {
      setAvatarPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
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

    if (!user || !formData) {
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
          home_address: formData.home_address.trim() || null,
        })
        .eq("id", user.id);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      // Drop any cached SW response for the users table so the next read
      // returns the fresh row instead of the pre-save snapshot. Without this,
      // a stale SW (v7 SWR cache) would force the user to save twice.
      try {
        if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: "invalidate-data",
            urlContains: "/rest/v1/users",
          });
        }
      } catch {}

      clearProfileEditDraft(user.id);
      touchedFieldsRef.current = {};
      hydratedUserIdRef.current = null;
      setAvatarPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      await refreshUser();
      setSuccess(true);
      setLoading(false);
      setTimeout(() => {
        // Close overlay / return to profile instead of stacking another /profile route
        if (window.history.length > 1) {
          router.back();
        } else {
          router.replace("/profile");
        }
      }, 800);
    } catch (err) {
      setError("Failed to update profile");
      setLoading(false);
    }
  };

  // Skeleton until auth is settled AND the DB row is loaded. Form (and Save
  // button) below this point can safely assume formData is non-null.
  if (authLoading || !formData) {
    return (
      <div
        ref={containerRef}
        className="fixed inset-0 z-50 overflow-y-auto overscroll-none"
        style={{ touchAction: "pan-y", background: "var(--page-bg)" }}
      >
        <Header variant="back" title="Edit Profile" onBack={() => router.back()} />

        <main className="pt-app-header-pill px-4 max-w-2xl mx-auto space-y-4">
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

  const shownAvatarUrl = avatarPreviewUrl || formData.avatar_url;

  // Clear the "load failed" flag whenever the URL changes so a fresh
  // upload after a previous failure isn't permanently suppressed.
  useEffect(() => {
    setAvatarFailed(false);
  }, [shownAvatarUrl]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 overflow-y-auto overscroll-none"
      style={{ touchAction: "pan-y", background: "var(--page-bg)" }}
    >
      <Header variant="back" title="Edit Profile" onBack={() => router.back()} />

      <main className="pt-app-header-pill px-4 max-w-2xl mx-auto pb-20">
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

        {/* Live profile-completion checklist. Reads from formData so it reacts
            as the user types — once everything is ticked, the in-app gates
            (post, comment, become-guardian) unlock as soon as they save. */}
        {(() => {
          const filled = REQUIRED_PROFILE_FIELDS.filter(
            (f) => typeof (formData as any)[f.key] === "string" && (formData as any)[f.key].trim() !== ""
          );
          const total = REQUIRED_PROFILE_FIELDS.length;
          const done = filled.length;
          const pct = Math.round((done / total) * 100);
          const allDone = done === total;

          return (
            <div
              className="mb-6 p-4 rounded-2xl"
              style={{
                background: "var(--glass-input-bg)",
                border: `1px solid ${allDone ? "rgba(34, 197, 94, 0.35)" : "var(--glass-border)"}`,
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-dark-100">
                  {allDone ? "Profile complete" : "Complete your profile"}
                </p>
                <span className={`text-xs font-medium ${allDone ? "text-green-400" : "text-dark-400"}`}>
                  {done}/{total}
                </span>
              </div>

              <div className="h-1.5 rounded-full bg-dark-700 overflow-hidden mb-3">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    background: allDone ? "#22c55e" : "#7c3aed",
                  }}
                />
              </div>

              <ul className="space-y-1.5">
                {REQUIRED_PROFILE_FIELDS.map((f) => {
                  const isFilled = typeof (formData as any)[f.key] === "string"
                    && (formData as any)[f.key].trim() !== "";
                  return (
                    <li
                      key={f.key}
                      className={`flex items-center gap-2 text-sm ${isFilled ? "text-dark-300" : "text-dark-200"}`}
                    >
                      {isFilled ? (
                        <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-dark-500 shrink-0" />
                      )}
                      <span className={isFilled ? "line-through text-dark-500" : ""}>
                        {f.label}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {!allDone && (
                <p className="mt-3 text-[11px] text-dark-500 leading-relaxed">
                  Posting, commenting, and the Guardian application unlock once everything is filled in.
                  Safety features (SOS, alerts, Check-In) stay on regardless.
                </p>
              )}
            </div>
          );
        })()}

        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-primary-600/20 border-2 border-primary-500/50 flex items-center justify-center overflow-hidden">
              {shownAvatarUrl && !avatarFailed ? (
                <img
                  src={shownAvatarUrl}
                  alt="Profile"
                  className="w-full h-full object-cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <User className="w-12 h-12 text-primary-400" />
              )}
              {uploadingAvatar && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <PejaSpinner className="w-6 h-6" />
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

            <div>
              <Input
                type="text"
                name="home_address"
                label="Home Address"
                placeholder="Street, area, city, state"
                value={formData.home_address}
                onChange={handleChange}
                leftIcon={<Home className="w-4 h-4" />}
              />
              <p className="mt-1.5 text-[11px] text-dark-500">
                Only visible to you and Peja admins. Used so support can help locate you in an emergency.
              </p>
            </div>
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