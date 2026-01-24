"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { Loader2, Heart, User, Send, X, Trash2, Copy, Flag, MoreVertical, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Post, REPORT_REASONS } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { notifyPostComment, notifyCommentLiked, notifyCommentReply } from "@/lib/notifications";
import { useLongPress } from "@/components/hooks/useLongPress";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

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
  isLiked: boolean;
}

export function WatchCommentSheet({
  post,
  isOpen,
  onClose,
  onCommentSuccess,
}: {
  post: Post;
  isOpen: boolean;
  onClose: () => void;
  onCommentSuccess?: () => void;
}) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sortBy, setSortBy] = useState<"top" | "recent">("top");

  // --- Options Modal State ---
  const [showOptions, setShowOptions] = useState(false);
  const [selectedComment, setSelectedComment] = useState<any | null>(null);
  
  // --- Report Modal State ---
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  // --- Thread State ---
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  const toggleThread = (parentId: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
      }
      return next;
    });
  };

  // --- Long Press Logic ---
  const openOptions = (comment: any) => {
    setSelectedComment(comment);
    setShowOptions(true);
  };
  
  // Reply State
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string; parentId: string | null; userId: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // --- Fetch Comments ---
  useEffect(() => {
    if (!isOpen) return;
    
    const fetchComments = async () => {
      setLoading(true);
      
      const { data: rawComments, error } = await supabase
        .from("post_comments")
        .select("*")
        .eq("post_id", post.id)
        .order("created_at", { ascending: false });

      if (error || !rawComments) {
        setLoading(false);
        return;
      }

      const userIds = Array.from(new Set(
        rawComments.filter(c => !c.is_anonymous && c.user_id).map(c => c.user_id)
      ));

      let userMap: Record<string, { full_name: string; avatar_url: string | null }> = {};
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

      // Check current user likes
      let userLikes = new Set<string>();
      if (user) {
        const { data: likes } = await supabase
          .from("comment_likes")
          .select("comment_id")
          .eq("user_id", user.id)
          .in("comment_id", rawComments.map(c => c.id));
        if (likes) likes.forEach(l => userLikes.add(l.comment_id));
      }

      const formatted = rawComments.map(c => {
        const u = userMap[c.user_id];
        return {
          ...c,
          user_name: c.is_anonymous ? "Anonymous" : (u?.full_name || "User"),
          user_avatar: c.is_anonymous ? null : u?.avatar_url,
          isLiked: userLikes.has(c.id)
        };
      });

      setComments(formatted);
      setLoading(false);
    };

    fetchComments();
  }, [isOpen, post.id, user]);

  // --- Actions ---

  const handleLike = async (commentId: string) => {
    if (!user) return;

    const targetComment = comments.find(c => c.id === commentId);
    if (!targetComment) return;

    const isLiked = targetComment.isLiked;
    
    // Optimistic Update
    setComments(prev => prev.map(c => 
      c.id === commentId 
        ? { ...c, isLiked: !isLiked, likes_count: isLiked ? Math.max(0, c.likes_count - 1) : c.likes_count + 1 } 
        : c
    ));

    try {
      const { data } = await supabase.rpc('toggle_comment_like', {
        p_comment_id: commentId,
        p_user_id: user.id
      });

      // Notify if liked (and not self)
      if (!isLiked && data && data[0]?.liked && targetComment.user_id !== user.id) {
        notifyCommentLiked(post.id, targetComment.user_id, user.full_name || "Someone");
      }
    } catch (err) {
      // Revert on error
      setComments(prev => prev.map(c => 
        c.id === commentId 
          ? { ...c, isLiked: isLiked, likes_count: targetComment.likes_count } 
          : c
      ));
    }
  };

  const handleReply = (comment: Comment) => {
    setReplyingTo({
      id: comment.id,
      name: comment.user_name,
      parentId: comment.parent_id || comment.id,
      userId: comment.user_id
    });
    inputRef.current?.focus();
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm("Delete this comment?")) return;

    // Optimistic remove
    setComments(prev => prev.filter(c => c.id !== commentId && c.parent_id !== commentId));

    try {
      // Delete replies first (cascade usually handles this but safe to be explicit if needed, 
      // but standard cascade delete on parent_id usually works). 
      // We'll just delete the specific ID and let DB handle cascade.
      await supabase.from("post_comments").delete().eq("id", commentId);
      
      // Update global count
      await supabase.rpc('decrement_comment_count', { post_id: post.id }); 
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  const handleSubmit = async () => {
    if (!newComment.trim() || !user) return;
    setSubmitting(true);

    const content = newComment.trim();
    
    try {
      const { data, error } = await supabase
        .from("post_comments")
        .insert({
          post_id: post.id,
          user_id: user.id,
          content: content,
          likes_count: 0,
          parent_id: replyingTo?.parentId || null,
          reply_to_id: replyingTo?.id || null,
          reply_to_name: replyingTo?.name || null
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        const added: Comment = {
          ...data,
          user_name: user.full_name || "You",
          user_avatar: user.avatar_url,
          isLiked: false
        };
        setComments([added, ...comments]);
        setNewComment("");
        
        // Notifications
        if (replyingTo && replyingTo.userId !== user.id) {
           notifyCommentReply(post.id, replyingTo.userId, user.full_name || "Someone", content);
        } else if (post.user_id !== user.id) {
           notifyPostComment(post.id, post.user_id, user.full_name || "Someone", content);
        }

        if (onCommentSuccess) onCommentSuccess();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
      setReplyingTo(null);
    }
  };

  const sortedComments = [...comments].sort((a, b) => {
    if (sortBy === "top") return (b.likes_count || 0) - (a.likes_count || 0);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // --- Threading Logic ---
  const parentComments = useMemo(() => {
    return comments
      .filter(c => !c.parent_id)
      .sort((a, b) => {
        if (sortBy === "top") return (b.likes_count || 0) - (a.likes_count || 0);
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [comments, sortBy]);

  const getReplies = (parentId: string) => {
    return comments
      .filter(c => c.parent_id === parentId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  };

  const handleCopy = () => {
    if (!selectedComment) return;
    navigator.clipboard.writeText(selectedComment.content);
    setShowOptions(false);
    // Optional: Add a small toast here if you have a toast context available
  };

  const handleReportAction = async () => {
    if (!reportReason || !user || !selectedComment) return;
    setSubmittingReport(true);
    
    // Call backend API (Phase 2 implementation will go here)
    // For now, simulate success
    setTimeout(() => {
       setSubmittingReport(false);
       setShowReportModal(false);
       setShowOptions(false);
       alert("Report submitted."); // Replace with Toast later
    }, 1000);
  };

  const handleDeleteAction = async () => {
    if (!selectedComment) return;
    // Direct delete (Optimistic)
    setComments(prev => prev.filter(c => c.id !== selectedComment.id && c.parent_id !== selectedComment.id));
    setShowOptions(false);

    try {
      await supabase.from("post_comments").delete().eq("id", selectedComment.id);
      await supabase.rpc('decrement_comment_count', { post_id: post.id });
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  // Helper to render a single comment row with Long Press support
  const RenderCommentRow = ({ comment, isReply = false }: { comment: any, isReply?: boolean }) => {
    const longPressProps = useLongPress(() => openOptions(comment), 500);

    return (
      <div 
        key={comment.id} 
        className={`flex gap-3 py-2`}
        {...longPressProps}
        onClick={() => handleReply(comment)} // Tap to reply
      >
        <div className="w-8 h-8 rounded-full bg-white/10 shrink-0 overflow-hidden">
           {comment.user_avatar ? <img src={comment.user_avatar} className="w-full h-full object-cover" /> : <User className="w-full h-full p-1.5 text-white/50" />}
        </div>
        <div className="flex-1">
           <div className="flex items-baseline gap-2">
              <span className="text-xs font-bold text-white/90">{comment.user_name}</span>
              <span className="text-[10px] text-white/40">{formatDistanceToNow(new Date(comment.created_at))}</span>
           </div>
           <p className="text-sm text-white/90 mt-0.5 leading-snug">
              {isReply && comment.reply_to_name && (
                <span className="text-primary-400 mr-1">@{comment.reply_to_name}</span>
              )}
              {comment.content}
           </p>
           <div className="flex items-center gap-4 mt-2">
              <button 
                onClick={(e) => { e.stopPropagation(); handleLike(comment.id); }}
                className={`flex items-center gap-1 text-xs ${comment.isLiked ? "text-red-500" : "text-white/40"}`}
              >
                 <Heart className={`w-3.5 h-3.5 ${comment.isLiked ? "fill-current" : ""}`} /> 
                 {comment.likes_count > 0 && comment.likes_count}
              </button>
              <button className="text-xs text-white/40 font-medium">Reply</button>
           </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div 
        className={`fixed inset-x-0 bottom-0 z-[50000] bg-dark-950 rounded-t-3xl transition-transform duration-300 ease-out flex flex-col border-t border-white/10 ${
          isOpen ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ height: "70vh" }}
      >
        {/* Header */}
        <div onClick={onClose} className="w-full h-12 flex items-center justify-center shrink-0 cursor-pointer border-b border-white/5 active:bg-white/5">
          <div className="w-12 h-1.5 bg-white/20 rounded-full" />
        </div>

        {/* Info & Sort */}
        <div className="px-4 py-3 border-b border-white/5 shrink-0 flex items-start gap-3">
          <div className="flex-1">
             <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold text-white">@{post.is_anonymous ? "Anonymous" : "User"}</span>
                <span className="text-xs text-white/50">{formatDistanceToNow(new Date(post.created_at))} ago</span>
             </div>
             <p className="text-sm text-white/90 line-clamp-2">{post.comment}</p>
          </div>
          <div className="flex gap-2">
             <button onClick={() => setSortBy("top")} className={`text-xs px-2 py-1 rounded-md ${sortBy === "top" ? "bg-white/20 text-white" : "text-white/50"}`}>Top</button>
             <button onClick={() => setSortBy("recent")} className={`text-xs px-2 py-1 rounded-md ${sortBy === "recent" ? "bg-white/20 text-white" : "text-white/50"}`}>New</button>
          </div>
        </div>

        {/* Comments List (Threaded) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
          <div className="flex justify-center p-4"><Loader2 className="w-6 h-6 animate-spin text-white/50" /></div>
        ) : parentComments.length === 0 ? (
          <div className="text-center text-white/40 py-10 text-sm">No comments yet.</div>
        ) : (
          parentComments.map(parent => {
            const replies = getReplies(parent.id);
            const isExpanded = expandedThreads.has(parent.id);

            return (
              <div key={parent.id} className="group">
                {/* Parent Comment */}
                <RenderCommentRow comment={parent} />

                {/* Reply Actions */}
                {replies.length > 0 && (
                  <div className="">
                    {!isExpanded ? (
                      <button
                        onClick={() => toggleThread(parent.id)}
                        className="ml-11 mb-3 flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                        View {replies.length} {replies.length === 1 ? "reply" : "replies"}
                      </button>
                    ) : (
                      <div className="border-l-2 border-white/10 ml-2 pl-4 pb-2">
                        {/* Render Replies */}
                        {replies.map(reply => (
                          <RenderCommentRow key={reply.id} comment={reply} isReply={true} />
                        ))}
                        
                        {/* Hide Button */}
                        <button
                          onClick={() => toggleThread(parent.id)}
                          className="ml-7 mt-2 flex items-center gap-1 text-xs text-white/40 hover:text-white transition-colors"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                          Hide replies
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        </div>

        {/* Input Area */}
        <div className="p-3 border-t border-white/10 bg-dark-1000 pb-8">
          {replyingTo && (
            <div className="flex items-center justify-between px-2 mb-2 text-xs text-primary-400">
               <span>Replying to @{replyingTo.name}</span>
               <button onClick={() => setReplyingTo(null)} className="text-white/50 hover:text-white"><X className="w-3 h-3" /></button>
            </div>
          )}
          <div className="flex items-center gap-2 bg-white/5 rounded-full px-4 py-2 border border-white/5">
             <input 
               ref={inputRef}
               value={newComment}
               onChange={(e) => setNewComment(e.target.value)}
               placeholder={replyingTo ? `Reply to @${replyingTo.name}...` : "Add a comment..."}
               className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder-white/40"
               onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
             />
             <button onClick={handleSubmit} disabled={submitting || !newComment.trim()} className="text-primary-500 disabled:opacity-50 font-medium text-sm">
               {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
             </button>
          </div>
        </div>
      </div>

      {/* --- Options Modal (Long Press) --- */}
      <Modal isOpen={showOptions} onClose={() => setShowOptions(false)} title="Options" animation="slide-up">
         <div className="space-y-2">
            <Button variant="secondary" onClick={handleCopy} className="w-full justify-start gap-3 h-12 text-base">
               <Copy className="w-5 h-5" /> Copy Text
            </Button>
            
            {/* Delete only if user owns the comment */}
            {selectedComment?.user_id === user?.id && (
               <Button variant="secondary" onClick={handleDeleteAction} className="w-full justify-start gap-3 text-red-400 h-12 text-base">
                  <Trash2 className="w-5 h-5" /> Delete
               </Button>
            )}

            {/* Report only if user does NOT own comment */}
            {selectedComment?.user_id !== user?.id && (
               <Button variant="secondary" onClick={() => { setShowReportModal(true); setShowOptions(false); }} className="w-full justify-start gap-3 text-orange-400 h-12 text-base">
                  <Flag className="w-5 h-5" /> Report
               </Button>
            )}
         </div>
      </Modal>

      {/* --- Report Modal --- */}
      <Modal isOpen={showReportModal} onClose={() => setShowReportModal(false)} title="Report Comment">
        <div className="space-y-3">
          {REPORT_REASONS.map(r => (
            <label key={r.id} className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${reportReason === r.id ? "bg-primary-600/10 border-primary-500/50" : "border-dark-700 hover:border-dark-600"}`}>
              <input type="radio" checked={reportReason === r.id} onChange={() => setReportReason(r.id)} className="mt-0.5" />
              <div>
                <p className="text-dark-100 text-sm font-medium">{r.label}</p>
                <p className="text-dark-400 text-xs">{r.description}</p>
              </div>
            </label>
          ))}
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowReportModal(false)}>Cancel</Button>
            <Button variant="primary" className="flex-1" onClick={handleReportAction} isLoading={submittingReport} disabled={!reportReason}>Submit</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}