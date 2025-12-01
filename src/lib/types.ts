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
  status: "active" | "suspended" | "banned";
  email_verified: boolean;
  phone_verified: boolean;
  created_at: string;
}

export interface Post {
  id: string;
  user_id?: string;
  category: string;
  comment?: string;
  location: {
    latitude: number;
    longitude: number;
  };
  address?: string;
  is_anonymous: boolean;
  status: "live" | "resolved" | "archived";
  is_sensitive: boolean;
  confirmations: number;
  views: number;
  expires_at?: string;
  created_at: string;
  media?: PostMedia[];
  tags?: string[];
  user?: User;
  distance?: number;
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

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: "danger" | "warning" | "info" | "awareness";
  expirySeconds: number;
}

export const CATEGORIES: Category[] = [
  { id: "crime", name: "Crime/Theft", icon: "AlertTriangle", color: "danger", expirySeconds: 86400 },
  { id: "fire", name: "Fire", icon: "Flame", color: "danger", expirySeconds: 86400 },
  { id: "accident", name: "Accident", icon: "Car", color: "danger", expirySeconds: 14400 },
  { id: "police", name: "Police Activity", icon: "Shield", color: "danger", expirySeconds: 43200 },
  { id: "roadwork", name: "Road Work", icon: "Construction", color: "warning", expirySeconds: 604800 },
  { id: "traffic", name: "Traffic Jam", icon: "TrafficCone", color: "warning", expirySeconds: 14400 },
  { id: "outage", name: "Power Outage", icon: "ZapOff", color: "warning", expirySeconds: 21600 },
  { id: "flooding", name: "Flooding", icon: "CloudRain", color: "warning", expirySeconds: 86400 },
  { id: "protest", name: "Protest/March", icon: "Megaphone", color: "awareness", expirySeconds: 43200 },
  { id: "event", name: "Event/Gathering", icon: "Users", color: "awareness", expirySeconds: 43200 },
  { id: "animal", name: "Animal Hazard", icon: "Bug", color: "awareness", expirySeconds: 43200 },
  { id: "noise", name: "Noise/Disturbance", icon: "Volume2", color: "awareness", expirySeconds: 21600 },
  { id: "general", name: "General Alert", icon: "Info", color: "info", expirySeconds: 43200 },
  { id: "closure", name: "Store Closure", icon: "Store", color: "info", expirySeconds: 43200 },
  { id: "transport", name: "Transport Issue", icon: "Bus", color: "info", expirySeconds: 21600 },
];

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun",
  "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
];