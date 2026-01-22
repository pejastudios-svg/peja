"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { Loader2, ArrowLeft, User, MapPin, Trash2, Archive, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PostCard } from "@/components/posts/PostCard";
import { Post } from "@/lib/types";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";

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

export default function AdminUserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.id as string;

  useScrollRestore(`admin:user:${userId}`);

  const [loading, setLoading] = useState(true);
  const [u, setU] = useState<AdminUserFull | null>(null);

  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    const [contacts, setContacts] = useState<AdminEmergencyContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);

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
      console.error("fetchEmergencyContacts error:", e);
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
      console.error("fetchUserPosts error:", e);
      setPosts([]);
    } finally {
      setPostsLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Fetch all data in parallel for speed
        await Promise.all([
          fetchUser(),
          fetchEmergencyContacts(),
          fetchUserPosts()
        ]);
      } catch (e) {
        console.error(e);
        setU(null);
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
    } catch (e) {
      alert("Failed to archive. Refreshing…");
      fetchUserPosts();
    }
  };

  if (loading) {
  return (
    <div className="p-6">
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
      <div className="p-6">
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
    <div className="p-6">
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
            className="w-16 h-16 rounded-full overflow-hidden bg-dark-800 border border-white/10 flex items-center justify-center shrink-0"
          >
            {u.avatar_url ? (
              <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <User className="w-8 h-8 text-dark-400" />
            )}
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

        {u.last_address && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-xs text-dark-500 mb-1 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Last known location
            </p>
            <p className="text-sm text-dark-200">{u.last_address}</p>
            {u.last_location_updated_at && (
              <p className="text-xs text-dark-500 mt-1">
                Updated {formatDistanceToNow(new Date(u.last_location_updated_at), { addSuffix: true })}
              </p>
            )}
          </div>
        )}
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
                <div className="w-11 h-11 rounded-full overflow-hidden bg-dark-800 border border-white/10 shrink-0 flex items-center justify-center">
                  {c.contact_user?.avatar_url ? (
                    <img src={c.contact_user.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-5 h-5 text-dark-400" />
                  )}
                </div>

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

      {/* Posts */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary-400" />
          Posts ({posts.length})
        </h2>
        <Button variant="secondary" size="sm" onClick={fetchUserPosts}>
          Refresh
        </Button>
      </div>

      {postsLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-7 h-7 text-primary-500 animate-spin" />
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
              <PostCard post={p} onConfirm={() => {}} onShare={() => {}} sourceKey={`admin:user:${userId}`} />

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

      <ImageLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        imageUrl={lightboxUrl}
        caption={u.full_name || null}
      />
    </div>
  );
}