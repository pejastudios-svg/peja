"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { usePageCache } from "@/context/PageCacheContext";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { Loader2, ArrowLeft, User, MapPin, Trash2, Archive, FileText, Radio, Eye, EyeOff, KeyRound, Copy, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PostCard } from "@/components/posts/PostCard";
import { Post } from "@/lib/types";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

type AdminUserFull = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  occupation: string | null;
  status: string | null;
  is_guardian: boolean | null;
  is_admin: boolean | null;
  avatar_url: string | null;
  last_address: string | null;
  last_latitude: number | null;
  last_longitude: number | null;
  last_location_updated_at: string | null;
  created_at: string | null;
};

type AdminEmergencyContact = {
  id: string;
  relationship: string | null;
  created_at: string | null;
  contact_user: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
  } | null;
};

type BeaconPerson = { id: string; name: string; grantedAt?: string | null; via?: "grant" | "contact" };

type AdminBeacon = {
  id: string;
  deviceId: string;
  name: string;
  wearerName: string | null;
  wearerColor: string | null;
  status: string;
  batteryPct: number | null;
  lat: number | null;
  lng: number | null;
  lastFixAt: string | null;
  lastSeenAt: string | null;
  sosActive: boolean;
  shareWithContacts: boolean;
  fallAlertEnabled: boolean;
  firmware: string | null;
  simLast4: string | null;
  pairedAt: string | null;
  canSee: BeaconPerson[];
  hiddenFrom: BeaconPerson[];
};

type SharedBeacon = Omit<AdminBeacon, "canSee" | "hiddenFrom"> & {
  ownerId: string;
  ownerName: string;
  ownerAvatar: string | null;
  grantedAt: string | null;
};

/** How long a revealed SIM number stays on screen before hiding itself. */
const SIM_REVEAL_MS = 60_000;

export default function AdminUserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.id as string;

  useScrollRestore(`admin:user:${userId}`);

const pageCache = usePageCache();
  const cachedData = pageCache.get<{ user: AdminUserFull; posts: Post[]; contacts: AdminEmergencyContact[] }>(`admin:user:${userId}`);

  const [loading, setLoading] = useState(cachedData === null);
  const [u, setU] = useState<AdminUserFull | null>(cachedData?.user || null);

  const [posts, setPosts] = useState<Post[]>(cachedData?.posts || []);
  const [postsLoading, setPostsLoading] = useState(cachedData === null);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

