"use client";

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/types";
import { X, Search, MapPin, TrendingUp, ChevronRight, Loader2 } from "lucide-react";

interface Hotspot {
  area: string;
  count: number;
  incidents: Record<string, number>;
  mostCommon: string;
  lat: number;
  lng: number;
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
  const [expandedArea, setExpandedArea] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchAllIncidents();
    }
  }, [isOpen]);

  const fetchAllIncidents = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("posts")
        .select("id, category, address, latitude, longitude")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .not("address", "is", null)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) throw error;

      // Group by area (first 2 parts of address)
      const areaMap: Record<string, { 
        count: number; 
        incidents: Record<string, number>; 
        lat: number; 
        lng: number;
        latSum: number;
        lngSum: number;
      }> = {};

      (data || []).forEach((post: any) => {
        if (!post.address) return;
        
        const areaParts = post.address.split(",").slice(0, 2);
        const area = areaParts.map((p: string) => p.trim()).join(", ");
        
        if (!areaMap[area]) {
          areaMap[area] = { 
            count: 0, 
            incidents: {}, 
            lat: 0, 
            lng: 0,
            latSum: 0,
            lngSum: 0
          };
        }
        
        areaMap[area].count++;
        areaMap[area].incidents[post.category] = (areaMap[area].incidents[post.category] || 0) + 1;
        areaMap[area].latSum += post.latitude;
        areaMap[area].lngSum += post.longitude;
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
          };
        })
        .sort((a, b) => b.count - a.count);

      setHotspots(sortedHotspots);
    } catch (err) {
      console.error("Error fetching incidents:", err);
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
      case "danger": return "text-red-400";
      case "warning": return "text-orange-400";
      case "awareness": return "text-yellow-400";
      default: return "text-blue-400";
    }
  };

  const handleAreaClick = (hotspot: Hotspot) => {
    onSelectArea(hotspot.lat, hotspot.lng);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      
      <div className="relative glass-strong rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
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
            className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-lg text-dark-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-white/10">
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
                const isExpanded = expandedArea === hotspot.area;
                const categoryInfo = getCategoryInfo(hotspot.mostCommon);
                
                return (
                  <div
                    key={hotspot.area}
                    className="glass-sm rounded-xl overflow-hidden"
                  >
                    {/* Main row */}
                    <div 
                      className="p-3 flex items-center gap-3 cursor-pointer hover:bg-white/5"
                      onClick={() => setExpandedArea(isExpanded ? null : hotspot.area)}
                    >
                      {/* Rank */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                        index === 0 ? "bg-red-500/20 text-red-400" :
                        index === 1 ? "bg-orange-500/20 text-orange-400" :
                        index === 2 ? "bg-yellow-500/20 text-yellow-400" :
                        "bg-dark-700 text-dark-400"
                      }`}>
                        {index + 1}
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white truncate">{hotspot.area}</p>
                        <p className="text-xs text-dark-400">
                          Most common: <span className={getColorClass(categoryInfo.color)}>{categoryInfo.name}</span>
                        </p>
                      </div>
                      
                      {/* Count */}
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary-400">{hotspot.count}</p>
                        <p className="text-xs text-dark-500">incidents</p>
                      </div>
                      
                      <ChevronRight className={`w-4 h-4 text-dark-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </div>
                    
                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-white/5">
                        <p className="text-xs text-dark-400 mb-2">Breakdown:</p>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {Object.entries(hotspot.incidents)
                            .sort((a, b) => b[1] - a[1])
                            .map(([category, count]) => {
                              const info = getCategoryInfo(category);
                              return (
                                <span 
                                  key={category} 
                                  className={`px-2 py-1 rounded-lg text-xs ${
                                    info.color === "danger" ? "bg-red-500/20 text-red-400" :
                                    info.color === "warning" ? "bg-orange-500/20 text-orange-400" :
                                    info.color === "awareness" ? "bg-yellow-500/20 text-yellow-400" :
                                    "bg-blue-500/20 text-blue-400"
                                  }`}
                                >
                                  {info.name}: {count}
                                </span>
                              );
                            })}
                        </div>
                        
                        <button
                          onClick={() => handleAreaClick(hotspot)}
                          className="w-full py-2 bg-primary-600/20 text-primary-400 rounded-lg text-sm font-medium hover:bg-primary-600/30 transition-colors"
                        >
                          View on Map
                        </button>
                      </div>
                    )}
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