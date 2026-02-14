export interface User {
  id: string;
  email: string;
  phone: string;
  full_name: string;
  occupation?: string;
  date_of_birth?: string;
  gender?: string;
  avatar_url?: string;
  reputation_score: number;
  is_guardian: boolean;
  is_admin?: boolean;
  status: "active" | "suspended" | "banned";
  email_verified: boolean;
  phone_verified: boolean;
  created_at: string;
  last_latitude?: number;
  last_longitude?: number;
  last_location_updated_at?: string;
}

export interface Post {
  id: string;
  user_id: string;
  category: string;
  comment?: string | null;

  location: {
    latitude: number;
    longitude: number;
  };

  address?: string | null;
  is_anonymous: boolean;

  status: "live" | "resolved" | "archived" | "cancelled";

  is_sensitive: boolean;
  confirmations: number;
  views: number;

  comment_count?: number;
  report_count?: number;

  created_at: string;

  media?: PostMedia[];
  tags?: string[];
}

export interface PostMedia {
  id: string;
  post_id: string;
  url: string;
  media_type: "photo" | "video";
  duration?: number;
  is_sensitive: boolean;
  thumbnail_url?: string;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  is_anonymous: boolean;
  created_at: string;
  parent_id?: string | null;
  user?: {
    full_name: string;
    avatar_url?: string;
  };
}

export interface UserSettings {
  id: string;
  user_id: string;
  push_enabled: boolean;
  sms_enabled: boolean;
  email_enabled: boolean;
  danger_alerts: boolean;
  caution_alerts: boolean;
  awareness_alerts: boolean;
  info_alerts: boolean;
  alert_zone_type: "all_nigeria" | "states" | "radius" | "saved_locations";
  selected_states: string[];
  alert_radius_km: number;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

export interface SavedLocation {
  id: string;
  user_id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radius_km: number;
}

export interface EmergencyContact {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  relationship: string;
  is_verified: boolean;
}

export interface SOSAlert {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  address?: string;
  status: "active" | "resolved" | "false_alarm" | "cancelled";
  tag?: string;
  message?: string;
  voice_note_url?: string;
  bearing?: number;
  created_at: string;
  resolved_at?: string;
  last_updated?: string;
  user?: {
    full_name: string;
    avatar_url?: string;
  };
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: "danger" | "warning" | "info" | "awareness";
  expirySeconds: number;
}

// =====================================================
// CATEGORY MAPPING
// =====================================================
export const CATEGORIES: Category[] = [
  // 🔴 DANGER (Red markers on map)
  { id: "crime", name: "Crime/Theft", icon: "AlertTriangle", color: "danger", expirySeconds: 86400 },
  { id: "fire", name: "Fire", icon: "Flame", color: "danger", expirySeconds: 21600 },
  { id: "kidnapping", name: "Kidnapping", icon: "UserX", color: "danger", expirySeconds: 86400 },
  { id: "terrorist", name: "Terrorist Attack", icon: "Skull", color: "danger", expirySeconds: 86400 },
  
  // 🔵 INFO (Blue markers on map)
  { id: "general", name: "General Alert", icon: "Info", color: "info", expirySeconds: 43200 },
];

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun",
  "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
];

export const REPORT_REASONS = [
  { id: "false_info", label: "False Information", description: "This incident didn't happen" },
  { id: "inappropriate", label: "Inappropriate Content", description: "Violates community guidelines" },
  { id: "spam", label: "Spam", description: "Not a real incident report" },
  { id: "harassment", label: "Harassment", description: "Targeting or threatening individuals" },
  { id: "other", label: "Other", description: "Other reason" },
];

// SOS Emergency Types
export const SOS_TAGS = [
  { id: "medical", label: "Medical Emergency", icon: "🏥", suggestion: "Call an ambulance or get the person to a hospital immediately." },
  { id: "accident", label: "Car Accident", icon: "🚗", suggestion: "Check for injuries, call emergency services, and do not move the injured unless necessary." },
  { id: "robbery", label: "Armed Robbery", icon: "🔫", suggestion: "Do NOT approach. Contact police immediately. Stay safe and observe from a distance." },
  { id: "kidnapping", label: "Kidnapping", icon: "⚠️", suggestion: "EXTREME DANGER. Do NOT approach. Contact police immediately at 112 or 767." },
  { id: "fire", label: "Fire", icon: "🔥", suggestion: "Call fire service. Evacuate the area. Do not enter burning buildings." },
  { id: "assault", label: "Physical Assault", icon: "👊", suggestion: "Ensure the scene is safe before approaching. Call police and provide first aid if trained." },
  { id: "flood", label: "Flooding", icon: "🌊", suggestion: "Avoid flooded areas. Help evacuate people to higher ground." },
  { id: "stuck", label: "Stuck/Stranded", icon: "📍", suggestion: "User may need transport or mechanical help. Approach if safe." },
  { id: "health", label: "Health Crisis", icon: "💊", suggestion: "Person may need medication or medical attention. Ask before administering any help." },
  { id: "other", label: "Other Emergency", icon: "🆘", suggestion: "Assess the situation carefully before providing help." },
] as const;

export type SOSTagId = typeof SOS_TAGS[number]["id"];

export interface SOSAlertFull extends SOSAlert {
  tag?: SOSTagId;
  voice_note_url?: string;
  message?: string;
}

// =====================================================
// DM / MESSAGING TYPES
// =====================================================

export interface Conversation {
  id: string;
  created_at: string;
  updated_at: string;
  last_message_text: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  // Joined data
  participant?: ConversationParticipant;
  other_user?: VIPUser;
  unread_count?: number;
}

export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  user_id: string;
  joined_at: string;
  is_muted: boolean;
  is_blocked: boolean;
  last_read_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  content_type: "text" | "media" | "document" | "post_share" | "system";
  metadata: Record<string, any>;
  is_deleted: boolean;
  created_at: string;
  edited_at: string | null;
  // Joined data
  sender?: VIPUser;
  media?: MessageMediaItem[];
  // Read receipt states: "sent" | "delivered" | "read"
  delivery_status?: "sent" | "delivered" | "read";
  read_at?: string | null;
  // For delete-for-me
  hidden_for_me?: boolean;
}

export interface MessageMediaItem {
  id: string;
  message_id: string;
  url: string;
  media_type: "image" | "video" | "document" | "audio";
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

export interface MessageRead {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string;
}

export interface VIPUser {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  is_vip: boolean;
  is_admin?: boolean;
  is_guardian?: boolean;
  last_seen_at?: string | null;
  status?: string;
  is_online?: boolean;
}

export interface DMBlock {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export interface MessageDeletion {
  id: string;
  message_id: string;
  user_id: string;
  created_at: string;
}