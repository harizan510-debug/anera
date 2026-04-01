import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  Sparkles, CloudSun, Loader2, ChevronLeft, ChevronRight,
  Plus, X, MapPin, FolderOpen, MessageCircle, Check, CalendarDays,
  Wind, Sun, Umbrella, Thermometer, Pencil, Plane,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser, genId, incrementWearCount, loadUser, saveUser } from '../store';
import type { WardrobeItem } from '../types';
import { generateOutfitRecommendations } from '../api';
import { hasClaudeKey } from '../apiHelper';
import { supabase, isSupabaseConfigured, getCityWeather, getWeatherByCoords, getWeatherByIP } from '../supabase';
import type { WeatherInfo } from '../supabase';


// ── Types ─────────────────────────────────────────────────────────────────────

type OutfitsTab = 'outfits' | 'trips' | 'moodboard';

interface OutfitLog  { id: string; date: string; itemIds: string[]; occasion: string; }
interface CalEvent   { id: string; date: string; title: string; color: string; source: 'manual' | 'google'; }
type TripSeason = 'Spring' | 'Summer' | 'Autumn' | 'Winter';
interface Trip       { id: string; destination: string; startDate: string; endDate: string; season?: TripSeason; }
interface MoodPin    { id: string; imageUrl: string; folderId: string; note: string; }
interface MoodFolder { id: string; name: string; color: string; }
interface GeneratedOutfit { items: WardrobeItem[]; note: string; }

// ── Constants ─────────────────────────────────────────────────────────────────

