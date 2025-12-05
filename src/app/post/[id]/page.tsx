"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES, REPORT_REASONS } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { notifyPostComment, notifyCommentLiked } from "@/lib/notifications";
import {
  ArrowLeft,
  MapPin,
  Clock,
  Eye,
  CheckCircle,
  Share2,
  Flag,
  MessageCircle,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Send,
  Trash2,
  User,
  MoreVertical,
  Image as ImageIcon,
  X,
  Heart,
  ChevronDown,
  ChevronUp,
  Play,
} from "lucide-react";

interface CommentMedia {
  id: string;
  url: string;
  media_type: string;
}

interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  is_anonymous: boolean;
  created_at: string;
  parent_id: string | null;
  likes_count: number;
  user_name: string;
  user_avatar?: string;
  reply_to_name?: string;
  reply_to_id?: string;
  media: CommentMedia[];
  isLiked: boolean;
  isPending?: boolean;
}

export default function PostDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const postId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const isMounted = useRef(true);
  const abortController = useRef<AbortController | null>(null);

  // Post state
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [showSensitive, setShowSensitive] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [videoError, setVideoError] = useState(false);

  // Confirmation
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Comments
  const [allComments, setAllComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string; parentId: string | null } | null>(null);
  const [commentMedia, setCommentMedia] = useState<File[]>([]);
  const [commentMediaPreviews, setCommentMediaPreviews] = useState<{ url: string; type: string }[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [visibleReplyCounts, setVisibleReplyCounts] = useState<Record<string, number>>({});
  const [sortBy, setSortBy] = useState<"top" | "recent">("top");

  // Modals
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  const isOwner = user?.id === post?.user_id;
  const isExpired = post ? differenceInHours(new Date(), new Date(post.created_at)) >= 24 : false;

  // Cleanup
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (abortController.current) {
        abortController.current.abort();
      }
      commentMediaPreviews.forEach(p => URL.revokeObjectURL(p.url));
    };
  }, []);

  // Fetch post
  useEffect(() => {
    if (!postId) return;

    abortController.current = new AbortController();

    const fetchPost = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from("posts")
          .select(`
            *,
            post_media (id, url, media_type, is_sensitive),
            post_tags (tag)
          `)
          .eq("id", postId)
          .single();

        if (!isMounted.current) return;

        if (fetchError) {
          setError("Post not found");
          setLoading(false);
          return;
        }

        setPost({
          id: data.id,
          user_id: data.user_id,
          category: data.category,
          comment: data.comment,
          location: { latitude: 0, longitude: 0 },
          address: data.address,
          is_anonymous: data.is_anonymous,
          status: data.status,
          is_sensitive: data.is_sensitive,
          confirmations: data.confirmations || 0,
          views: data.views || 0,
          comment_count: data.comment_count || 0,
          report_count: data.report_count || 0,
          created_at: data.created_at,
          media: data.post_media || [],
          tags: data.post_tags?.map((t: any) => t.tag) || [],
        });

        // Update views (fire and forget)
        supabase.from("posts").update({ views: (data.views || 0) + 1 }).eq("id", postId).then(() => {});
        
        setLoading(false);
      } catch (err) {
        if (isMounted.current) {
          setError("Failed to load");
          setLoading(false);
        }
      }
    };

    fetchPost();

    return () => {
      if (abortController.current) {
        abortController.current.abort();
      }
    };
  }, [postId]);

  // Fetch comments
  const fetchComments = useCallback(async () => {
    if (!postId) return;

    setCommentsLoading(true);

    try {
      const { data: rawComments, error: commentsErr } = await supabase
        .from("post_comments")
        .select("id, post_id, user_id, content, is_anonymous, created_at, parent_id, likes_count, reply_to_id, reply_to_name")
        .eq("post_id", postId)
        .order("created_at", { ascending: true });

      if (!isMounted.current) return;

      if (commentsErr || !rawComments) {
        setCommentsLoading(false);
        return;
      }

      if (rawComments.length === 0) {
        setAllComments([]);
        setCommentsLoading(false);
        return;
      }

      const userIds = [...new Set(rawComments.filter(c => !c.is_anonymous).map(c => c.user_id))];
      let userMap: Record<string, { full_name: string; avatar_url?: string }> = {};

      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from("users")
          .select("id, full_name, avatar_url")
          .in("id", userIds);

        if (users) {
          users.forEach(u => {
            userMap[u.id] = { full_name: u.full_name, avatar_url: u.avatar_url };
          });
        }
      }

      let userLikes = new Set<string>();
      if (user) {
        const { data: likes } = await supabase
          .from("comment_likes")
          .select("comment_id")
          .eq("user_id", user.id)
          .in("comment_id", rawComments.map(c => c.id));

        if (likes) {
          likes.forEach(l => userLikes.add(l.comment_id));
        }
      }

      const commentIds = rawComments.map(c => c.id);
      let mediaMap: Record<string, CommentMedia[]> = {};

      if (commentIds.length > 0) {
        const { data: mediaData } = await supabase
          .from("comment_media")
          .select("id, comment_id, url, media_type")
          .in("comment_id", commentIds);

        if (mediaData) {
          mediaData.forEach(m => {
            if (!mediaMap[m.comment_id]) mediaMap[m.comment_id] = [];
            mediaMap[m.comment_id].push(m);
          });
        }
      }

      const comments: Comment[] = rawComments.map(c => ({
        id: c.id,
        post_id: c.post_id,
        user_id: c.user_id,
        content: c.content || "",
        is_anonymous: c.is_anonymous,
        created_at: c.created_at,
        parent_id: c.parent_id,
        likes_count: c.likes_count || 0,
        user_name: c.is_anonymous ? "Anonymous" : (userMap[c.user_id]?.full_name || "User"),
        user_avatar: c.is_anonymous ? undefined : userMap[c.user_id]?.avatar_url,
        reply_to_name: c.reply_to_name || undefined,
        reply_to_id: c.reply_to_id || undefined,
        media: mediaMap[c.id] || [],
        isLiked: userLikes.has(c.id),
      }));

      if (isMounted.current) {
        setAllComments(comments);
        setCommentsLoading(false);
      }
    } catch (err) {
      console.error("Fetch comments error:", err);
      if (isMounted.current) setCommentsLoading(false);
    }
  }, [postId, user]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Check if confirmed
  useEffect(() => {
    if (!postId || !user) return;

    const checkConfirmed = async () => {
      const { data } = await supabase
        .from("post_confirmations")
        .select("id")
        .eq("post_id", postId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (isMounted.current) setIsConfirmed(!!data);
    };

    checkConfirmed();
  }, [postId, user]);

  // Get top-level comments (sorted based on toggle)
  const parentComments = allComments
    .filter(c => !c.parent_id)
    .sort((a, b) => {
      if (a.isPending && !b.isPending) return -1;
      if (!a.isPending && b.isPending) return 1;
      
      if (sortBy === "top") {
        if (b.likes_count !== a.likes_count) {
          return b.likes_count - a.likes_count;
        }
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  // Get all replies for a parent comment
  const getRepliesForParent = (parentId: string): Comment[] => {
    return allComments
      .filter(c => c.parent_id === parentId)
      .sort((a, b) => {
        if (a.isPending && !b.isPending) return 1;
        if (!a.isPending && b.isPending) return -1;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
  };

  // Handle confirm
  const handleConfirm = async () => {
    if (!user) {
      router.push("/login");
      return;
    }

    const wasConfirmed = isConfirmed;
    const prevCount = post?.confirmations || 0;

    setIsConfirmed(!wasConfirmed);
    setPost(p => p ? { ...p, confirmations: wasConfirmed ? Math.max(0, prevCount - 1) : prevCount + 1 } : null);

    setConfirmLoading(true);
    try {
      if (wasConfirmed) {
        await supabase.from("post_confirmations").delete().eq("post_id", postId).eq("user_id", user.id);
        await supabase.from("posts").update({ confirmations: Math.max(0, prevCount - 1) }).eq("id", postId);
      } else {
        await supabase.from("post_confirmations").insert({ post_id: postId, user_id: user.id });
        await supabase.from("posts").update({ confirmations: prevCount + 1 }).eq("id", postId);
      }
    } catch (err) {
      setIsConfirmed(wasConfirmed);
      setPost(p => p ? { ...p, confirmations: prevCount } : null);
    } finally {
      setConfirmLoading(false);
    }
  };

  // Handle like comment
  const handleLikeComment = async (commentId: string, currentlyLiked: boolean) => {
    if (!user) {
      router.push("/login");
      return;
    }

    const currentComment = allComments.find(c => c.id === commentId);
    if (!currentComment) return;

    const currentCount = currentComment.likes_count;

    setAllComments(prev => prev.map(c => {
      if (c.id === commentId) {
        return { 
          ...c, 
          isLiked: !currentlyLiked, 
          likes_count: currentlyLiked ? Math.max(0, currentCount - 1) : currentCount + 1 
        };
      }
      return c;
    }));

    try {
      const { data, error } = await supabase.rpc('toggle_comment_like', {
        p_comment_id: commentId,
        p_user_id: user.id
      });

      if (error) {
        console.error("Like error:", error);
        throw error;
      }

      if (data && data.length > 0) {
        const actualLiked = data[0].liked;
        const actualCount = data[0].new_count;
        
        setAllComments(prev => prev.map(c => {
          if (c.id === commentId) {
            return { ...c, isLiked: actualLiked, likes_count: actualCount };
          }
          return c;
        }));

        if (actualLiked && currentComment.user_id !== user.id) {
          notifyCommentLiked(postId, currentComment.user_id, user.full_name || "Someone");
        }
      }

    } catch (err) {
      console.error("Like error:", err);
      setAllComments(prev => prev.map(c => {
        if (c.id === commentId) {
          return { ...c, isLiked: currentlyLiked, likes_count: currentCount };
        }
        return c;
      }));
    }
  };

  // Handle media select - IMAGES ONLY
  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    
    if (imageFiles.length !== files.length) {
      alert("Only images are allowed in comments");
    }
    
    if (imageFiles.length + commentMedia.length > 4) {
      alert("Maximum 4 images per comment");
      return;
    }

    for (const file of imageFiles) {
      if (file.size > 10 * 1024 * 1024) {
        alert(`${file.name} is too large. Max 10MB.`);
        return;
      }
    }

    const previews = imageFiles.map(f => ({
      url: URL.createObjectURL(f),
      type: "image",
    }));
    
    setCommentMedia(prev => [...prev, ...imageFiles]);
    setCommentMediaPreviews(prev => [...prev, ...previews]);
    e.target.value = "";
  };

  const removeMedia = (index: number) => {
    URL.revokeObjectURL(commentMediaPreviews[index].url);
    setCommentMedia(prev => prev.filter((_, i) => i !== index));
    setCommentMediaPreviews(prev => prev.filter((_, i) => i !== index));
  };

  // Submit comment
  const handleSubmitComment = async () => {
    if (!newComment.trim() && commentMedia.length === 0) {
      alert("Please add a comment or media");
      return;
    }

    if (!user) {
      router.push("/login");
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const commentContent = newComment.trim();
    const mediaFiles = [...commentMedia];
    const mediaPreviews = [...commentMediaPreviews];
    
    let parentId: string | null = null;
    let replyToId: string | null = null;
    let replyToName: string | null = null;
    
    if (replyingTo) {
      const targetComment = allComments.find(c => c.id === replyingTo.id);
      if (targetComment) {
        parentId = targetComment.parent_id || targetComment.id;
        replyToId = replyingTo.id;
        replyToName = replyingTo.name;
      }
    }

    const optimisticComment: Comment = {
      id: tempId,
      post_id: postId,
      user_id: user.id,
      content: commentContent,
      is_anonymous: false,
      created_at: new Date().toISOString(),
      parent_id: parentId,
      likes_count: 0,
      user_name: user.full_name || "You",
      user_avatar: user.avatar_url,
      reply_to_name: replyToName || undefined,
      reply_to_id: replyToId || undefined,
      media: mediaPreviews.map((p, i) => ({
        id: `temp-media-${i}`,
        url: p.url,
        media_type: p.type === "video" ? "video" : "photo",
      })),
      isLiked: false,
      isPending: true,
    };

    setAllComments(prev => [...prev, optimisticComment]);
    setPost(p => p ? { ...p, comment_count: (p.comment_count || 0) + 1 } : null);

    if (parentId) {
      setExpandedThreads(prev => new Set([...prev, parentId!]));
    }

    setNewComment("");
    setReplyingTo(null);
    setCommentMedia([]);
    setCommentMediaPreviews([]);
    setSubmittingComment(true);
    setUploadProgress(0);

    try {
      const { data: newCommentData, error: insertError } = await supabase
        .from("post_comments")
        .insert({
          post_id: postId,
          user_id: user.id,
          content: commentContent,
          is_anonymous: false,
          parent_id: parentId,
          reply_to_id: replyToId,
          reply_to_name: replyToName,
          likes_count: 0,
        })
        .select("id")
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      const uploadedMedia: CommentMedia[] = [];
      
      if (mediaFiles.length > 0) {
        for (let i = 0; i < mediaFiles.length; i++) {
          const file = mediaFiles[i];
          const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
          const fileName = `comments/${newCommentData.id}/${Date.now()}_${i}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from("media")
            .upload(fileName, file, { cacheControl: "3600", upsert: false });

          if (uploadError) {
            console.error("Upload error:", uploadError);
            continue;
          }

          const { data: urlData } = supabase.storage.from("media").getPublicUrl(fileName);

          const mediaType = file.type.startsWith("video/") ? "video" : "photo";
          
          await supabase.from("comment_media").insert({
            comment_id: newCommentData.id,
            url: urlData.publicUrl,
            media_type: mediaType,
          });

          uploadedMedia.push({
            id: `media-${i}`,
            url: urlData.publicUrl,
            media_type: mediaType,
          });

          setUploadProgress(Math.round(((i + 1) / mediaFiles.length) * 100));
        }
      }

      setAllComments(prev => prev.map(c => {
        if (c.id === tempId) {
          return {
            ...c,
            id: newCommentData.id,
            media: uploadedMedia.length > 0 ? uploadedMedia : c.media.map(m => ({
              ...m,
              id: m.id.replace('temp-', ''),
            })),
            isPending: false,
          };
        }
        return c;
      }));

      await supabase.from("posts").update({ 
        comment_count: (post?.comment_count || 0) + 1 
      }).eq("id", postId);

      // Notify post owner about new comment
      if (post?.user_id && post.user_id !== user.id && commentContent) {
        notifyPostComment(
          postId,
          post.user_id,
          user.full_name || "Someone",
          commentContent
        );
      }

    } catch (err: any) {
      console.error("Submit error:", err);
      
      setAllComments(prev => prev.filter(c => c.id !== tempId));
      setPost(p => p ? { ...p, comment_count: Math.max(0, (p.comment_count || 0) - 1) } : null);
      
      setNewComment(commentContent);
      setCommentMedia(mediaFiles);
      setCommentMediaPreviews(mediaPreviews);
      
      alert(err.message || "Failed to post comment");
    } finally {
      setSubmittingComment(false);
      setUploadProgress(0);
    }
  };

  // Delete comment
  const handleDeleteComment = async (commentId: string) => {
    if (!confirm("Delete this comment?")) return;

    const commentToDelete = allComments.find(c => c.id === commentId);
    if (!commentToDelete) return;

    const replies = allComments.filter(c => c.parent_id === commentId);
    const totalToDelete = 1 + replies.length;

    setAllComments(prev => prev.filter(c => c.id !== commentId && c.parent_id !== commentId));
    setPost(p => p ? { ...p, comment_count: Math.max(0, (p.comment_count || 0) - totalToDelete) } : null);

    try {
      await supabase.from("comment_likes").delete().eq("comment_id", commentId);
      await supabase.from("comment_media").delete().eq("comment_id", commentId);
      
      for (const reply of replies) {
        await supabase.from("comment_likes").delete().eq("comment_id", reply.id);
        await supabase.from("comment_media").delete().eq("comment_id", reply.id);
        await supabase.from("post_comments").delete().eq("id", reply.id);
      }
      
      await supabase.from("post_comments").delete().eq("id", commentId);
      
      await supabase.from("posts").update({ 
        comment_count: Math.max(0, (post?.comment_count || 0) - totalToDelete) 
      }).eq("id", postId);

    } catch (err) {
      console.error("Delete error:", err);
      fetchComments();
    }
  };

  // Share
  const handleShare = async () => {
    const url = `${window.location.origin}/post/${postId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Peja Alert", url });
      } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      alert("Link copied!");
    }
  };

  // Report
  const handleReport = async () => {
    if (!reportReason || !user) return;

    setSubmittingReport(true);
    try {
      await supabase.from("post_reports").insert({
        post_id: postId,
        user_id: user.id,
        reason: reportReason,
        description: reportDescription,
      });

      const newCount = (post?.report_count || 0) + 1;
      await supabase.from("posts").update({ report_count: newCount }).eq("id", postId);

      if (newCount >= 3) {
        await supabase.from("posts").update({ status: "archived" }).eq("id", postId);
        alert("Post removed due to reports.");
        router.push("/");
        return;
      }

      setShowReportModal(false);
      setReportReason("");
      setReportDescription("");
      alert("Report submitted!");
    } catch (err: any) {
      alert(err.code === "23505" ? "Already reported." : "Failed to report.");
    } finally {
      setSubmittingReport(false);
    }
  };

  // Delete post
  const handleDeletePost = async () => {
    if (!post) return;

    setDeleting(true);
    try {
      const commentIds = allComments.map(c => c.id);
      if (commentIds.length > 0) {
        await supabase.from("comment_likes").delete().in("comment_id", commentIds);
        await supabase.from("comment_media").delete().in("comment_id", commentIds);
      }
      await supabase.from("post_comments").delete().eq("post_id", postId);
      await supabase.from("post_media").delete().eq("post_id", postId);
      await supabase.from("post_tags").delete().eq("post_id", postId);
      await supabase.from("post_confirmations").delete().eq("post_id", postId);
      await supabase.from("post_reports").delete().eq("post_id", postId);
      await supabase.from("posts").delete().eq("id", postId);
      
      router.replace("/");
    } catch (err) {
      console.error("Delete error:", err);
      alert("Failed to delete.");
    } finally {
      setDeleting(false);
    }
  };

  // Reply handler
  const handleReply = (comment: Comment) => {
    setReplyingTo({ 
      id: comment.id, 
      name: comment.user_name,
      parentId: comment.parent_id,
    });
    commentInputRef.current?.focus();
  };

  // Toggle thread visibility
  const toggleThread = (parentId: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
        if (!visibleReplyCounts[parentId]) {
          setVisibleReplyCounts(p => ({ ...p, [parentId]: 20 }));
        }
      }
      return next;
    });
  };

  // Load more replies
  const loadMoreReplies = (parentId: string) => {
    setVisibleReplyCounts(p => ({
      ...p,
      [parentId]: (p[parentId] || 20) + 20,
    }));
  };

  // Render a single comment
  const renderComment = (comment: Comment, isReply = false) => (
    <div 
      key={comment.id} 
      className={`${isReply ? "ml-10 py-2" : "py-3"} ${comment.isPending ? "opacity-60" : ""}`}
    >
      <div className="flex gap-3">
        <div className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {comment.user_avatar ? (
            <img src={comment.user_avatar} alt="" className="w-8 h-8 object-cover" />
          ) : (
            <User className="w-4 h-4 text-dark-400" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-dark-200">{comment.user_name}</span>
            <span className="text-xs text-dark-500">
              {comment.isPending ? "Posting..." : formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
            </span>
          </div>

          <p className="text-dark-200 text-sm mt-1">
            {comment.reply_to_name && (
              <span className="text-primary-400 mr-1">@{comment.reply_to_name}</span>
            )}
            {comment.content}
          </p>

          {comment.media.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {comment.media.map(m => (
                <div key={m.id} className="w-24 h-24 rounded-lg overflow-hidden bg-dark-800">
                  <img 
                    src={m.url} 
                    alt="" 
                    className="w-full h-full object-cover cursor-pointer" 
                    onClick={() => window.open(m.url)} 
                  />
                </div>
              ))}
            </div>
          )}

          {!comment.isPending && (
            <div className="flex items-center gap-4 mt-2">
              <button
                onClick={() => handleLikeComment(comment.id, comment.isLiked)}
                className={`flex items-center gap-1.5 text-xs transition-colors ${
                  comment.isLiked ? "text-red-400" : "text-dark-400 hover:text-red-400"
                }`}
              >
                <Heart className={`w-4 h-4 ${comment.isLiked ? "fill-current" : ""}`} />
                <span>{comment.likes_count}</span>
              </button>

              <button
                onClick={() => handleReply(comment)}
                className="text-xs text-dark-400 hover:text-primary-400 transition-colors"
              >
                Reply
              </button>

              {comment.user_id === user?.id && (
                <button
                  onClick={() => handleDeleteComment(comment.id)}
                  className="text-xs text-dark-500 hover:text-red-400 transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Render a thread (parent + replies)
  const renderThread = (parent: Comment) => {
    const replies = getRepliesForParent(parent.id);
    const isExpanded = expandedThreads.has(parent.id);
    const visibleCount = visibleReplyCounts[parent.id] || 20;
    const visibleReplies = replies.slice(0, visibleCount);
    const hasMoreReplies = replies.length > visibleCount;

    return (
      <div key={parent.id} className="border-b border-white/5 last:border-0">
        {renderComment(parent, false)}
        
        {replies.length > 0 && !isExpanded && (
          <button
            onClick={() => toggleThread(parent.id)}
            className="ml-11 mb-3 flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            View {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </button>
        )}

        {isExpanded && (
          <div className="ml-1 border-l-2 border-dark-700">
            {visibleReplies.map(reply => renderComment(reply, true))}
            
            {hasMoreReplies && (
              <button
                onClick={() => loadMoreReplies(parent.id)}
                className="ml-10 py-2 text-xs text-primary-400 hover:text-primary-300"
              >
                View more ({replies.length - visibleCount} remaining)
              </button>
            )}

            <button
              onClick={() => toggleThread(parent.id)}
              className="ml-10 py-2 flex items-center gap-1 text-xs text-dark-400 hover:text-dark-300"
            >
              <ChevronUp className="w-3.5 h-3.5" />
              Hide replies
            </button>
          </div>
        )}
      </div>
    );
  };

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  // Error
  if (error || !post) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <AlertTriangle className="w-16 h-16 text-red-400 mb-4" />
        <h1 className="text-xl font-bold text-dark-100 mb-2">Post Not Found</h1>
        <p className="text-dark-400 mb-4">This post may have been removed.</p>
        <Button variant="primary" onClick={() => router.push("/")}>Go Home</Button>
      </div>
    );
  }

  const category = CATEGORIES.find(c => c.id === post.category);
  const badgeVariant = category?.color === "danger" ? "danger" : category?.color === "warning" ? "warning" : "info";
  const currentMedia = post.media?.[currentMediaIndex];
  const descText = post.comment || "";
  const isLongDesc = descText.length > 200;
  const displayDesc = isLongDesc && !showFullDescription ? descText.slice(0, 200) + "..." : descText;

  return (
    <div className="min-h-screen pb-32">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass-header">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-white/10 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-lg font-semibold text-dark-100">Incident Details</h1>
          <div className="relative">
            <button onClick={() => setShowOptions(!showOptions)} className="p-2 -mr-2 hover:bg-white/10 rounded-lg">
              <MoreVertical className="w-5 h-5 text-dark-200" />
            </button>
            {showOptions && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowOptions(false)} />
                <div className="absolute right-0 top-full mt-1 w-44 glass-strong rounded-xl p-1.5 z-50 shadow-lg">
                  <button onClick={() => { handleShare(); setShowOptions(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/10 text-dark-200 text-sm">
                    <Share2 className="w-4 h-4" /> Share
                  </button>
                  {!isOwner && (
                    <button onClick={() => { setShowReportModal(true); setShowOptions(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/10 text-orange-400 text-sm">
                      <Flag className="w-4 h-4" /> Report
                    </button>
                  )}
                  {isOwner && (
                    <button onClick={() => { setShowDeleteModal(true); setShowOptions(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/10 text-red-400 text-sm">
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto">
        {/* Media */}
        {post.media && post.media.length > 0 && (
          <div className="relative bg-black">
            {post.is_sensitive && !showSensitive ? (
              <div className="aspect-video flex flex-col items-center justify-center bg-dark-800">
                <AlertTriangle className="w-10 h-10 text-orange-400 mb-2" />
                <p className="text-dark-200 text-sm mb-3">Sensitive Content</p>
                <Button variant="secondary" size="sm" onClick={() => setShowSensitive(true)}>View</Button>
              </div>
            ) : (
              <div className="aspect-video relative">
                {currentMedia?.media_type === "video" ? (
                  videoError ? (
                    <div className="w-full h-full flex items-center justify-center bg-dark-800">
                      <div className="text-center">
                        <Play className="w-12 h-12 text-dark-500 mx-auto mb-2" />
                        <p className="text-dark-400">Video unavailable</p>
                      </div>
                    </div>
                  ) : (
                    <video
                      key={currentMedia.url}
                      className="w-full h-full object-contain bg-black"
                      controls
                      playsInline
                      preload="metadata"
                      src={currentMedia.url}
                      onError={() => setVideoError(true)}
                    />
                  )
                ) : (
                  <img src={currentMedia?.url} alt="" className="w-full h-full object-contain" />
                )}
                
                {post.media.length > 1 && (
                  <>
                    <button 
                      onClick={() => { setVideoError(false); setCurrentMediaIndex(i => i === 0 ? post.media!.length - 1 : i - 1); }} 
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/60 rounded-full"
                    >
                      <ChevronLeft className="w-5 h-5 text-white" />
                    </button>
                    <button 
                      onClick={() => { setVideoError(false); setCurrentMediaIndex(i => i === post.media!.length - 1 ? 0 : i + 1); }} 
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/60 rounded-full"
                    >
                      <ChevronRight className="w-5 h-5 text-white" />
                    </button>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                      {post.media.map((_, i) => (
                        <div key={i} className={`w-1.5 h-1.5 rounded-full ${i === currentMediaIndex ? "bg-white" : "bg-white/40"}`} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Badge variant={badgeVariant}>{category?.name || post.category}</Badge>
            {!isExpired ? (
              <span className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-red-400 font-medium">LIVE</span>
              </span>
            ) : (
              <span className="text-xs text-dark-500">{formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</span>
            )}
          </div>

          {displayDesc && (
            <div>
              <p className="text-dark-100">{displayDesc}</p>
              {isLongDesc && (
                <button onClick={() => setShowFullDescription(!showFullDescription)} className="text-primary-400 text-sm mt-1">
                  {showFullDescription ? "Less" : "More"}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-dark-400">
            {post.address && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                <span className="truncate max-w-[150px]">{post.address}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" />
              {post.views}
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5" />
              {post.comment_count || 0}
            </span>
          </div>

          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {post.tags.map((t, i) => <span key={i} className="text-primary-400 text-xs">#{t}</span>)}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleConfirm}
              disabled={confirmLoading}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isConfirmed ? "bg-primary-600 text-white" : "glass-sm text-dark-200 hover:bg-white/10"
              }`}
            >
              {confirmLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className={`w-4 h-4 ${isConfirmed ? "fill-current" : ""}`} />
              )}
              {isConfirmed ? "Confirmed" : "Confirm"} ({post.confirmations})
            </button>
            <button onClick={handleShare} className="p-2.5 rounded-xl glass-sm text-dark-300 hover:bg-white/10">
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Comments */}
        <div className="border-t border-white/5 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-dark-100 flex items-center gap-2">
              <MessageCircle className="w-5 h-5" />
              Comments ({post.comment_count || 0})
            </h3>
            
            {parentComments.length > 1 && (
              <div className="flex gap-1 glass-sm rounded-lg p-1">
                <button
                  onClick={() => setSortBy("top")}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    sortBy === "top" ? "bg-primary-600 text-white" : "text-dark-400 hover:text-dark-200"
                  }`}
                >
                  Top
                </button>
                <button
                  onClick={() => setSortBy("recent")}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    sortBy === "recent" ? "bg-primary-600 text-white" : "text-dark-400 hover:text-dark-200"
                  }`}
                >
                  Recent
                </button>
              </div>
            )}
          </div>

          {commentsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : parentComments.length === 0 ? (
            <div className="text-center py-8">
              <MessageCircle className="w-10 h-10 text-dark-600 mx-auto mb-2" />
              <p className="text-dark-400 text-sm">No comments yet</p>
              <p className="text-dark-500 text-xs">Be the first to comment</p>
            </div>
          ) : (
            <div>
              {parentComments.map(parent => renderThread(parent))}
            </div>
          )}
        </div>
      </main>

      {/* Comment Input */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-dark-950/95 backdrop-blur-lg border-t border-white/10">
        <div className="max-w-2xl mx-auto p-3">
          {replyingTo && (
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs text-primary-400">Replying to @{replyingTo.name}</span>
              <button onClick={() => setReplyingTo(null)} className="text-xs text-dark-400 hover:text-dark-200">
                Cancel
              </button>
            </div>
          )}

          {commentMediaPreviews.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
              {commentMediaPreviews.map((p, i) => (
                <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-dark-800">
                  <img src={p.url} alt="" className="w-full h-full object-cover" />
                  <button 
                    onClick={() => removeMedia(i)} 
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/80 rounded-full flex items-center justify-center"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="mb-2">
              <div className="h-1 bg-dark-700 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button 
              onClick={() => fileInputRef.current?.click()} 
              className="p-2 hover:bg-white/10 rounded-lg text-dark-400 flex-shrink-0"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleMediaSelect} 
              accept="image/*" 
              multiple 
              className="hidden" 
            />

            <input
              ref={commentInputRef}
              type="text"
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder={replyingTo ? `Reply to @${replyingTo.name}...` : "Add a comment..."}
              className="flex-1 px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-xl text-dark-100 placeholder-dark-500 text-sm focus:outline-none focus:border-primary-500"
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey && !submittingComment) {
                  e.preventDefault();
                  handleSubmitComment();
                }
              }}
              disabled={submittingComment}
            />

            <button
              onClick={handleSubmitComment}
              disabled={submittingComment || (!newComment.trim() && commentMedia.length === 0)}
              className="p-2.5 bg-primary-600 rounded-xl text-white disabled:opacity-50 flex-shrink-0"
            >
              {submittingComment ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Report Modal */}
      <Modal isOpen={showReportModal} onClose={() => setShowReportModal(false)} title="Report Post">
        <div className="space-y-3">
          {REPORT_REASONS.map(r => (
            <label 
              key={r.id} 
              className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${
                reportReason === r.id ? "bg-primary-600/10 border-primary-500/50" : "border-dark-700 hover:border-dark-600"
              }`}
            >
              <input 
                type="radio" 
                checked={reportReason === r.id} 
                onChange={() => setReportReason(r.id)} 
                className="mt-0.5" 
              />
              <div>
                <p className="text-dark-100 text-sm font-medium">{r.label}</p>
                <p className="text-dark-400 text-xs">{r.description}</p>
              </div>
            </label>
          ))}
          {reportReason === "other" && (
            <textarea 
              value={reportDescription} 
              onChange={e => setReportDescription(e.target.value)} 
              placeholder="Details..." 
              rows={2} 
              className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded-xl text-sm resize-none focus:outline-none focus:border-primary-500" 
            />
          )}
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowReportModal(false)}>
              Cancel
            </Button>
            <Button 
              variant="primary" 
              className="flex-1" 
              onClick={handleReport} 
              isLoading={submittingReport} 
              disabled={!reportReason}
            >
              Submit
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete Post">
        <p className="text-dark-300 text-sm mb-4">Delete this post permanently? This cannot be undone.</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setShowDeleteModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" className="flex-1" onClick={handleDeletePost} isLoading={deleting}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}