const [contacts, setContacts] = useState<AdminEmergencyContact[]>(cachedData?.contacts || []);
  const [contactsLoading, setContactsLoading] = useState(cachedData === null);

  // SIM reveal. The number is the Beacon's control channel, not contact
  // info: /api/beacon/sms texts commands to it and the device's own
  // authorisation code is the factory default, so holding the number is
  // enough to repoint someone's SOS call. Hidden until the admin PIN is
  // re-entered, and only for the device asked about.
  const [revealTarget, setRevealTarget] = useState<AdminBeacon | null>(null);
  const [revealPin, setRevealPin] = useState("");
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealedSims, setRevealedSims] = useState<Record<string, { sim: string; expiresAt: number }>>({});
  const [copiedSim, setCopiedSim] = useState<string | null>(null);
  // Drives the countdown and the automatic hide. Only ticks while
  // something is actually revealed.
  const [revealTick, setRevealTick] = useState(0);

  useEffect(() => {
    if (Object.keys(revealedSims).length === 0) return;
    const t = setInterval(() => {
      setRevealTick((n) => n + 1);
      setRevealedSims((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(
          Object.entries(prev).filter(([, v]) => v.expiresAt > now),
        );
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [revealedSims]);

  const submitReveal = async () => {
    if (!revealTarget || revealBusy) return;
    setRevealBusy(true);
    setRevealError(null);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired");
      const res = await fetch("/api/admin/user-beacons", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "reveal_sim", deviceId: revealTarget.id, pin: revealPin }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not reveal");
      // A working credential should not sit on screen indefinitely.
      setRevealedSims((prev) => ({
        ...prev,
        [revealTarget.id]: { sim: json.sim, expiresAt: Date.now() + SIM_REVEAL_MS },
      }));
      setRevealTarget(null);
      setRevealPin("");
    } catch (e) {
      setRevealError((e as Error).message);
    } finally {
      setRevealBusy(false);
    }
  };

  // Admin-issued temporary password. The last door for someone with no
  // recovery codes and fewer than two accepted contacts, who is therefore
  // locked out with no automated way back in.
  //
  // The password it produces is shown to the ADMIN only, to be sent to the
  // address already on the account. It is never handed to whoever asked,
  // which is what makes an open request form safe: a stranger filing a
  // reset for someone else's email just causes that owner to be emailed
  // and pushed a warning.
  const [pwResetOpen, setPwResetOpen] = useState(false);
  const [pwResetPin, setPwResetPin] = useState("");
  const [pwResetBusy, setPwResetBusy] = useState(false);
  const [pwResetError, setPwResetError] = useState<string | null>(null);
  const [pwResetResult, setPwResetResult] = useState<
    { tempPassword: string; email: string; emailText: string } | null
  >(null);
  const [pwCopied, setPwCopied] = useState<"password" | "email" | null>(null);
  // Blocks Done until the password has actually left this screen. It is
  // shown exactly once: Supabase hashes it the moment it is set, so if this
  // dialog closes before you copy, the only way back is resetting again.
  // Mirrors the recovery-codes sheet, for the same reason.
  const [pwSaved, setPwSaved] = useState(false);

  const closePwReset = () => {
    // Refuse to close over a password nobody has taken a copy of.
    if (pwResetResult && !pwSaved) return;
    setPwResetOpen(false);
    setPwResetPin("");
    setPwResetError(null);
    setPwResetResult(null);
    setPwCopied(null);
    setPwSaved(false);
  };

  const submitPasswordReset = async () => {
    if (pwResetBusy || !u) return;
    setPwResetBusy(true);
    setPwResetError(null);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired");
      const res = await fetch("/api/admin/reset-user-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: u.id, pin: pwResetPin }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not reset the password");
      setPwResetResult({
        tempPassword: json.tempPassword,
        email: json.email,
        emailText: json.emailText,
      });
      setPwResetPin("");
    } catch (e) {
      setPwResetError((e as Error).message);
    } finally {
      setPwResetBusy(false);
    }
  };

  const copyPw = async (what: "password" | "email") => {
    if (!pwResetResult) return;
    try {
      await navigator.clipboard.writeText(
        what === "password" ? pwResetResult.tempPassword : pwResetResult.emailText,
      );
      setPwCopied(what);
      setPwSaved(true);
      setTimeout(() => setPwCopied(null), 2000);
    } catch {
      // Clipboard writes fail in plenty of ordinary situations. Without an
      // escape the dialog would be a dead end, so offer one rather than
      // trapping someone behind a button that cannot succeed.
      setPwResetError(
        "Could not copy. Select the password above and copy it by hand, then confirm below.",
      );
    }
  };

  const [ownedBeacons, setOwnedBeacons] = useState<AdminBeacon[]>([]);
  const [sharedBeacons, setSharedBeacons] = useState<SharedBeacon[]>([]);
  const [beaconsLoading, setBeaconsLoading] = useState(true);

  // Beacons attached to this account, both directions: devices this user
  // owns (and who is allowed to watch each one) and devices someone else
  // owns that this user has been granted sight of.
  const fetchBeacons = async () => {
    setBeaconsLoading(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired");
      const res = await fetch(`/api/admin/user-beacons?userId=${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load beacons");
      setOwnedBeacons((json.owned || []) as AdminBeacon[]);
      setSharedBeacons((json.visible || []) as SharedBeacon[]);
    } catch {
      setOwnedBeacons([]);
      setSharedBeacons([]);
    } finally {
      setBeaconsLoading(false);
    }
  };

  const fetchEmergencyContacts = async () => {
    setContactsLoading(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired");

      const res = await fetch("/api/admin/user-emergency-contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed to load contacts");

      setContacts((json.contacts || []) as AdminEmergencyContact[]);
    } catch (e) {
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  };

  const fetchUser = async () => {
    const { data, error } = await supabase
      .from("users")
      .select(
        "id,full_name,email,phone,occupation,status,is_guardian,is_admin,avatar_url,last_address,last_latitude,last_longitude,last_location_updated_at,created_at"
      )
      .eq("id", userId)
      .single();

    if (error) throw error;
    setU(data as any);
  };

  const fetchUserPosts = async () => {
    setPostsLoading(true);
    try {
      // posts
      const { data: postsData, error } = await supabase
        .from("posts")
        .select(
          "id,user_id,category,comment,address,latitude,longitude,is_anonymous,status,is_sensitive,confirmations,views,comment_count,report_count,created_at"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const rows = (postsData || []) as any[];
      const postIds = rows.map((p) => p.id);

      // media
      const { data: mediaData } = postIds.length
        ? await supabase
            .from("post_media")
            .select("id,post_id,url,media_type,is_sensitive,thumbnail_url")
            .in("post_id", postIds)
        : { data: [] };

      const mediaMap: Record<string, any[]> = {};
      (mediaData || []).forEach((m: any) => {
        if (!mediaMap[m.post_id]) mediaMap[m.post_id] = [];
        mediaMap[m.post_id].push(m);
      });

      // tags
      const { data: tagsData } = postIds.length
        ? await supabase.from("post_tags").select("post_id,tag").in("post_id", postIds)
        : { data: [] };

      const tagsMap: Record<string, string[]> = {};
      (tagsData || []).forEach((t: any) => {
        if (!tagsMap[t.post_id]) tagsMap[t.post_id] = [];
        tagsMap[t.post_id].push(t.tag);
      });

      const formatted: Post[] = rows.map((p: any) => ({
        id: p.id,
        user_id: p.user_id,
        category: p.category,
        comment: p.comment,
        location: {
          latitude: p.latitude ?? 0,
          longitude: p.longitude ?? 0,
        },
        address: p.address,
        is_anonymous: p.is_anonymous,
        status: p.status,
        is_sensitive: p.is_sensitive,
        confirmations: p.confirmations || 0,
        views: p.views || 0,
        comment_count: p.comment_count || 0,
        report_count: p.report_count || 0,
        created_at: p.created_at,
        media: (mediaMap[p.id] || []).map((m: any) => ({
          id: m.id,
          post_id: m.post_id,
          url: m.url,
          media_type: m.media_type,
          is_sensitive: m.is_sensitive,
          thumbnail_url: m.thumbnail_url,
        })),
        tags: tagsMap[p.id] || [],
      }));

      setPosts(formatted);
    } catch (e) {
      setPosts([]);
    } finally {
      setPostsLoading(false);
    }
  };

useEffect(() => {
    const load = async () => {
      if (!cachedData) setLoading(true);
      try {
        await Promise.all([
          fetchUser(),
          fetchEmergencyContacts(),
          fetchUserPosts(),
          fetchBeacons()
        ]);
      } catch (e) {
        if (!cachedData) setU(null);
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Live-update the last-known location while an admin has this page open —
  // critical during an active search for someone who can't reach their phone.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`admin-user-loc-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "users", filter: `id=eq.${userId}` },
        (payload) => {
          const n = payload.new as any;
          setU((prev) =>
            prev
              ? {
                  ...prev,
                  last_latitude: n.last_latitude ?? prev.last_latitude,
                  last_longitude: n.last_longitude ?? prev.last_longitude,
                  last_address: n.last_address ?? prev.last_address,
                  last_location_updated_at: n.last_location_updated_at ?? prev.last_location_updated_at,
                }
              : prev
          );
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // Cache user detail for instant revisits
  useEffect(() => {
    if (u && !loading) {
      pageCache.set(`admin:user:${userId}`, { user: u, posts, contacts });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u, posts, contacts, loading]);

  const deletePost = async (postId: string) => {
    // optimistic remove
    setPosts((prev) => prev.filter((p) => p.id !== postId));

    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired");

      const res = await fetch("/api/admin/delete-post", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ postId }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");
    } catch (e) {
      alert("Failed to delete post. Refreshing…");
      fetchUserPosts();
    }
  };

  const archivePost = async (postId: string) => {
    // optimistic
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, status: "archived" } : p)));

    try {
      await supabase.from("posts").update({ status: "archived" }).eq("id", postId);
      // Drop it from every open surface this session (feed, map + incident
      // list, search, watch); realtime covers other devices.
      window.dispatchEvent(new CustomEvent("peja-post-archived", { detail: { postId } }));
    } catch (e) {
      alert("Failed to archive. Refreshing…");
      fetchUserPosts();
    }
  };

  if (loading) {
  return (
    <div className="px-6 pb-6 pt-32">
      <div className="mb-6 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-6 w-40" />
      </div>

      <div className="glass-card mb-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-5 w-40 mb-2" />
            <Skeleton className="h-4 w-56 mb-2" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="text-right">
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card p-4">
            <Skeleton className="h-40 w-full rounded-xl mb-3" />
            <Skeleton className="h-4 w-32 mb-2" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

  if (!u) {
    return (
      <div className="px-6 pb-6 pt-32">
        <Button variant="secondary" onClick={() => router.back()}>
          Back
        </Button>
        <div className="glass-card mt-6 text-center py-10">
          <p className="text-dark-400">User not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-6 pt-32">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 glass-sm rounded-lg hover:bg-white/10"
        >
          <ArrowLeft className="w-5 h-5 text-dark-200" />
        </button>
        <h1 className="text-2xl font-bold text-dark-100">User Details</h1>
      </div>

      {/* User card */}
      <div className="glass-card mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              if (!u.avatar_url) return;
              setLightboxUrl(u.avatar_url);
              setLightboxOpen(true);
            }}
            className="contents"
          >
            <AvatarImage
              src={u.avatar_url}
              wrapperClassName="w-16 h-16 rounded-full overflow-hidden bg-dark-800 border border-white/10 flex items-center justify-center shrink-0"
              fallback={<User className="w-8 h-8 text-dark-400" />}
            />
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-dark-100 truncate">{u.full_name || "Unnamed User"}</p>
            <p className="text-sm text-dark-400 truncate">{u.email || ""}</p>
            {u.phone && <p className="text-sm text-dark-400">{u.phone}</p>}
            {u.occupation && <p className="text-xs text-dark-500 mt-1">{u.occupation}</p>}
          </div>

          <div className="text-right">
            <p className="text-xs text-dark-500">Status</p>
            <p className="text-sm text-dark-200 capitalize">{u.status || "unknown"}</p>
            <p className="text-xs text-dark-500 mt-2">Role</p>
            <p className="text-sm text-dark-200">
              {u.is_admin ? "Admin" : u.is_guardian ? "Guardian" : "User"}
            </p>
          </div>
        </div>

        {/* Show whenever we have coordinates — never hide a known location
            just because reverse-geocoding didn't produce an address. */}
        {(u.last_latitude != null && u.last_longitude != null) || u.last_address ? (
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-xs text-dark-500 mb-1 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Last known location
            </p>
            {u.last_address && (
              <p className="text-sm text-dark-200">{u.last_address}</p>
            )}
            {/* Exact coordinates are the real pinpoint — the address label can
                be coarse where OSM street data is sparse. Always show them. */}
            {u.last_latitude != null && u.last_longitude != null && (
              <p className="text-xs text-dark-300 mt-0.5 font-mono">
                {u.last_latitude.toFixed(6)}, {u.last_longitude.toFixed(6)}
              </p>
            )}
            {u.last_location_updated_at && (
              <p className="text-xs text-dark-500 mt-1">
                Updated {formatDistanceToNow(new Date(u.last_location_updated_at), { addSuffix: true })}
              </p>
            )}
            {u.last_latitude != null && u.last_longitude != null && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${u.last_latitude},${u.last_longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-primary-400 hover:text-primary-300"
              >
                <MapPin className="w-3 h-3" /> Open in Maps
              </a>
            )}
          </div>
        ) : null}
      </div>

      {/* Account access */}
      <div className="glass-card mb-6">
        <h2 className="text-sm font-semibold text-dark-400 uppercase mb-3">Account access</h2>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-dark-100 font-medium">Issue a temporary password</p>
            <p className="text-xs text-dark-400 mt-0.5 leading-relaxed">
              For a user who is locked out with no recovery codes and fewer
              than two accepted contacts. You send it to the address on the
              account, never to whoever asked. Recorded in the admin log.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => setPwResetOpen(true)}
            >
              Reset password
            </Button>
          </div>
        </div>
      </div>

            {/* Emergency Contacts */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2">
          Emergency Contacts ({contacts.length})
        </h2>
        <Button variant="secondary" size="sm" onClick={fetchEmergencyContacts}>
          Refresh
        </Button>
      </div>

      {contactsLoading ? (
        <div className="glass-card text-center py-8">
          <p className="text-dark-400">Loading emergency contacts…</p>
        </div>
      ) : contacts.length === 0 ? (
        <div className="glass-card text-center py-8">
          <p className="text-dark-400">No emergency contacts</p>
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {contacts.map((c) => (
            <div
              key={c.id}
              className="glass-card flex items-center justify-between gap-4 cursor-pointer hover:bg-white/5 transition-colors"
              onClick={() => {
                const cid = c.contact_user?.id;
                if (cid) router.push(`/admin/users/${cid}`);
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <AvatarImage
                  src={c.contact_user?.avatar_url}
                  wrapperClassName="w-11 h-11 rounded-full overflow-hidden bg-dark-800 border border-white/10 shrink-0 flex items-center justify-center"
                  fallbackIconClassName="w-5 h-5"
                />

                <div className="min-w-0">
                  <p className="text-dark-100 font-medium truncate">
                    {c.contact_user?.full_name || "Unknown"}
                  </p>
                  <p className="text-xs text-dark-500 truncate">
                    {c.relationship || "Emergency contact"}
                  </p>
                  <p className="text-xs text-dark-500 truncate">
                    {c.contact_user?.email || ""}{c.contact_user?.phone ? ` • ${c.contact_user.phone}` : ""}
                  </p>
                </div>
              </div>

              <div className="text-xs text-dark-500">View</div>
            </div>
          ))}
        </div>
      )}

      {/* Beacons: what hardware this account carries, and exactly who is
          allowed to watch it. The visibility list is the part that gets
          asked about, so it is spelled out rather than counted. */}
      <div className="mt-8 mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2">
          <Radio className="w-5 h-5 text-dark-200" />
          Beacons ({ownedBeacons.length})
        </h2>
        <Button variant="secondary" size="sm" onClick={fetchBeacons}>
          Refresh
        </Button>
      </div>

      {beaconsLoading ? (
        <div className="glass-card p-4 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full max-w-[260px]" />
        </div>
      ) : ownedBeacons.length === 0 && sharedBeacons.length === 0 ? (
        <div className="glass-card text-center py-10">
          <p className="text-dark-400">No Beacon paired to this account</p>
        </div>
      ) : (
        <div className="space-y-4">
          {ownedBeacons.map((b) => (
            <div key={b.id} className="glass-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      background: b.wearerColor || "#7c3aed",
                      opacity: b.status === "connected" ? 1 : 0.5,
                    }}
                  >
                    <Radio className="w-4 h-4 text-white" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-dark-100 font-semibold truncate">
                      {b.wearerName || b.name}
                      {b.sosActive && <span className="text-red-400 text-sm"> · SOS ACTIVE</span>}
                    </p>
                    <p className="text-dark-400 text-xs font-mono truncate">{b.deviceId}</p>
                  </div>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 uppercase ${
                    b.sosActive
                      ? "bg-red-500/20 text-red-300"
                      : b.status === "connected"
                        ? "bg-green-500/20 text-green-300"
                        : "bg-white/10 text-dark-300"
                  }`}
                >
                  {b.status}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <p className="text-dark-500 text-[10px] uppercase font-bold">Battery</p>
                  <p className="text-dark-200">
                    {b.batteryPct != null ? `${b.batteryPct}%` : "unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-dark-500 text-[10px] uppercase font-bold">Last fix</p>
                  <p className="text-dark-200">
                    {b.lastFixAt
                      ? formatDistanceToNow(new Date(b.lastFixAt), { addSuffix: true })
                      : "never"}
                  </p>
                </div>
                <div>
                  <p className="text-dark-500 text-[10px] uppercase font-bold">Last heard</p>
                  <p className="text-dark-200">
                    {b.lastSeenAt
                      ? formatDistanceToNow(new Date(b.lastSeenAt), { addSuffix: true })
                      : "never"}
                  </p>
                </div>
                <div>
                  <p className="text-dark-500 text-[10px] uppercase font-bold">Paired</p>
                  <p className="text-dark-200">
                    {b.pairedAt
                      ? formatDistanceToNow(new Date(b.pairedAt), { addSuffix: true })
                      : "unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-dark-500 text-[10px] uppercase font-bold">Fall alert</p>
                  <p className="text-dark-200">{b.fallAlertEnabled ? "On" : "Off"}</p>
                </div>
                <div className={revealedSims[b.id] ? "col-span-2" : undefined}>
                  <p className="text-dark-500 text-[10px] uppercase font-bold">SIM</p>
                  {revealedSims[b.id] ? (
                    <div className="mt-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-200 font-mono text-sm break-all flex-1 min-w-0">
                          {revealedSims[b.id].sim}
                        </span>
                        <button
                          onClick={() =>
                            setRevealedSims((prev) => {
                              const next = { ...prev };
                              delete next[b.id];
                              return next;
                            })
                          }
                          className="shrink-0 p-1 rounded-lg text-dark-400 hover:text-white hover:bg-white/10"
                          title="Hide now"
                          aria-label="Hide SIM number"
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <button
                          onClick={async () => {
                            const value = revealedSims[b.id]?.sim;
                            if (!value) return;
                            try {
                              await navigator.clipboard.writeText(value);
                              setCopiedSim(b.id);
                              setTimeout(() => setCopiedSim(null), 2000);
                            } catch {
                              /* clipboard blocked: the number is on screen to read */
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-dark-200 text-[11px] font-semibold active:scale-[0.97] transition-transform"
                        >
                          {copiedSim === b.id ? "Copied" : "Copy"}
                        </button>
                        <a
                          href={`tel:${revealedSims[b.id].sim}`}
                          className="px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[11px] font-semibold active:scale-[0.97] transition-transform"
                        >
                          Call
                        </a>
                        <span className="text-dark-500 text-[10px] ml-auto" aria-hidden={revealTick < 0}>
                          Hides in{" "}
                          {Math.max(
                            0,
                            Math.ceil((revealedSims[b.id].expiresAt - Date.now()) / 1000),
                          )}
                          s
                        </span>
                      </div>
                    </div>
                  ) : b.simLast4 ? (
                    <button
                      onClick={() => {
                        setRevealTarget(b);
                        setRevealPin("");
                        setRevealError(null);
                      }}
                      className="text-dark-200 font-mono underline decoration-dotted underline-offset-2 active:opacity-70"
                    >
                      ending {b.simLast4}
                      <span className="text-dark-500 no-underline"> · reveal</span>
                    </button>
                  ) : (
                    <p className="text-dark-200 font-mono">unknown</p>
                  )}
                </div>
              </div>

              {/* Who can see it. */}
              <div className="mt-3 pt-3 border-t border-white/10">
                <p className="text-dark-500 text-[10px] uppercase font-bold flex items-center gap-1.5 mb-1.5">
                  <Eye className="w-3 h-3" />
                  Who can see this Beacon ({b.canSee.length})
                </p>
                {b.canSee.length === 0 ? (
                  <p className="text-dark-400 text-xs">
                    Nobody but the owner
                    {b.shareWithContacts ? " (sharing is on, but there are no accepted contacts)" : ""}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {b.canSee.map((v) => (
                      <span
                        key={`${b.id}-see-${v.id}`}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-dark-200"
                      >
                        {v.name}
                        <span className="text-dark-500">
                          {v.via === "grant" ? " · granted" : " · contact"}
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                {b.hiddenFrom.length > 0 && (
                  <>
                    <p className="text-dark-500 text-[10px] uppercase font-bold flex items-center gap-1.5 mt-2.5 mb-1.5">
                      <EyeOff className="w-3 h-3" />
                      Blocked from seeing it ({b.hiddenFrom.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {b.hiddenFrom.map((v) => (
                        <span
                          key={`${b.id}-hide-${v.id}`}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-300"
                        >
                          {v.name}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}

          {/* Beacons this user watches but does not own. */}
          {sharedBeacons.length > 0 && (
            <div className="glass-card p-4">
              <p className="text-dark-500 text-[10px] uppercase font-bold mb-2">
                Also watches ({sharedBeacons.length})
              </p>
              <div className="space-y-2">
                {sharedBeacons.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => router.push(`/admin/users/${b.ownerId}`)}
                    className="w-full flex items-center gap-2.5 text-left active:scale-[0.99] transition-transform"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        background: b.sosActive
                          ? "#dc2626"
                          : b.status === "connected"
                            ? "#22c55e"
                            : "#6b7280",
                      }}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-dark-100 text-sm font-medium truncate">
                        {b.wearerName || b.name}
                      </span>
                      <span className="block text-dark-400 text-[11px] truncate">
                        owned by {b.ownerName}
                        {b.grantedAt
                          ? ` · granted ${formatDistanceToNow(new Date(b.grantedAt), { addSuffix: true })}`
                          : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Posts */}
      <div className="mt-8 mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2">
          <FileText className="w-5 h-5 text-dark-200" />
          Posts ({posts.length})
        </h2>
        <Button variant="secondary" size="sm" onClick={fetchUserPosts}>
          Refresh
        </Button>
      </div>

      {postsLoading ? (
        <div className="flex justify-center py-10"><PejaSpinner className="w-7 h-7" />
          
        </div>
      ) : posts.length === 0 ? (
        <div className="glass-card text-center py-10">
          <p className="text-dark-400">No posts</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {posts.map((p) => (
            <div key={p.id} className="glass-card p-4 h-full flex flex-col justify-between">
              {/* Use existing PostCard UI */}
              <PostCard post={p} sourceKey={`admin:user:${userId}`} />

              <div className="mt-3 pt-3 border-t border-white/10 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => archivePost(p.id)}
                  leftIcon={<Archive className="w-4 h-4" />}
                >
                  Archive
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => deletePost(p.id)}
                  leftIcon={<Trash2 className="w-4 h-4" />}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Admin PIN before a SIM number is shown. Same second key the
          election danger zone uses: the session cookie is not enough. */}
      <Modal
        isOpen={!!revealTarget}
        onClose={() => {
          setRevealTarget(null);
          setRevealPin("");
          setRevealError(null);
        }}
        title="Reveal SIM number"
      >
        <div className="space-y-3">
          <p className="text-dark-300 text-sm">
            {revealTarget?.wearerName || revealTarget?.name}
            <span className="text-dark-500"> · ending {revealTarget?.simLast4}</span>
          </p>
          <p className="text-dark-400 text-xs">
            This number controls the device. Anyone who has it can text the Beacon and
            change where its SOS call goes. Revealing it is recorded in the admin log.
          </p>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={revealPin}
            onChange={(e) => setRevealPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitReveal();
            }}
            placeholder="Admin PIN"
            className="w-full px-3 glass-input text-sm placeholder:text-dark-500"
          />
          {revealError && <p className="text-red-400 text-xs">{revealError}</p>}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRevealTarget(null);
                setRevealPin("");
                setRevealError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitReveal}
              disabled={revealBusy || revealPin.trim().length === 0}
            >
              {revealBusy ? "Checking..." : "Reveal"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={pwResetOpen}
        onClose={closePwReset}
        title={pwResetResult ? "Temporary password issued" : "Reset this password"}
      >
        {!pwResetResult ? (
          <div className="space-y-3">
            <p className="text-dark-300 text-sm">
              {u.full_name || "This user"}
              <span className="text-dark-500"> · {u.email}</span>
            </p>
            <p className="text-dark-400 text-xs leading-relaxed">
              This signs them out of nothing and tells them nothing by
              itself. It generates a one-time password, pushes them a
              warning that support reset their account, and blocks the app
              for them until they choose their own. Send it only to the
              address shown above.
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pwResetPin}
              onChange={(e) => setPwResetPin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitPasswordReset();
              }}
              placeholder="Admin PIN"
              className="w-full px-3 glass-input text-sm placeholder:text-dark-500"
            />
            {pwResetError && <p className="text-red-400 text-xs">{pwResetError}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={closePwReset}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={submitPasswordReset}
                disabled={pwResetBusy || pwResetPin.trim().length === 0}
              >
                {pwResetBusy ? "Resetting..." : "Reset password"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
              <p className="text-sm font-semibold text-amber-200">Shown once</p>
              <p className="text-xs text-dark-300 mt-0.5 leading-relaxed">
                Copy it now. Send it to {pwResetResult.email} and nowhere
                else. The user must change it before they can use the app.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
              <p className="font-mono text-xl text-dark-50 tracking-wide select-all">
                {pwResetResult.tempPassword}
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => copyPw("password")}
                leftIcon={
                  pwCopied === "password" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />
                }
              >
                {pwCopied === "password" ? "Copied" : "Copy password"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => copyPw("email")}
                leftIcon={
                  pwCopied === "email" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />
                }
              >
                {pwCopied === "email" ? "Copied" : "Copy email text"}
              </Button>
            </div>

            <details className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
              <summary className="px-3 py-2.5 text-sm text-dark-200 cursor-pointer select-none">
                Preview the email
              </summary>
              <pre className="px-3 pb-3 text-xs text-dark-300 whitespace-pre-wrap font-sans leading-relaxed">
                {pwResetResult.emailText}
              </pre>
            </details>

            {pwResetError && (
              <div className="space-y-2">
                <p className="text-red-400 text-xs">{pwResetError}</p>
                {!pwSaved && (
                  <button
                    onClick={() => setPwSaved(true)}
                    className="text-xs font-medium text-primary-400 hover:text-primary-300"
                  >
                    I have written it down
                  </button>
                )}
              </div>
            )}

            <Button
              size="sm"
              onClick={closePwReset}
              disabled={!pwSaved}
              leftIcon={pwSaved ? <Check className="w-4 h-4" /> : undefined}
            >
              {pwSaved ? "Done" : "Copy the password first"}
            </Button>
          </div>
        )}
      </Modal>

      <ImageLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        imageUrl={lightboxUrl}
        caption={u.full_name || null}
      />
    </div>
  );
}