const OCCASIONS = ['Everyday', 'Work', 'Casual', 'Date night', 'Weekend', 'Travel', 'Formal', 'Gym'];
const WEATHERS  = ['Hot (25°C+)', 'Warm (18-24°C)', 'Mild (12-17°C)', 'Cool (6-11°C)', 'Cold (<5°C)', 'Rainy'];
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const EVENT_COLORS = ['#8B7355','#C5CEAE','#F0DEB4','#7B8FA3','#C47860','#5C7A52','#5C3D2E','#9F5A4A'];
const TRIP_SEASONS: TripSeason[] = ['Spring', 'Summer', 'Autumn', 'Winter'];
const SEASON_EMOJI: Record<TripSeason, string> = { Spring: '🌸', Summer: '☀️', Autumn: '🍂', Winter: '❄️' };
const TRIP_CAL_COLOR = '#B8A080'; // warm brown for trip indicators on calendar
const DEFAULT_FOLDERS: MoodFolder[] = [
  { id: 'f_inspo',   name: 'Inspo',   color: '#8B7355' },
  { id: 'f_minimal', name: 'Minimal', color: '#C5CEAE' },
  { id: 'f_bold',    name: 'Bold',    color: '#F0DEB4' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function tempToWeatherChip(temp: number, isRainy: boolean): string {
  if (isRainy)    return 'Rainy';
  if (temp >= 25) return 'Hot (25°C+)';
  if (temp >= 18) return 'Warm (18-24°C)';
  if (temp >= 12) return 'Mild (12-17°C)';
  if (temp >= 6)  return 'Cool (6-11°C)';
  return 'Cold (<5°C)';
}

function padDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayStr(): string { return new Date().toISOString().slice(0, 10); }

function fmtShortDate(s: string): string {
  return new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

// ── useLS hook ────────────────────────────────────────────────────────────────

function useLS<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : init;
    } catch { return init; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(v)); }, [key, v]);
  return [v, setV] as const;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Outfits() {
  const { user } = useUser();
  const navigate = useNavigate();
  const wardrobeItems = user.wardrobeItems;

  const [tab, setTab] = useState<OutfitsTab>('outfits');

  // Outfit generation
  const [occasion, setOccasion]   = useState('Everyday');
  const [weather,  setWeather]    = useState('Mild (12-17°C)');
  const [outfits,  setOutfits]    = useState<GeneratedOutfit[]>([]);
  const [loading,  setLoading]    = useState(false);
  const [genError, setGenError]   = useState('');
  const [weatherInfo, setWeatherInfo] = useState<WeatherInfo | null>(null);
  const [weatherCity, setWeatherCity] = useState('');
  const [weatherLoading, setWeatherLoading] = useState(true);

  // Dress-me slots
  const [slotTop,        setSlotTop]        = useState<WardrobeItem | null>(null);
  const [slotBottom,     setSlotBottom]     = useState<WardrobeItem | null>(null);
  const [slotFootwear,   setSlotFootwear]   = useState<WardrobeItem | null>(null);
  const [slotOuterwear,  setSlotOuterwear]  = useState<WardrobeItem | null>(null);
  const [slotAccessories, setSlotAccessories] = useState<WardrobeItem[]>([]);
  type SlotKey = 'top' | 'bottom' | 'footwear' | 'outerwear' | 'accessory';
  const [pickingSlot,    setPickingSlot]    = useState<SlotKey | null>(null);
  const [accSubTab,      setAccSubTab]      = useState<'jewellery' | 'bag' | 'belt' | 'hat'>('jewellery');

  // Calendar
  const now = new Date();
  const [calYear,  setCalYear]  = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [logs,      setLogs]      = useLS<OutfitLog[]>('anera_outfit_logs', []);
  const [calEvents, setCalEvents] = useLS<CalEvent[]>('anera_cal_events',   []);

  // Day modal
  const [selectedDay,     setSelectedDay]     = useState<string | null>(null);
  const [dayItemIds,      setDayItemIds]       = useState<string[]>([]);
  const [showItemPicker,  setShowItemPicker]   = useState(false);
  const [showAddEvent,    setShowAddEvent]     = useState(false);
  const [newEventTitle,   setNewEventTitle]    = useState('');
  const [newEventColor,   setNewEventColor]    = useState(EVENT_COLORS[0]);

  // Trips
  const [trips,       setTrips]       = useLS<Trip[]>('anera_trips', []);
  const [showAddTrip, setShowAddTrip] = useState(false);
  const [tripDest,    setTripDest]    = useState('');
  const [tripStart,   setTripStart]   = useState('');
  const [tripEnd,     setTripEnd]     = useState('');
  const [tripSeason,  setTripSeason]  = useState<TripSeason | ''>('');
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);

  // Moodboard
  const [folders,         setFolders]         = useLS<MoodFolder[]>('anera_mood_folders', DEFAULT_FOLDERS);
  const [pins,            setPins]             = useLS<MoodPin[]>('anera_mood_pins', []);
  const [activeFolder,    setActiveFolder]     = useState('all');
  const [showAddPin,      setShowAddPin]       = useState(false);
  const [showAddFolder,   setShowAddFolder]    = useState(false);
  const [pinUrl,          setPinUrl]           = useState('');
  const [pinNote,         setPinNote]          = useState('');
  const [pinFolder,       setPinFolder]        = useState(DEFAULT_FOLDERS[0].id);
  const [folderName,      setFolderName]       = useState('');
  const [folderColor,     setFolderColor]      = useState(EVENT_COLORS[0]);

  // One-time migration: reconcile wear counts from existing outfit logs
  // Reads directly from localStorage to avoid any hook timing issues
  useEffect(() => {
    const MIGRATION_KEY = 'anera_wear_count_migrated_v2';
    if (localStorage.getItem(MIGRATION_KEY)) return;
    try {
      const rawLogs = localStorage.getItem('anera_outfit_logs');
      const savedLogs: OutfitLog[] = rawLogs ? JSON.parse(rawLogs) : [];
      if (savedLogs.length === 0) return;
      // Count how many times each item appears across all logs
      const counts: Record<string, number> = {};
      savedLogs.forEach(log => log.itemIds.forEach(id => { counts[id] = (counts[id] || 0) + 1; }));
      // Update wardrobe items via store
      const user = loadUser();
      let changed = false;
      user.wardrobeItems.forEach(item => {
        const loggedCount = counts[item.id] || 0;
        if (loggedCount > item.wearCount) {
          item.wearCount = loggedCount;
          item.lastWorn = item.lastWorn || new Date().toISOString();
          changed = true;
        }
      });
      if (changed) {
        saveUser(user);
        localStorage.setItem(MIGRATION_KEY, '1');
        window.location.reload();
        return;
      }
    } catch { /* ignore parse errors */ }
    localStorage.setItem(MIGRATION_KEY, '1');
  }, []);

  // Weather on mount — try geolocation → profile city → IP geolocation
  useEffect(() => {
    let cancelled = false;

    const applyWeather = (info: WeatherInfo) => {
      if (cancelled) return;
      setWeatherInfo(info);
      setWeatherCity(info.cityName);
      setWeather(tempToWeatherChip(info.temp, info.isRainy));
      setWeatherLoading(false);
    };

    const fetchFromIP = async () => {
      try {
        const info = await getWeatherByIP();
        if (info && !cancelled) { applyWeather(info); return; }
      } catch { /* ignore */ }
      if (!cancelled) setWeatherLoading(false);
    };

    const fetchFromProfile = async () => {
      if (!isSupabaseConfigured) { fetchFromIP(); return; }
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser || cancelled) { fetchFromIP(); return; }
        const { data: profile } = await supabase
          .from('profiles').select('city').eq('id', authUser.id).single();
        if (!profile?.city || cancelled) { fetchFromIP(); return; }
        const info = await getCityWeather(profile.city);
        if (info) { applyWeather(info); return; }
      } catch { /* ignore */ }
      fetchFromIP();
    };

    // Try browser geolocation first
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const info = await getWeatherByCoords(pos.coords.latitude, pos.coords.longitude);
          if (info) {
            applyWeather(info);
          } else {
            fetchFromProfile();
          }
        },
        () => {
          // Geolocation denied or failed — fall back to profile city, then IP
          fetchFromProfile();
        },
        { timeout: 8000, maximumAge: 300000 }
      );
    } else {
      fetchFromProfile();
    }

    return () => { cancelled = true; };
  }, []);

  // Calendar derived values
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDow    = new Date(calYear, calMonth, 1).getDay();
  const today       = todayStr();

  // Trip lookup for calendar
  const tripOnDate = (ds: string): Trip | undefined =>
    trips.find(t => ds >= t.startDate && ds <= t.endDate);

  const prevMonth = () => calMonth === 0
    ? (setCalYear(y => y - 1), setCalMonth(11))
    : setCalMonth(m => m - 1);
  const nextMonth = () => calMonth === 11
    ? (setCalYear(y => y + 1), setCalMonth(0))
    : setCalMonth(m => m + 1);

  const openDay = (d: string) => {
    setDayItemIds(logs.find(l => l.date === d)?.itemIds ?? []);
    setShowItemPicker(false);
    setShowAddEvent(false);
    setNewEventTitle('');
    setSelectedDay(d);
  };

  const saveDayLog = () => {
    if (!selectedDay) return;
    // Find which items are newly added (not in previous log for this day)
    const prevLog = logs.find(l => l.date === selectedDay);
    const prevIds = new Set(prevLog?.itemIds || []);
    const newIds = dayItemIds.filter(id => !prevIds.has(id));
    // Increment wear count for newly logged items
    newIds.forEach(id => incrementWearCount(id));
    setLogs(prev => {
      const rest = prev.filter(l => l.date !== selectedDay);
      return dayItemIds.length === 0
        ? rest
        : [...rest, { id: genId(), date: selectedDay, itemIds: dayItemIds, occasion }];
    });
    setSelectedDay(null);
  };

  const addCalEvent = () => {
    if (!selectedDay || !newEventTitle.trim()) return;
    setCalEvents(prev => [...prev, {
      id: genId(), date: selectedDay,
      title: newEventTitle.trim(), color: newEventColor, source: 'manual',
    }]);
    setNewEventTitle('');
    setShowAddEvent(false);
  };

  // Outfit generation
  const generate = async () => {
    if (wardrobeItems.length < 2) { setGenError('Add at least 2 items to your wardrobe first.'); return; }
    setGenError(''); setLoading(true);
    try {
      const wCtx = weatherInfo
        ? `${weather} — ${weatherInfo.temp}°C (feels ${weatherInfo.feelsLike}°C), ${weatherInfo.description}, wind ${weatherInfo.windSpeed}km/h, UV ${weatherInfo.uvIndex}${weatherInfo.isRainy ? `. Rain: ${weatherInfo.rainMm}mm.` : ''}`
        : weather;
      const noteParts = [
        slotTop        ? `Top: ${slotTop.color} ${slotTop.subcategory}`               : null,
        slotBottom     ? `Bottom: ${slotBottom.color} ${slotBottom.subcategory}`       : null,
        slotFootwear   ? `Footwear: ${slotFootwear.color} ${slotFootwear.subcategory}` : null,
        slotOuterwear  ? `Outerwear: ${slotOuterwear.color} ${slotOuterwear.subcategory}` : null,
        ...slotAccessories.map(a => `Accessory: ${a.color} ${a.subcategory}`),
      ].filter((s): s is string => s !== null);
      const styleNotes = noteParts.length > 0 ? noteParts.join(', ') : undefined;

      if (hasClaudeKey()) {
        const result = await generateOutfitRecommendations(wardrobeItems, occasion, wCtx, styleNotes);
        setOutfits(result.outfits.map(o => ({
          items: o.items.map(id => wardrobeItems.find(w => w.id === id)).filter(Boolean) as WardrobeItem[],
          note: o.note,
        })).filter(o => o.items.length > 0));
      } else {
        await new Promise(r => setTimeout(r, 900));
        const tops    = wardrobeItems.filter(i => i.category === 'top' || i.category === 'dress');
        const bottoms = wardrobeItems.filter(i => i.category === 'bottom');
        const shoes   = wardrobeItems.filter(i => i.category === 'footwear');
        const demo: GeneratedOutfit[] = [];
        for (let i = 0; i < Math.min(3, Math.max(1, tops.length)); i++) {
          const outfit: WardrobeItem[] = [];
          if (slotTop)           outfit.push(slotTop);
          else if (tops[i])      outfit.push(tops[i]);
          if (slotBottom)                          outfit.push(slotBottom);
          else if (bottoms.length)                 outfit.push(bottoms[i % bottoms.length]);
          if (slotFootwear)                        outfit.push(slotFootwear);
          else if (shoes.length)                   outfit.push(shoes[i % shoes.length]);
          if (slotOuterwear) outfit.push(slotOuterwear);
          slotAccessories.forEach(a => outfit.push(a));
          if (outfit.length > 0) demo.push({
            items: outfit,
            note: `Perfect for ${occasion.toLowerCase()} in ${weather.toLowerCase()} weather.${weatherInfo?.isRainy ? ' ☂️ Grab an umbrella!' : ''}`,
          });
        }
        setOutfits(demo);
      }
    } catch { setGenError('Could not generate outfits. Check your API key.'); }
    setLoading(false);
  };

  const ACC_CATS = ['jewellery', 'bag', 'belt', 'hat'] as const;
  const slotPool = (slot: SlotKey) =>
    slot === 'top'       ? wardrobeItems.filter(i => i.category === 'top' || i.category === 'dress')
    : slot === 'bottom'  ? wardrobeItems.filter(i => i.category === 'bottom')
    : slot === 'footwear'? wardrobeItems.filter(i => i.category === 'footwear')
    : slot === 'outerwear' ? wardrobeItems.filter(i => i.category === 'outerwear')
    :                     wardrobeItems.filter(i => ACC_CATS.includes(i.category as typeof ACC_CATS[number]));

  const pickSlot = (item: WardrobeItem) => {
    if (pickingSlot === 'top')        { setSlotTop(item); setPickingSlot(null); }
    if (pickingSlot === 'bottom')     { setSlotBottom(item); setPickingSlot(null); }
    if (pickingSlot === 'footwear')   { setSlotFootwear(item); setPickingSlot(null); }
    if (pickingSlot === 'outerwear')  { setSlotOuterwear(item); setPickingSlot(null); }
    if (pickingSlot === 'accessory') {
      // Toggle: add if not present, remove if already selected
      setSlotAccessories(prev =>
        prev.some(a => a.id === item.id)
          ? prev.filter(a => a.id !== item.id)
          : [...prev, item]
      );
      // Don't close the modal — let user pick multiple
    }
  };

  const clearSlot = (slot: SlotKey) => {
    if (slot === 'top')        setSlotTop(null);
    if (slot === 'bottom')     setSlotBottom(null);
    if (slot === 'footwear')   setSlotFootwear(null);
    if (slot === 'outerwear')  setSlotOuterwear(null);
    if (slot === 'accessory')  setSlotAccessories([]);
  };

  const removeAccessory = (id: string) => {
    setSlotAccessories(prev => prev.filter(a => a.id !== id));
  };

  // Trips
  const addTrip = () => {
    if (!tripDest.trim() || !tripStart || !tripEnd) return;
    setTrips(prev => [...prev, { id: genId(), destination: tripDest.trim(), startDate: tripStart, endDate: tripEnd, season: tripSeason || undefined }]);
    setTripDest(''); setTripStart(''); setTripEnd(''); setTripSeason('');
    setShowAddTrip(false);
  };

  const openEditTrip = (trip: Trip) => {
    setEditingTrip(trip);
    setTripDest(trip.destination);
    setTripStart(trip.startDate);
    setTripEnd(trip.endDate);
    setTripSeason(trip.season || '');
  };

  const saveEditTrip = () => {
    if (!editingTrip || !tripDest.trim() || !tripStart || !tripEnd) return;
    setTrips(prev => prev.map(t => t.id === editingTrip.id
      ? { ...t, destination: tripDest.trim(), startDate: tripStart, endDate: tripEnd, season: tripSeason || undefined }
      : t
    ));
    setEditingTrip(null);
    setTripDest(''); setTripStart(''); setTripEnd(''); setTripSeason('');
  };

  const closeEditTrip = () => {
    setEditingTrip(null);
    setTripDest(''); setTripStart(''); setTripEnd(''); setTripSeason('');
  };

  const tripItems = (trip: Trip): WardrobeItem[] => {
    const ids = new Set(
      logs.filter(l => l.date >= trip.startDate && l.date <= trip.endDate).flatMap(l => l.itemIds)
    );
    return Array.from(ids).map(id => wardrobeItems.find(w => w.id === id)).filter((w): w is WardrobeItem => !!w);
  };

  // Moodboard
  const addPin = () => {
    if (!pinUrl.trim()) return;
    setPins(prev => [...prev, { id: genId(), imageUrl: pinUrl.trim(), folderId: pinFolder, note: pinNote }]);
    setPinUrl(''); setPinNote(''); setShowAddPin(false);
  };

  const addFolder = () => {
    if (!folderName.trim()) return;
    const f: MoodFolder = { id: genId(), name: folderName.trim(), color: folderColor };
    setFolders(prev => [...prev, f]);
    setActiveFolder(f.id); setPinFolder(f.id);
    setFolderName(''); setShowAddFolder(false);
  };

  const visiblePins = activeFolder === 'all' ? pins : pins.filter(p => p.folderId === activeFolder);

  // Slot rows config (single-item slots only — accessories rendered separately)
  const slotRows: { slot: SlotKey; label: string; item: WardrobeItem | null }[] = [
    { slot: 'top',        label: 'Top',         item: slotTop },
    { slot: 'bottom',     label: 'Bottom',      item: slotBottom },
    { slot: 'footwear',   label: 'Footwear',    item: slotFootwear },
    { slot: 'outerwear',  label: 'Outerwear',   item: slotOuterwear },
  ];

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <div className="pb-4" style={{ background: '#F5F0EB', minHeight: '100vh' }}>
      <div className="px-4 flex items-start justify-between mb-5 pt-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#2B2B2B', letterSpacing: '-0.5px' }}>
            Outfits
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(43,43,43,0.45)' }}>
            Plan, dress, and get inspired
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 px-4 mb-5">
        {(['outfits', 'trips', 'moodboard'] as OutfitsTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2.5 rounded-full text-xs font-semibold transition-all"
            style={{
              background: tab === t ? '#8B7355' : 'transparent',
              color:      tab === t ? '#FFFFFF' : '#2B2B2B',
              border:     `1.5px solid ${tab === t ? '#8B7355' : 'rgba(43,43,43,0.12)'}`,
            }}
          >
            {t === 'outfits' ? 'Outfits' : t === 'trips' ? 'My Trips' : 'Moodboard'}
          </button>
        ))}
      </div>

      {/* ══════ TAB 1: OUTFITS ══════ */}
      {tab === 'outfits' && (
        <div className="px-4 space-y-5">

          {/* Weather loading skeleton */}
          {weatherLoading && !weatherInfo && (
            <div
              className="rounded-2xl overflow-hidden animate-pulse"
              style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
            >
              <div className="px-4 pt-4 pb-3 flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-3 w-20 rounded-full" style={{ background: '#E5E7EB' }} />
                  <div className="h-9 w-24 rounded-lg" style={{ background: '#E5E7EB' }} />
                  <div className="h-3 w-32 rounded-full" style={{ background: '#E5E7EB' }} />
                </div>
                <div className="w-12 h-12 rounded-full" style={{ background: '#E5E7EB' }} />
              </div>
              <div className="px-4 py-3 flex gap-6" style={{ borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                <div className="h-3 w-16 rounded-full" style={{ background: '#E5E7EB' }} />
                <div className="h-3 w-16 rounded-full" style={{ background: '#E5E7EB' }} />
                <div className="h-3 w-16 rounded-full" style={{ background: '#E5E7EB' }} />
              </div>
            </div>
          )}

          {/* Enhanced Weather Widget */}
          {weatherInfo && (
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
            >
              {/* Top section: city + main temp + icon */}
              <div className="px-4 pt-4 pb-3 flex items-center justify-between">
                <div>
                  {weatherCity && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <MapPin size={12} color="#8B7355" />
                      <span className="text-xs font-semibold" style={{ color: '#8B7355' }}>{weatherCity}</span>
                    </div>
                  )}
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold" style={{ color: 'var(--text-primary)', lineHeight: 1 }}>{weatherInfo.temp}°</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>C</span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {weatherInfo.description}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Thermometer size={11} color="var(--text-secondary)" />
                    <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      Feels like {weatherInfo.feelsLike}°C
                    </span>
                  </div>
                </div>
                <span className="text-5xl flex-shrink-0">{weatherInfo.icon}</span>
              </div>

              {/* Bottom stats row */}
              <div
                className="px-4 py-2.5 flex items-center justify-between"
                style={{ borderTop: '1px solid rgba(107,124,78,0.1)', background: 'rgba(107,124,78,0.04)' }}
              >
                {/* Wind */}
                <div className="flex items-center gap-1.5">
                  <Wind size={14} color="#8B7355" />
                  <div>
                    <p className="text-[10px] font-medium uppercase" style={{ color: 'var(--text-secondary)', letterSpacing: '0.3px' }}>Wind</p>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{weatherInfo.windSpeed} km/h</p>
                  </div>
                </div>

                {/* Rain + umbrella */}
                <div className="flex items-center gap-1.5">
                  <Umbrella size={14} color={weatherInfo.isRainy ? '#DC2626' : '#9CA3AF'} />
                  <div>
                    <p className="text-[10px] font-medium uppercase" style={{ color: 'var(--text-secondary)', letterSpacing: '0.3px' }}>Rain</p>
                    <p className="text-xs font-semibold" style={{ color: weatherInfo.isRainy ? '#DC2626' : 'var(--text-primary)' }}>
                      {weatherInfo.rainMm > 0 ? `${weatherInfo.rainMm} mm` : '0 mm'}
                    </p>
                  </div>
                </div>

                {/* UV */}
                <div className="flex items-center gap-1.5">
                  <Sun size={14} color={weatherInfo.uvIndex >= 6 ? '#F59E0B' : '#8B7355'} />
                  <div>
                    <p className="text-[10px] font-medium uppercase" style={{ color: 'var(--text-secondary)', letterSpacing: '0.3px' }}>UV</p>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {weatherInfo.uvIndex} {weatherInfo.uvIndex <= 2 ? 'Low' : weatherInfo.uvIndex <= 5 ? 'Mod' : weatherInfo.uvIndex <= 7 ? 'High' : 'V.High'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Occasion + Weather + Dress me ── */}
          <div>
            {/* Occasion */}
            <p className="font-bold uppercase mb-2" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>Occasion</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {OCCASIONS.map(occ => (
                <button key={occ} onClick={() => setOccasion(occ)}
                  className="px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all"
                  style={{
                    background: occasion === occ ? '#8B7355' : 'transparent',
                    color:      occasion === occ ? '#FFFFFF' : '#2B2B2B',
                    border:     `1.5px solid ${occasion === occ ? '#8B7355' : 'rgba(43,43,43,0.12)'}`,
                  }}>{occ}</button>
              ))}
            </div>

            {/* Weather chips */}
            <p className="font-bold uppercase mb-2 flex items-center gap-1.5" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>
              <CloudSun size={11} /> Weather
            </p>
            <div className="flex flex-wrap gap-2 mb-5">
              {WEATHERS.map(w => (
                <button key={w} onClick={() => setWeather(w)}
                  className="px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all"
                  style={{
                    background: weather === w ? '#8B7355' : 'transparent',
                    color:      weather === w ? '#FFFFFF' : '#2B2B2B',
                    border:     `1.5px solid ${weather === w ? '#8B7355' : 'rgba(43,43,43,0.12)'}`,
                  }}>{w}</button>
              ))}
            </div>

            {/* Dress me button */}
            <button onClick={generate} disabled={loading}
              className="w-full py-3.5 rounded-full font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              style={{ background: '#8B7355', color: '#FFFFFF' }}>
              {loading
                ? <><Loader2 size={18} className="animate-spin" /> Styling…</>
                : <><Sparkles size={18} /> {outfits.length > 0 ? 'Dress me again' : 'Dress me'}</>}
            </button>
          </div>

          {/* ── Dress me slots ── */}
          <div>
            <p className="font-bold uppercase mb-3" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>
              Build your outfit
            </p>

            <div className="flex gap-4 mb-4 items-start">
              {/* Avatar silhouette */}
              <div className="flex-shrink-0 w-[60px] flex justify-center pt-1">
                <svg viewBox="0 0 60 128" fill="none" className="w-full h-auto">
                  <circle cx="30" cy="13" r="11" fill="#E5E7EB" />
                  <path d="M12 42 Q18 28 30 28 Q42 28 48 42 L52 84 L8 84 Z" fill="#D1D5DB" />
                  <path d="M12 42 L4 72 L13 74 L17 48" fill="#D1D5DB" />
                  <path d="M48 42 L56 72 L47 74 L43 48" fill="#D1D5DB" />
                  <rect x="9"  y="84" width="18" height="40" rx="5" fill="#9CA3AF" />
                  <rect x="33" y="84" width="18" height="40" rx="5" fill="#9CA3AF" />
                </svg>
              </div>

              {/* Slots */}
              <div className="flex-1 space-y-2">
                {slotRows.map(({ slot, label, item }) => (
                  <div
                    key={slot}
                    className="flex items-center gap-2 px-3 py-2 rounded-2xl cursor-pointer active:scale-[0.98] transition-transform"
                    style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
                    onClick={() => setPickingSlot(slot)}
                  >
                    {item ? (
                      <>
                        <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
                          {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-sm opacity-40">👕</div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium capitalize truncate" style={{ color: 'var(--text-primary)' }}>
                            {item.color} {item.subcategory}
                          </p>
                          <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{label}</p>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); clearSlot(slot); }}
                          className="p-1 rounded-full flex-shrink-0"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: 'var(--accent-light)' }}>
                          <Plus size={16} style={{ color: '#8B7355' }} />
                        </div>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Add {label}</p>
                      </>
                    )}
                  </div>
                ))}

                {/* Accessories — multi-select */}
                <div
                  className="rounded-2xl overflow-hidden"
                  style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
                >
                  {slotAccessories.length > 0 ? (
                    <div className="px-3 py-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-secondary)', letterSpacing: '0.4px' }}>
                          Accessories ({slotAccessories.length})
                        </p>
                        <div className="flex gap-1.5">
                          <button onClick={() => setPickingSlot('accessory')}
                            className="p-1 rounded-full" style={{ color: '#8B7355' }}>
                            <Plus size={12} />
                          </button>
                          <button onClick={() => setSlotAccessories([])}
                            className="p-1 rounded-full" style={{ color: 'var(--text-secondary)' }}>
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                      {slotAccessories.map(acc => (
                        <div key={acc.id} className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0">
                            {acc.imageUrl ? <img src={acc.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-[10px] opacity-40">👕</div>}
                          </div>
                          <p className="flex-1 text-[11px] font-medium capitalize truncate" style={{ color: 'var(--text-primary)' }}>
                            {acc.color} {acc.subcategory}
                          </p>
                          <button onClick={() => removeAccessory(acc.id)}
                            className="p-0.5 rounded-full flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer active:scale-[0.98] transition-transform"
                      onClick={() => setPickingSlot('accessory')}
                    >
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: 'var(--accent-light)' }}>
                        <Plus size={16} style={{ color: '#8B7355' }} />
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Add Accessories</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Calendar ── */}
          <div className="rounded-2xl overflow-hidden" style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(43,43,43,0.06)' }}>
              <button onClick={prevMonth} className="p-1.5 rounded-xl" style={{ color: 'rgba(43,43,43,0.45)' }}>
                <ChevronLeft size={16} />
              </button>
              <div className="flex items-center gap-2">
                <CalendarDays size={14} style={{ color: '#8B7355' }} />
                <span className="text-sm font-semibold" style={{ color: '#2B2B2B', letterSpacing: '-0.3px' }}>
                  {MONTH_NAMES[calMonth]} {calYear}
                </span>
              </div>
              <button onClick={nextMonth} className="p-1.5 rounded-xl" style={{ color: 'rgba(43,43,43,0.45)' }}>
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Day headings */}
            <div className="grid grid-cols-7 px-3 pt-3">
              {['S','M','T','W','T','F','S'].map((d, i) => (
                <div key={i} className="text-center text-[10px] font-semibold uppercase pb-2" style={{ color: 'rgba(43,43,43,0.45)', letterSpacing: '0.5px' }}>{d}</div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 px-3 pb-3 gap-y-1">
              {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const d   = i + 1;
                const ds  = padDate(calYear, calMonth, d);
                const isToday = ds === today;
                const hasLog  = logs.some(l => l.date === ds);
                const evts    = calEvents.filter(e => e.date === ds);
                const inTrip  = tripOnDate(ds);
                return (
                  <button
                    key={d}
                    onClick={() => openDay(ds)}
                    className="flex flex-col items-center py-1.5 rounded-full transition-all active:scale-95"
                    style={{
                      background: isToday ? '#8B7355' : inTrip ? 'rgba(139,115,85,0.12)' : 'transparent',
                    }}
                  >
                    <span className={`text-[11px] leading-none mb-0.5 ${isToday ? 'font-semibold' : 'font-medium'}`}
                      style={{ color: isToday ? '#FFFFFF' : inTrip ? '#8B7355' : '#2B2B2B' }}>
                      {d}
                    </span>
                    <div className="flex gap-0.5 justify-center min-h-[6px]">
                      {hasLog && <span className="w-1.5 h-1.5 rounded-full" style={{ background: isToday ? 'white' : '#34D399' }} />}
                      {inTrip && !isToday && <span className="w-1.5 h-1.5 rounded-full" style={{ background: TRIP_CAL_COLOR }} />}
                      {evts.slice(0, 2).map(e => (
                        <span key={e.id} className="w-1.5 h-1.5 rounded-full" style={{ background: isToday ? 'white' : e.color }} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex gap-4 px-4 pb-3 pt-2 flex-wrap" style={{ borderTop: '1px solid rgba(43,43,43,0.06)' }}>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#34D399' }} />
                <span className="text-[10px] font-medium" style={{ color: 'rgba(43,43,43,0.45)' }}>Outfit logged</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#8B7355' }} />
                <span className="text-[10px] font-medium" style={{ color: 'rgba(43,43,43,0.45)' }}>Event</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: TRIP_CAL_COLOR }} />
                <span className="text-[10px] font-medium" style={{ color: 'rgba(43,43,43,0.45)' }}>Trip</span>
              </div>
            </div>
          </div>

          {genError && (
            <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: '#FEE2E2', color: '#DC2626' }}>{genError}</div>
          )}

          {wardrobeItems.length === 0 && !loading && (
            <div className="rounded-2xl px-5 py-8 flex flex-col items-center text-center"
              style={{ border: '1.5px dashed rgba(43,43,43,0.12)' }}>
              <div className="text-4xl mb-3">👗</div>
              <p className="font-semibold text-sm mb-1" style={{ color: '#2B2B2B' }}>Your wardrobe is empty</p>
              <p className="text-xs" style={{ color: 'rgba(43,43,43,0.45)' }}>Add items to your wardrobe first.</p>
            </div>
          )}

          {/* Generated outfits */}
          {outfits.map((outfit, idx) => (
            <div key={idx} className="rounded-2xl overflow-hidden"
              style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(43,43,43,0.06)' }}>
                <p className="font-semibold text-sm" style={{ color: '#2B2B2B', letterSpacing: '-0.2px' }}>Look {idx + 1}</p>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
                  style={{ background: '#C5CEAE', color: '#2B2B2B' }}>{occasion}</span>
              </div>
              <div className="flex gap-2 p-3">
                {outfit.items.map(item => (
                  <div key={item.id} className="flex-1 min-w-0">
                    <div className="aspect-square rounded-xl overflow-hidden mb-1" style={{ background: 'var(--bg)' }}>
                      {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt={item.subcategory} /> : <div className="w-full h-full flex items-center justify-center text-xl opacity-40">👕</div>}
                    </div>
                    <p className="text-[10px] text-center truncate capitalize" style={{ color: 'var(--text-secondary)' }}>
                      {item.subcategory}
                    </p>
                  </div>
                ))}
              </div>
              {outfit.note && (
                <div className="px-4 pb-4">
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>💡 {outfit.note}</p>
                </div>
              )}
            </div>
          ))}

          {/* Ask Anera CTA */}
          <button onClick={() => navigate('/ask')}
            className="w-full py-3.5 rounded-full flex items-center justify-center gap-2 font-semibold text-sm transition-all active:scale-[0.98]"
            style={{ background: '#F0EBE3', color: '#2B2B2B', border: '1.5px solid #8B7355' }}>
            <MessageCircle size={16} /> Ask Anera anything about style
          </button>
        </div>
      )}

      {/* ══════ TAB 2: MY TRIPS ══════ */}
      {tab === 'trips' && (
        <div className="px-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-bold uppercase" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>
              Your trips
            </p>
            <button onClick={() => setShowAddTrip(true)}
              className="flex items-center gap-1 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-[0.97]"
              style={{ background: '#8B7355', color: '#FFFFFF' }}>
              <Plus size={12} /> Add trip
            </button>
          </div>

          {trips.length === 0 && (
            <div className="rounded-2xl py-12 flex flex-col items-center text-center"
              style={{ border: '1.5px dashed rgba(43,43,43,0.12)' }}>
              <div className="text-4xl mb-3">✈️</div>
              <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>No trips yet</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Add a trip to see what you wore.</p>
            </div>
          )}

          {trips.map(trip => {
            const items = tripItems(trip);
            return (
              <div key={trip.id} className="rounded-2xl overflow-hidden"
                style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
                <div className="px-4 pt-4 pb-3 flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <MapPin size={13} style={{ color: '#8B7355' }} />
                      <p className="font-semibold text-sm truncate" style={{ color: '#2B2B2B', letterSpacing: '-0.2px' }}>{trip.destination}</p>
                      {trip.season && (
                        <span className="flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(139,115,85,0.12)', color: '#8B7355' }}>
                          {SEASON_EMOJI[trip.season]} {trip.season}
                        </span>
                      )}
                    </div>
                    <p className="text-xs pl-5" style={{ color: 'var(--text-secondary)' }}>
                      {fmtShortDate(trip.startDate)} – {fmtShortDate(trip.endDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <button onClick={() => openEditTrip(trip)}
                      className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)' }}>
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => setTrips(prev => prev.filter(t => t.id !== trip.id))}
                      className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)' }}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
                {items.length > 0 ? (
                  <div className="px-4 pb-4">
                    <p className="font-bold uppercase mb-2" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>
                      What you wore in {trip.destination}
                    </p>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                      {items.slice(0, 8).map(item => (
                        <div key={item.id} className="flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden"
                          style={{ border: '1px solid rgba(43,43,43,0.06)' }}>
                          {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt={item.subcategory} /> : <div className="w-full h-full flex items-center justify-center text-lg opacity-40">👕</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="px-4 pb-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Log outfits on the calendar during this trip to see them here.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ══════ TAB 3: MOODBOARD ══════ */}
      {tab === 'moodboard' && (
        <div className="px-4">
          {/* Folder chips */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 mb-4">
            <button onClick={() => setActiveFolder('all')}
              className="flex-shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-all"
              style={{
                background: activeFolder === 'all' ? '#8B7355' : 'transparent',
                color:      activeFolder === 'all' ? '#FFFFFF' : '#2B2B2B',
                border:     `1.5px solid ${activeFolder === 'all' ? '#8B7355' : 'rgba(43,43,43,0.12)'}`,
              }}>All</button>

            {folders.map(f => (
              <button key={f.id} onClick={() => setActiveFolder(f.id)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-all"
                style={{
                  background: activeFolder === f.id ? f.color : 'transparent',
                  color:      activeFolder === f.id ? 'white' : '#2B2B2B',
                  border:     `1.5px solid ${activeFolder === f.id ? f.color : 'rgba(43,43,43,0.12)'}`,
                }}>
                <FolderOpen size={11} /> {f.name}
              </button>
            ))}

            <button onClick={() => setShowAddFolder(true)}
              className="flex-shrink-0 flex items-center gap-1 px-3.5 py-1.5 rounded-full text-[11px] font-semibold"
              style={{ border: '1.5px dashed rgba(43,43,43,0.12)', color: 'rgba(43,43,43,0.45)', background: 'transparent' }}>
              <Plus size={11} /> Folder
            </button>
          </div>

          {visiblePins.length === 0 ? (
            <div className="rounded-2xl py-12 flex flex-col items-center text-center"
              style={{ border: '1.5px dashed rgba(43,43,43,0.12)' }}>
              <div className="text-4xl mb-3">📌</div>
              <p className="font-semibold text-sm mb-1" style={{ color: '#2B2B2B' }}>No pins yet</p>
              <p className="text-xs mb-4" style={{ color: 'rgba(43,43,43,0.45)' }}>Save outfit inspiration to your moodboard</p>
              <button onClick={() => setShowAddPin(true)}
                className="px-5 py-2.5 rounded-full text-sm font-semibold transition-all active:scale-[0.97]"
                style={{ background: '#8B7355', color: '#FFFFFF' }}>Add your first pin</button>
            </div>
          ) : (
            <div className="columns-2 gap-3">
              {visiblePins.map(pin => {
                const f = folders.find(x => x.id === pin.folderId);
                return (
                  <div key={pin.id} className="break-inside-avoid mb-3 rounded-2xl overflow-hidden relative"
                    style={{ border: '1px solid rgba(43,43,43,0.06)' }}>
                    <img src={pin.imageUrl} className="w-full object-cover"
                      alt={pin.note || 'Inspiration'}
                      style={{ minHeight: 120 }}
                      onError={e => {
                        const el = e.currentTarget;
                        el.style.display = 'none';
                        const fallback = el.parentElement?.querySelector('.pin-fallback') as HTMLElement | null;
                        if (fallback) fallback.style.display = 'flex';
                      }} />
                    <div className="pin-fallback hidden flex-col items-center justify-center py-8 px-3 text-center" style={{ background: 'var(--surface)', minHeight: 120 }}>
                      <span className="text-2xl mb-2">🖼️</span>
                      <p className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>Image couldn't load</p>
                    </div>
                    {pin.note && (
                      <div className="px-2 py-1.5">
                        <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{pin.note}</p>
                      </div>
                    )}
                    {f && (
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
                        style={{ background: f.color + 'CC' }}>{f.name}</div>
                    )}
                    <button onClick={() => setPins(prev => prev.filter(p => p.id !== pin.id))}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.5)' }}>
                      <X size={10} color="white" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* FAB */}
          <button onClick={() => setShowAddPin(true)}
            className="fixed z-40 w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ bottom: '88px', right: '16px', background: '#8B7355', color: '#FFFFFF', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
            <Plus size={20} />
          </button>
        </div>
      )}

      {/* ══════ MODALS ══════ */}

      {/* Day modal */}
      {selectedDay && (
        <ModalSheet
          onClose={() => setSelectedDay(null)}
          title={new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        >
          {/* Trip banner */}
          {selectedDay && tripOnDate(selectedDay) && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-4"
              style={{ background: 'rgba(139,115,85,0.12)' }}>
              <Plane size={14} style={{ color: '#8B7355' }} />
              <span className="text-xs font-semibold" style={{ color: '#8B7355' }}>
                {tripOnDate(selectedDay)!.destination}
                {tripOnDate(selectedDay)!.season && ` · ${SEASON_EMOJI[tripOnDate(selectedDay)!.season!]} ${tripOnDate(selectedDay)!.season}`}
              </span>
            </div>
          )}

          {/* Outfit log */}
          <div className="mb-5">
            <p className="font-bold uppercase mb-2" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>Outfit</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {dayItemIds.map(id => {
                const item = wardrobeItems.find(w => w.id === id);
                return item ? (
                  <div key={id} className="relative w-14 h-14 rounded-xl overflow-hidden"
                    style={{ border: '1px solid rgba(43,43,43,0.06)' }}>
                    {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-lg opacity-40">👕</div>}
                    <button onClick={() => setDayItemIds(prev => prev.filter(x => x !== id))}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.5)' }}>
                      <X size={8} color="white" />
                    </button>
                  </div>
                ) : null;
              })}
              <button onClick={() => setShowItemPicker(p => !p)}
                className="w-14 h-14 rounded-xl flex items-center justify-center"
                style={{ border: '1.5px dashed rgba(43,43,43,0.12)', color: 'rgba(43,43,43,0.45)' }}>
                <Plus size={18} />
              </button>
            </div>
            {showItemPicker && (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(43,43,43,0.06)', maxHeight: '180px', overflowY: 'auto' }}>
                {wardrobeItems.map(item => (
                  <button key={item.id}
                    onClick={() => setDayItemIds(prev => prev.includes(item.id) ? prev.filter(x => x !== item.id) : [...prev, item.id])}
                    className="w-full flex items-center gap-3 px-3 py-2"
                    style={{ borderBottom: '1px solid rgba(43,43,43,0.06)' }}>
                    <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0">
                      {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs opacity-40">👕</div>}
                    </div>
                    <span className="flex-1 text-xs capitalize text-left" style={{ color: 'var(--text-primary)' }}>
                      {item.color} {item.subcategory}
                    </span>
                    {dayItemIds.includes(item.id) && <Check size={14} style={{ color: '#8B7355' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Events */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <p className="font-bold uppercase" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>Events</p>
              <button onClick={() => setShowAddEvent(p => !p)}
                className="flex items-center gap-1 text-xs font-medium" style={{ color: '#8B7355' }}>
                <Plus size={12} /> Add
              </button>
            </div>
            {calEvents.filter(e => e.date === selectedDay).map(e => (
              <div key={e.id} className="flex items-center gap-2 py-1.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.color }} />
                <span className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>{e.title}</span>
                <button onClick={() => setCalEvents(prev => prev.filter(x => x.id !== e.id))}>
                  <X size={12} style={{ color: 'var(--text-secondary)' }} />
                </button>
              </div>
            ))}
            {calEvents.filter(e => e.date === selectedDay).length === 0 && !showAddEvent && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No events · tap + to add one</p>
            )}
            {showAddEvent && (
              <div className="mt-2 space-y-2">
                <input value={newEventTitle} onChange={e => setNewEventTitle(e.target.value)}
                  placeholder="Event name"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid rgba(43,43,43,0.12)', background: 'var(--surface)' }} />
                <div className="flex gap-2">
                  {EVENT_COLORS.map(c => (
                    <button key={c} onClick={() => setNewEventColor(c)}
                      className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ background: c, outline: newEventColor === c ? `2.5px solid ${c}` : 'none', outlineOffset: '2px' }}>
                      {newEventColor === c && <Check size={11} color="white" />}
                    </button>
                  ))}
                </div>
                <button onClick={addCalEvent} className="w-full py-2.5 rounded-full text-sm font-semibold transition-all active:scale-[0.98]"
                  style={{ background: '#8B7355', color: '#FFFFFF' }}>Save event</button>
                <button
                  onClick={() => alert('Google Calendar sync coming soon! 🗓️')}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  style={{ border: '1.5px solid rgba(43,43,43,0.12)', color: '#2B2B2B' }}>
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Sync Google Calendar
                </button>
              </div>
            )}
          </div>
          <button onClick={saveDayLog} className="w-full py-3.5 rounded-full font-semibold transition-all active:scale-[0.98]"
            style={{ background: '#8B7355', color: '#FFFFFF' }}>Save</button>
        </ModalSheet>
      )}

      {/* Slot picker */}
      {pickingSlot && (
        <ModalSheet onClose={() => setPickingSlot(null)} title={pickingSlot === 'accessory' ? 'Pick Accessories' : `Pick ${pickingSlot}`}>
          <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            {/* Accessory sub-tabs */}
            {pickingSlot === 'accessory' && (
              <div className="flex gap-2 mb-3 pb-2" style={{ borderBottom: '1px solid rgba(43,43,43,0.06)' }}>
                {([
                  { id: 'jewellery' as const, label: '💎 Jewellery' },
                  { id: 'bag'       as const, label: '👜 Bags' },
                  { id: 'belt'      as const, label: '🪢 Belts' },
                  { id: 'hat'       as const, label: '🎩 Hats' },
                ]).map(t => (
                  <button key={t.id} onClick={() => setAccSubTab(t.id)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all"
                    style={{
                      background: accSubTab === t.id ? '#8B7355' : 'transparent',
                      color:      accSubTab === t.id ? '#FFFFFF' : '#2B2B2B',
                      border:     `1.5px solid ${accSubTab === t.id ? '#8B7355' : 'rgba(43,43,43,0.12)'}`,
                    }}>{t.label}</button>
                ))}
              </div>
            )}
            {(() => {
              const pool = pickingSlot === 'accessory'
                ? wardrobeItems.filter(i => i.category === accSubTab)
                : slotPool(pickingSlot);
              return pool.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: 'var(--text-secondary)' }}>
                  No {pickingSlot === 'accessory' ? accSubTab : pickingSlot} items in your wardrobe yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {pool.map(item => {
                    const isSelected = pickingSlot === 'accessory' && slotAccessories.some(a => a.id === item.id);
                    return (
                      <button key={item.id} onClick={() => pickSlot(item)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl active:scale-[0.98] transition-transform"
                        style={{
                          border: isSelected ? '1.5px solid #8B7355' : '1px solid rgba(43,43,43,0.06)',
                          background: isSelected ? 'rgba(107,124,78,0.06)' : 'transparent',
                        }}>
                        <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0">
                          {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xl opacity-40">👕</div>}
                        </div>
                        <div className="flex-1 text-left">
                          <p className="text-sm font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                            {item.color} {item.subcategory}
                          </p>
                          {item.brand && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.brand}</p>}
                        </div>
                        {isSelected && <Check size={16} style={{ color: '#8B7355', flexShrink: 0 }} />}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>
          {/* Done button for accessories */}
          {pickingSlot === 'accessory' && slotAccessories.length > 0 && (
            <button onClick={() => setPickingSlot(null)}
              className="w-full mt-4 py-3 rounded-full font-semibold text-sm transition-all active:scale-[0.98]"
              style={{ background: '#8B7355', color: '#FFFFFF' }}>
              Done ({slotAccessories.length} selected)
            </button>
          )}
        </ModalSheet>
      )}

      {/* Add trip */}
      {showAddTrip && (
        <ModalSheet onClose={() => { setShowAddTrip(false); setTripDest(''); setTripStart(''); setTripEnd(''); setTripSeason(''); }} title="Add trip">
          <div className="space-y-3">
            <input value={tripDest} onChange={e => setTripDest(e.target.value)}
              placeholder="Destination (e.g. New York)"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ border: '1px solid rgba(43,43,43,0.12)', background: 'var(--surface)' }} />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="font-bold uppercase block mb-1" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>From</label>
                <input type="date" value={tripStart} onChange={e => setTripStart(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid rgba(43,43,43,0.12)', background: 'var(--surface)' }} />
              </div>
              <div className="flex-1">
                <label className="font-bold uppercase block mb-1" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>To</label>
                <input type="date" value={tripEnd} onChange={e => setTripEnd(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid rgba(43,43,43,0.12)', background: 'var(--surface)' }} />
              </div>
            </div>
            <div>
              <label className="font-bold uppercase block mb-1.5" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>Season</label>
              <div className="flex gap-2">
                {TRIP_SEASONS.map(s => (
                  <button key={s} onClick={() => setTripSeason(tripSeason === s ? '' : s)}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all active:scale-[0.97]"
                    style={{
                      background: tripSeason === s ? '#8B7355' : 'var(--surface)',
                      color: tripSeason === s ? '#FFFFFF' : 'var(--text-secondary)',
                      border: `1px solid ${tripSeason === s ? '#8B7355' : 'rgba(43,43,43,0.12)'}`,
                    }}>
                    {SEASON_EMOJI[s]} {s}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={addTrip} className="w-full py-3.5 rounded-full font-semibold transition-all active:scale-[0.98]"
              style={{ background: '#8B7355', color: '#FFFFFF' }}>Save trip</button>
          </div>
        </ModalSheet>
      )}

      {/* Edit trip */}
      {editingTrip && (
        <ModalSheet onClose={closeEditTrip} title="Edit trip">
          <div className="space-y-3">
            <input value={tripDest} onChange={e => setTripDest(e.target.value)}
              placeholder="Destination (e.g. New York)"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ border: '1px solid rgba(43,43,43,0.12)', background: 'var(--surface)' }} />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="font-bold uppercase block mb-1" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>From</label>
                <input type="date" value={tripStart} onChange={e => setTripStart(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid rgba(43,43,43,0.12)', background: 'var(--surface)' }} />
              </div>
              <div className="flex-1">
                <label className="font-bold uppercase block mb-1" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>To</label>
                <input type="date" value={tripEnd} onChange={e => setTripEnd(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid rgba(43,43,43,0.12)', background: 'var(--surface)' }} />
              </div>
            </div>
            <div>
              <label className="font-bold uppercase block mb-1.5" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>Season</label>
              <div className="flex gap-2">
                {TRIP_SEASONS.map(s => (
                  <button key={s} onClick={() => setTripSeason(tripSeason === s ? '' : s)}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all active:scale-[0.97]"
                    style={{
                      background: tripSeason === s ? '#8B7355' : 'var(--surface)',
                      color: tripSeason === s ? '#FFFFFF' : 'var(--text-secondary)',
                      border: `1px solid ${tripSeason === s ? '#8B7355' : 'rgba(43,43,43,0.12)'}`,
                    }}>
                    {SEASON_EMOJI[s]} {s}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={saveEditTrip} className="w-full py-3.5 rounded-full font-semibold transition-all active:scale-[0.98]"
              style={{ background: '#8B7355', color: '#FFFFFF' }}>Save changes</button>
          </div>
        </ModalSheet>
      )}

      {/* Add pin */}
      {showAddPin && (
        <ModalSheet onClose={() => { setShowAddPin(false); setPinUrl(''); setPinNote(''); }} title="Pin inspiration">
          <div className="space-y-3">
            {/* Upload from device */}
            <div>
              <label className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold cursor-pointer transition-all active:scale-[0.98]"
                style={{ border: '1.5px dashed rgba(43,43,43,0.2)', color: 'var(--text-secondary)' }}>
                📷 Upload from device
                <input type="file" accept="image/*" className="hidden" onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => { if (typeof reader.result === 'string') setPinUrl(reader.result); };
                  reader.readAsDataURL(file);
                }} />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: 'rgba(43,43,43,0.1)' }} />
              <span className="text-[10px] font-semibold uppercase" style={{ color: 'rgba(43,43,43,0.35)' }}>or</span>
              <div className="flex-1 h-px" style={{ background: 'rgba(43,43,43,0.1)' }} />
            </div>
            <input value={pinUrl.startsWith('data:') ? '✓ Image uploaded' : pinUrl} onChange={e => setPinUrl(e.target.value)}
              placeholder="Paste direct image URL (.jpg, .png)"
              readOnly={pinUrl.startsWith('data:')}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ border: '1px solid rgba(43,43,43,0.12)', background: 'var(--surface)' }} />
            {pinUrl && (
              <div className="relative rounded-xl overflow-hidden" style={{ border: '1px solid rgba(43,43,43,0.08)', maxHeight: 160 }}>
                <img src={pinUrl} className="w-full object-cover" style={{ maxHeight: 160 }} alt="Preview"
                  onError={e => { e.currentTarget.style.display = 'none'; }} />
              </div>
            )}
            <input value={pinNote} onChange={e => setPinNote(e.target.value)}
              placeholder="Note (optional)"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ border: '1px solid rgba(43,43,43,0.12)', background: 'var(--surface)' }} />
            <div>
              <p className="font-bold uppercase mb-2" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', letterSpacing: '0.8px' }}>Save to folder</p>
              <div className="flex gap-2 flex-wrap">
                {folders.map(f => (
                  <button key={f.id} onClick={() => setPinFolder(f.id)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-semibold"
                    style={{
                      background: pinFolder === f.id ? f.color : 'transparent',
                      color:      pinFolder === f.id ? 'white' : '#2B2B2B',
                      border:     `1.5px solid ${pinFolder === f.id ? f.color : 'rgba(43,43,43,0.12)'}`,
                    }}>{f.name}</button>
                ))}
              </div>
            </div>
            <button onClick={addPin} className="w-full py-3.5 rounded-full font-semibold transition-all active:scale-[0.98]"
              style={{ background: '#8B7355', color: '#FFFFFF' }}>Pin it</button>
          </div>
        </ModalSheet>
      )}

      {/* Add folder */}
      {showAddFolder && (
        <ModalSheet onClose={() => setShowAddFolder(false)} title="New folder">
          <div className="space-y-3">
            <input value={folderName} onChange={e => setFolderName(e.target.value)}
              placeholder="Folder name"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ border: '1px solid rgba(43,43,43,0.12)', background: 'var(--surface)' }} />
            <div className="flex gap-2">
              {EVENT_COLORS.map(c => (
                <button key={c} onClick={() => setFolderColor(c)}
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: c, outline: folderColor === c ? `2.5px solid ${c}` : 'none', outlineOffset: '2px' }}>
                  {folderColor === c && <Check size={14} color="white" />}
                </button>
              ))}
            </div>
            <button onClick={addFolder} className="w-full py-3.5 rounded-full font-semibold transition-all active:scale-[0.98]"
              style={{ background: '#8B7355', color: '#FFFFFF' }}>Create folder</button>
          </div>
        </ModalSheet>
      )}
    </div>
  );
}

// ── ModalSheet ────────────────────────────────────────────────────────────────

function ModalSheet({ onClose, title, children }: { onClose: () => void; title: string; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end pb-16"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full rounded-t-3xl pt-5 px-5 pb-6"
        style={{ background: '#FFFFFF', maxHeight: 'calc(90vh - 4rem)', overflowY: 'auto' }}
      >
        <div className="flex items-center justify-between mb-5">
          <p className="font-bold text-base" style={{ color: '#2B2B2B', letterSpacing: '-0.3px' }}>{title}</p>
          <button onClick={onClose} className="p-1 rounded-full" style={{ color: 'rgba(43,43,43,0.45)' }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
