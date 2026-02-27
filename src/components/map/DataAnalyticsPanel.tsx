"use client";

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/types";
import { 
  X, Search, MapPin, TrendingUp, ChevronRight, Loader2, 
  ArrowLeft, Clock, Calendar, BarChart3, PieChart, AlertTriangle 
} from "lucide-react";

interface Hotspot {
  area: string;
  count: number;
  incidents: Record<string, number>;
  mostCommon: string;
  lat: number;
  lng: number;
  timeBreakdown: Record<string, number>;
  dayBreakdown: Record<string, number>;
  recentIncidents: Array<{
    id: string;
    category: string;
    address: string;
    created_at: string;
  }>;
}

interface DataAnalyticsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectArea: (lat: number, lng: number) => void;
}

export default function DataAnalyticsPanel({ isOpen, onClose, onSelectArea }: DataAnalyticsPanelProps) {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedHotspot, setSelectedHotspot] = useState<Hotspot | null>(null);

  // Lock body scroll when panel is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${window.scrollY}px`;
    } else {
      const scrollY = document.body.style.top;
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
      window.scrollTo(0, parseInt(scrollY || '0') * -1);
    }

    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
    };
  }, [isOpen]);

    // Register with back button system
  useEffect(() => {
    if (isOpen) {
      (window as any).__pejaAnalyticsOpen = true;
    } else {
      (window as any).__pejaAnalyticsOpen = false;
    }
    return () => {
      (window as any).__pejaAnalyticsOpen = false;
    };
  }, [isOpen]);

  // Listen for back button close event
  useEffect(() => {
    const handleBackClose = () => {
      if (selectedHotspot) {
        setSelectedHotspot(null);
      } else {
        onClose();
      }
    };
    window.addEventListener("peja-close-analytics", handleBackClose);
    return () => window.removeEventListener("peja-close-analytics", handleBackClose);
  }, [selectedHotspot, onClose]);

  useEffect(() => {
    if (isOpen && hotspots.length === 0) {
      fetchAllIncidents();
    }
  }, [isOpen]);

  const fetchAllIncidents = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("posts")
        .select("id, category, address, latitude, longitude, created_at")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .not("address", "is", null)
        .order("created_at", { ascending: false })
        .limit(2000);

      if (error) throw error;

      // Group by area
      const areaMap: Record<string, { 
        count: number; 
        incidents: Record<string, number>; 
        latSum: number;
        lngSum: number;
        timeBreakdown: Record<string, number>;
        dayBreakdown: Record<string, number>;
        recentIncidents: Array<{
          id: string;
          category: string;
          address: string;
          created_at: string;
        }>;
      }> = {};

      const getTimeSlot = (dateStr: string): string => {
        const hour = new Date(dateStr).getHours();
        if (hour >= 0 && hour < 6) return "Night (12am-6am)";
        if (hour >= 6 && hour < 12) return "Morning (6am-12pm)";
        if (hour >= 12 && hour < 18) return "Afternoon (12pm-6pm)";
        return "Evening (6pm-12am)";
      };

      const getDayOfWeek = (dateStr: string): string => {
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        return days[new Date(dateStr).getDay()];
      };

      (data || []).forEach((post: any) => {
        if (!post.address) return;
        
        const areaParts = post.address.split(",").slice(0, 2);
        const area = areaParts.map((p: string) => p.trim()).join(", ");
        
        if (!areaMap[area]) {
          areaMap[area] = { 
            count: 0, 
            incidents: {}, 
            latSum: 0,
            lngSum: 0,
            timeBreakdown: {},
            dayBreakdown: {},
            recentIncidents: [],
          };
        }
        
        areaMap[area].count++;
        areaMap[area].incidents[post.category] = (areaMap[area].incidents[post.category] || 0) + 1;
        areaMap[area].latSum += post.latitude;
        areaMap[area].lngSum += post.longitude;

        // Time breakdown
        const timeSlot = getTimeSlot(post.created_at);
        areaMap[area].timeBreakdown[timeSlot] = (areaMap[area].timeBreakdown[timeSlot] || 0) + 1;

        // Day breakdown
        const day = getDayOfWeek(post.created_at);
        areaMap[area].dayBreakdown[day] = (areaMap[area].dayBreakdown[day] || 0) + 1;

        // Store recent incidents (max 10)
        if (areaMap[area].recentIncidents.length < 10) {
          areaMap[area].recentIncidents.push({
            id: post.id,
            category: post.category,
            address: post.address,
            created_at: post.created_at,
          });
        }
      });

      const sortedHotspots: Hotspot[] = Object.entries(areaMap)
        .map(([area, data]) => {
          const mostCommon = Object.entries(data.incidents)
            .sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
          
          return {
            area,
            count: data.count,
            incidents: data.incidents,
            mostCommon,
            lat: data.latSum / data.count,
            lng: data.lngSum / data.count,
            timeBreakdown: data.timeBreakdown,
            dayBreakdown: data.dayBreakdown,
            recentIncidents: data.recentIncidents,
          };
        })
        .sort((a, b) => b.count - a.count);

      setHotspots(sortedHotspots);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  const filteredHotspots = useMemo(() => {
    if (!searchQuery.trim()) return hotspots;
    const query = searchQuery.toLowerCase();
    return hotspots.filter(h => h.area.toLowerCase().includes(query));
  }, [hotspots, searchQuery]);

  const getCategoryInfo = (categoryId: string) => {
    return CATEGORIES.find(c => c.id === categoryId) || { name: categoryId, color: "info" };
  };

  const getColorClass = (color: string) => {
    switch (color) {
      case "danger": return "text-red-400 bg-red-500/20";
      case "warning": return "text-orange-400 bg-orange-500/20";
      case "awareness": return "text-yellow-400 bg-yellow-500/20";
      default: return "text-blue-400 bg-blue-500/20";
    }
  };

  const getRankColor = (index: number) => {
    if (index === 0) return "bg-red-500/20 text-red-400 border-red-500/30";
    if (index === 1) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    if (index === 2) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    return "bg-dark-700 text-dark-400 border-dark-600";
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const handleCloseDetails = () => {
    setSelectedHotspot(null);
  };

  if (!isOpen) return null;

  // Detail View
  if (selectedHotspot) {
    const categoryInfo = getCategoryInfo(selectedHotspot.mostCommon);
    const sortedIncidents = Object.entries(selectedHotspot.incidents).sort((a, b) => b[1] - a[1]);
    const sortedTimes = Object.entries(selectedHotspot.timeBreakdown).sort((a, b) => b[1] - a[1]);
    const sortedDays = Object.entries(selectedHotspot.dayBreakdown).sort((a, b) => b[1] - a[1]);
    const peakTime = sortedTimes[0]?.[0] || "N/A";
    const peakDay = sortedDays[0]?.[0] || "N/A";

    return (
      <div className="fixed inset-0 z-[5000] flex items-start justify-center overflow-hidden">
        <div className="absolute inset-0 bg-black/70" onClick={handleCloseDetails} />
        
        <div
          className="relative glass-strong w-full h-full max-w-lg overflow-hidden flex flex-col"
          style={{ paddingTop: "var(--cap-status-bar-height, 0px)" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-white/10 shrink-0">
            <button
              onClick={handleCloseDetails}
              className="w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5 text-dark-300" />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-white truncate">{selectedHotspot.area}</h2>
              <p className="text-xs text-dark-400">{selectedHotspot.count} total incidents</p>
            </div>
            <button
              onClick={() => {
                onSelectArea(selectedHotspot.lat, selectedHotspot.lng);
                onClose();
              }}
              className="px-3 py-2 bg-primary-600 text-white text-sm rounded-lg font-medium"
            >
              View Map
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="glass-sm rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-xs text-dark-400">Most Common</span>
                </div>
                <p className="font-semibold text-white">{categoryInfo.name}</p>
                <p className="text-xs text-dark-500">{selectedHotspot.incidents[selectedHotspot.mostCommon]} incidents</p>
              </div>
              
              <div className="glass-sm rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-primary-400" />
                  <span className="text-xs text-dark-400">Peak Time</span>
                </div>
                <p className="font-semibold text-white text-sm">{peakTime}</p>
                <p className="text-xs text-dark-500">{sortedTimes[0]?.[1] || 0} incidents</p>
              </div>
              
              <div className="glass-sm rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-green-400" />
                  <span className="text-xs text-dark-400">Peak Day</span>
                </div>
                <p className="font-semibold text-white">{peakDay}</p>
                <p className="text-xs text-dark-500">{sortedDays[0]?.[1] || 0} incidents</p>
              </div>
              
              <div className="glass-sm rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="w-4 h-4 text-orange-400" />
                  <span className="text-xs text-dark-400">Risk Level</span>
                </div>
                <p className={`font-semibold ${
                  selectedHotspot.count >= 20 ? "text-red-400" :
                  selectedHotspot.count >= 10 ? "text-orange-400" :
                  selectedHotspot.count >= 5 ? "text-yellow-400" :
                  "text-green-400"
                }`}>
                  {selectedHotspot.count >= 20 ? "High" :
                   selectedHotspot.count >= 10 ? "Medium" :
                   selectedHotspot.count >= 5 ? "Low" : "Very Low"}
                </p>
              </div>
            </div>

            {/* Incident Types Chart */}
            <div className="glass-sm rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <PieChart className="w-5 h-5 text-primary-400" />
                <h3 className="font-semibold text-white">Incident Types</h3>
              </div>
              <div className="space-y-2">
                {sortedIncidents.map(([category, count]) => {
                  const info = getCategoryInfo(category);
                  const percentage = Math.round((count / selectedHotspot.count) * 100);
                  return (
                    <div key={category} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-dark-200">{info.name}</span>
                        <span className="text-dark-400">{count} ({percentage}%)</span>
                      </div>
                      <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            info.color === "danger" ? "bg-red-500" :
                            info.color === "warning" ? "bg-orange-500" :
                            info.color === "awareness" ? "bg-yellow-500" :
                            "bg-blue-500"
                          }`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Time Analysis Chart */}
            <div className="glass-sm rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-5 h-5 text-primary-400" />
                <h3 className="font-semibold text-white">Time Analysis</h3>
              </div>
              <div className="space-y-2">
                {["Morning (6am-12pm)", "Afternoon (12pm-6pm)", "Evening (6pm-12am)", "Night (12am-6am)"].map(timeSlot => {
                  const count = selectedHotspot.timeBreakdown[timeSlot] || 0;
                  const maxCount = Math.max(...Object.values(selectedHotspot.timeBreakdown), 1);
                  const percentage = Math.round((count / maxCount) * 100);
                  return (
                    <div key={timeSlot} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-dark-200">{timeSlot}</span>
                        <span className="text-dark-400">{count}</span>
                      </div>
                      <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full rounded-full bg-primary-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Day Analysis */}
            <div className="glass-sm rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-5 h-5 text-primary-400" />
                <h3 className="font-semibold text-white">Day Analysis</h3>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => {
                  const fullDay = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i];
                  const count = selectedHotspot.dayBreakdown[fullDay] || 0;
                  const maxCount = Math.max(...Object.values(selectedHotspot.dayBreakdown), 1);
                  const intensity = count / maxCount;
                  return (
                    <div key={day} className="text-center">
                      <div 
                        className={`w-full aspect-square rounded-lg flex items-center justify-center text-xs font-medium mb-1 ${
                          intensity > 0.7 ? "bg-red-500/40 text-red-300" :
                          intensity > 0.4 ? "bg-orange-500/30 text-orange-300" :
                          intensity > 0.1 ? "bg-yellow-500/20 text-yellow-300" :
                          "bg-dark-700 text-dark-500"
                        }`}
                      >
                        {count}
                      </div>
                      <span className="text-xs text-dark-500">{day}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent Incidents */}
            <div className="glass-sm rounded-xl p-4">
              <h3 className="font-semibold text-white mb-3">Recent Incidents</h3>
              <div className="space-y-2">
                {selectedHotspot.recentIncidents.slice(0, 5).map(incident => {
                  const info = getCategoryInfo(incident.category);
                  return (
                    <div key={incident.id} className="flex items-center gap-3 p-2 bg-white/5 rounded-lg">
                      <div className={`px-2 py-1 rounded text-xs font-medium ${getColorClass(info.color)}`}>
                        {info.name}
                      </div>
                      <span className="text-xs text-dark-400 flex-1 truncate">
                        {formatDate(incident.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // List View
  return (
    <div className="fixed inset-0 z-[5000] flex items-start justify-center overflow-hidden">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      
      <div
        className="relative glass-strong w-full h-full max-w-lg overflow-hidden flex flex-col"
        style={{ paddingTop: "var(--cap-status-bar-height, 0px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-primary-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Incident Hotspots</h2>
              <p className="text-xs text-dark-400">All-time data • {hotspots.length} areas</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-lg text-dark-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-white/10 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
            <input
              type="text"
              placeholder="Search areas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 glass-input text-sm"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            </div>
          ) : filteredHotspots.length === 0 ? (
            <div className="text-center py-12">
              <MapPin className="w-12 h-12 text-dark-600 mx-auto mb-3" />
              <p className="text-dark-400">No incidents found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredHotspots.map((hotspot, index) => {
                const categoryInfo = getCategoryInfo(hotspot.mostCommon);
                
                return (
                  <div
                    key={hotspot.area}
                    onClick={() => setSelectedHotspot(hotspot)}
                    className="glass-sm rounded-xl p-3 cursor-pointer hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {/* Rank */}
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold border ${getRankColor(index)}`}>
                        {index + 1}
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white truncate">{hotspot.area}</p>
                        <p className="text-xs text-dark-400">
                          Most common: <span className={`${
                            categoryInfo.color === "danger" ? "text-red-400" :
                            categoryInfo.color === "warning" ? "text-orange-400" :
                            categoryInfo.color === "awareness" ? "text-yellow-400" :
                            "text-blue-400"
                          }`}>{categoryInfo.name}</span>
                        </p>
                      </div>
                      
                      {/* Count */}
                      <div className="text-right mr-2">
                        <p className="text-lg font-bold text-primary-400">{hotspot.count}</p>
                        <p className="text-xs text-dark-500">incidents</p>
                      </div>
                      
                      <ChevronRight className="w-4 h-4 text-dark-400" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}