import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  Sparkles, CloudSun, Loader2, ChevronLeft, ChevronRight,
  Plus, X, MapPin, FolderOpen, MessageCircle, Check, CalendarDays,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser, genId } from '../store';
import type { WardrobeItem } from '../types';
import { generateOutfitRecommendations } from '../api';
import { supabase, isSupabaseConfigured, getCityWeather } from '../supabase';
import type { WeatherInfo } from '../supabase';
import PageHeader from '../components/PageHeader';

// ── Types ─────────────────────────────────────────────────────────────────────

type OutfitsTab = 'outfits' | 'trips' | 'moodboard';

interface OutfitLog  { id: string; date: string; itemIds: string[]; occasion: string; }
interface CalEvent   { id: string; date: string; title: string; color: string; source: 'manual' | 'google'; }
interface Trip       { id: string; destination: string; startDate: string; endDate: string; }
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
const EVENT_COLORS = ['#7C3AED','#DB2777','#2563EB','#059669','#EA580C','#DC2626'];
const DEFAULT_FOLDERS: MoodFolder[] = [
  { id: 'f_inspo',   name: 'Inspo',   color: '#7C3AED' },
  { id: 'f_minimal', name: 'Minimal', color: '#059669' },
  { id: 'f_bold',    name: 'Bold',    color: '#EA580C' },
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

  // Dress-me slots
  const [slotTop,      setSlotTop]      = useState<WardrobeItem | null>(null);
  const [slotBottom,   setSlotBottom]   = useState<WardrobeItem | null>(null);
  const [slotFootwear, setSlotFootwear] = useState<WardrobeItem | null>(null);
  const [pickingSlot,  setPickingSlot]  = useState<'top' | 'bottom' | 'footwear' | null>(null);

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

  // Weather on mount
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    (async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;
      const { data: profile } = await supabase
        .from('profiles').select('city').eq('id', authUser.id).single();
      if (!profile?.city) return;
      setWeatherCity(profile.city);
      const info = await getCityWeather(profile.city);
      if (info) { setWeatherInfo(info); setWeather(tempToWeatherChip(info.temp, info.isRainy)); }
    })();
  }, []);

  // Calendar derived values
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDow    = new Date(calYear, calMonth, 1).getDay();
  const today       = todayStr();

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
        ? `${weather} — ${weatherInfo.temp}°C, ${weatherInfo.description}${weatherInfo.isRainy ? '. Rain forecast.' : ''}`
        : weather;
      const noteParts = [
        slotTop      ? `Top: ${slotTop.color} ${slotTop.subcategory}`           : null,
        slotBottom   ? `Bottom: ${slotBottom.color} ${slotBottom.subcategory}`   : null,
        slotFootwear ? `Footwear: ${slotFootwear.color} ${slotFootwear.subcategory}` : null,
      ].filter((s): s is string => s !== null);
      const styleNotes = noteParts.length > 0 ? noteParts.join(', ') : undefined;

      if (import.meta.env.VITE_ANTHROPIC_API_KEY) {
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

  const slotPool = (slot: 'top' | 'bottom' | 'footwear') =>
    slot === 'top'      ? wardrobeItems.filter(i => i.category === 'top' || i.category === 'dress')
    : slot === 'bottom' ? wardrobeItems.filter(i => i.category === 'bottom')
    :                     wardrobeItems.filter(i => i.category === 'footwear');

  const pickSlot = (item: WardrobeItem) => {
    if (pickingSlot === 'top')      setSlotTop(item);
    if (pickingSlot === 'bottom')   setSlotBottom(item);
    if (pickingSlot === 'footwear') setSlotFootwear(item);
    setPickingSlot(null);
  };

  const clearSlot = (slot: 'top' | 'bottom' | 'footwear') => {
    if (slot === 'top')      setSlotTop(null);
    if (slot === 'bottom')   setSlotBottom(null);
    if (slot === 'footwear') setSlotFootwear(null);
  };

  // Trips
  const addTrip = () => {
    if (!tripDest.trim() || !tripStart || !tripEnd) return;
    setTrips(prev => [...prev, { id: genId(), destination: tripDest.trim(), startDate: tripStart, endDate: tripEnd }]);
    setTripDest(''); setTripStart(''); setTripEnd('');
    setShowAddTrip(false);
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

  // Slot rows config
  const slotRows = [
    { slot: 'top'      as const, label: 'Top',      item: slotTop },
    { slot: 'bottom'   as const, label: 'Bottom',   item: slotBottom },
    { slot: 'footwear' as const, label: 'Footwear', item: slotFootwear },
  ];

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <div className="pb-4">
      <div className="px-4">
        <PageHeader title="Outfits" subtitle="Plan, dress, and get inspired" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1.5 px-4 mb-4">
        {(['outfits', 'trips', 'moodboard'] as OutfitsTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2 rounded-2xl text-xs font-semibold transition-all"
            style={{
              background: tab === t ? 'var(--accent)' : 'var(--surface)',
              color:      tab === t ? 'white' : 'var(--text-secondary)',
              border:     `1px solid ${tab === t ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            {t === 'outfits' ? 'Outfits' : t === 'trips' ? 'My Trips' : 'Moodboard'}
          </button>
        ))}
      </div>

      {/* ══════ TAB 1: OUTFITS ══════ */}
      {tab === 'outfits' && (
        <div className="px-4 space-y-5">

          {/* Weather banner */}
          {weatherInfo && (
            <div
              className="px-4 py-3 rounded-2xl flex items-start gap-3"
              style={{ background: weatherInfo.isRainy ? '#EFF6FF' : 'var(--accent-light)', border: `1px solid ${weatherInfo.isRainy ? '#BFDBFE' : 'var(--border)'}` }}
            >
              <span className="text-xl flex-shrink-0">{weatherInfo.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {weatherInfo.temp}°C · {weatherInfo.description}
                  {weatherCity && <span className="font-normal" style={{ color: 'var(--text-secondary)' }}> in {weatherCity}</span>}
                </p>
                {weatherInfo.isRainy && <p className="text-xs mt-0.5" style={{ color: '#1D4ED8' }}>☂️ Rain forecast — grab an umbrella!</p>}
              </div>
            </div>
          )}

          {/* ── Calendar ── */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <button onClick={prevMonth} className="p-1 rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                <ChevronLeft size={18} />
              </button>
              <div className="flex items-center gap-2">
                <CalendarDays size={14} style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {MONTH_NAMES[calMonth]} {calYear}
                </span>
              </div>
              <button onClick={nextMonth} className="p-1 rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Day headings */}
            <div className="grid grid-cols-7 px-2 pt-2">
              {['S','M','T','W','T','F','S'].map((d, i) => (
                <div key={i} className="text-center text-[10px] font-medium pb-1" style={{ color: 'var(--text-secondary)' }}>{d}</div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 px-2 pb-2 gap-y-0.5">
              {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const d   = i + 1;
                const ds  = padDate(calYear, calMonth, d);
                const isToday = ds === today;
                const hasLog  = logs.some(l => l.date === ds);
                const evts    = calEvents.filter(e => e.date === ds);
                return (
                  <button
                    key={d}
                    onClick={() => openDay(ds)}
                    className="flex flex-col items-center py-1 rounded-xl transition-all active:scale-95"
                    style={{
                      background: isToday ? 'var(--accent-light)' : 'transparent',
                      border: `1.5px solid ${isToday ? 'var(--accent)' : 'transparent'}`,
                    }}
                  >
                    <span className="text-[11px] font-medium leading-none mb-0.5"
                      style={{ color: isToday ? 'var(--accent)' : 'var(--text-primary)' }}>
                      {d}
                    </span>
                    <div className="flex gap-0.5 justify-center min-h-[8px]">
                      {hasLog && <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#34D399' }} />}
                      {evts.slice(0, 2).map(e => (
                        <span key={e.id} className="w-1.5 h-1.5 rounded-full" style={{ background: e.color }} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex gap-4 px-4 pb-3 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#34D399' }} />
                <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Outfit logged</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
                <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Event</span>
              </div>
            </div>
          </div>

          {/* ── Dress me ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-secondary)' }}>
              Dress me
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
                    style={{ border: '1.5px solid var(--border)', background: 'var(--surface)' }}
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
                          <Plus size={16} style={{ color: 'var(--accent)' }} />
                        </div>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Add {label}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Occasion */}
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Occasion</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {OCCASIONS.map(occ => (
                <button key={occ} onClick={() => setOccasion(occ)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={{
                    background: occasion === occ ? 'var(--accent)' : 'var(--surface)',
                    color:      occasion === occ ? 'white' : 'var(--text-secondary)',
                    border:     `1px solid ${occasion === occ ? 'var(--accent)' : 'var(--border)'}`,
                  }}>{occ}</button>
              ))}
            </div>

            {/* Weather */}
            <p className="text-xs font-medium mb-2 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
              <CloudSun size={12} /> Weather
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              {WEATHERS.map(w => (
                <button key={w} onClick={() => setWeather(w)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={{
                    background: weather === w ? '#5B9BD5' : 'var(--surface)',
                    color:      weather === w ? 'white' : 'var(--text-secondary)',
                    border:     `1px solid ${weather === w ? '#5B9BD5' : 'var(--border)'}`,
                  }}>{w}</button>
              ))}
            </div>

            {/* Dress me button */}
            <button onClick={generate} disabled={loading}
              className="w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)' }}>
              {loading
                ? <><Loader2 size={18} className="animate-spin" /> Styling…</>
                : <><Sparkles size={18} /> {outfits.length > 0 ? 'Dress me again' : 'Dress me'}</>}
            </button>
          </div>

          {genError && (
            <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: '#FEE2E2', color: '#DC2626' }}>{genError}</div>
          )}

          {wardrobeItems.length === 0 && !loading && (
            <div className="rounded-2xl px-5 py-8 flex flex-col items-center text-center"
              style={{ border: '1.5px dashed var(--border)' }}>
              <div className="text-4xl mb-3">👗</div>
              <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>Your wardrobe is empty</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Add items to your wardrobe first.</p>
            </div>
          )}

          {/* Generated outfits */}
          {outfits.map((outfit, idx) => (
            <div key={idx} className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>Look {idx + 1}</p>
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--accent-light)', color: 'var(--accent-dark)' }}>{occasion}</span>
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
            className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 font-medium text-sm"
            style={{ background: 'var(--accent-light)', color: 'var(--accent-dark)', border: '1px solid var(--border)' }}>
            <MessageCircle size={16} /> Ask Anera anything about style
          </button>
        </div>
      )}

      {/* ══════ TAB 2: MY TRIPS ══════ */}
      {tab === 'trips' && (
        <div className="px-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
              Your trips
            </p>
            <button onClick={() => setShowAddTrip(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ background: 'var(--accent)' }}>
              <Plus size={12} /> Add trip
            </button>
          </div>

          {trips.length === 0 && (
            <div className="rounded-2xl py-12 flex flex-col items-center text-center"
              style={{ border: '1.5px dashed var(--border)' }}>
              <div className="text-4xl mb-3">✈️</div>
              <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>No trips yet</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Add a trip to see what you wore.</p>
            </div>
          )}

          {trips.map(trip => {
            const items = tripItems(trip);
            return (
              <div key={trip.id} className="rounded-2xl overflow-hidden"
                style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <div className="px-4 pt-4 pb-3 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <MapPin size={13} style={{ color: 'var(--accent)' }} />
                      <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{trip.destination}</p>
                    </div>
                    <p className="text-xs pl-5" style={{ color: 'var(--text-secondary)' }}>
                      {fmtShortDate(trip.startDate)} – {fmtShortDate(trip.endDate)}
                    </p>
                  </div>
                  <button onClick={() => setTrips(prev => prev.filter(t => t.id !== trip.id))}
                    className="p-1" style={{ color: 'var(--text-secondary)' }}>
                    <X size={14} />
                  </button>
                </div>
                {items.length > 0 ? (
                  <div className="px-4 pb-4">
                    <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                      What you wore in {trip.destination}
                    </p>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                      {items.slice(0, 8).map(item => (
                        <div key={item.id} className="flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden"
                          style={{ border: '1px solid var(--border)' }}>
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
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: activeFolder === 'all' ? 'var(--accent)' : 'var(--surface)',
                color:      activeFolder === 'all' ? 'white' : 'var(--text-secondary)',
                border:     `1px solid ${activeFolder === 'all' ? 'var(--accent)' : 'var(--border)'}`,
              }}>All</button>

            {folders.map(f => (
              <button key={f.id} onClick={() => setActiveFolder(f.id)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                style={{
                  background: activeFolder === f.id ? f.color : 'var(--surface)',
                  color:      activeFolder === f.id ? 'white' : 'var(--text-secondary)',
                  border:     `1px solid ${activeFolder === f.id ? f.color : 'var(--border)'}`,
                }}>
                <FolderOpen size={11} /> {f.name}
              </button>
            ))}

            <button onClick={() => setShowAddFolder(true)}
              className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{ border: '1.5px dashed var(--border)', color: 'var(--text-secondary)', background: 'transparent' }}>
              <Plus size={11} /> Folder
            </button>
          </div>

          {visiblePins.length === 0 ? (
            <div className="rounded-2xl py-12 flex flex-col items-center text-center"
              style={{ border: '1.5px dashed var(--border)' }}>
              <div className="text-4xl mb-3">📌</div>
              <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>No pins yet</p>
              <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>Save outfit inspiration to your moodboard</p>
              <button onClick={() => setShowAddPin(true)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white"
                style={{ background: 'var(--accent)' }}>Add your first pin</button>
            </div>
          ) : (
            <div className="columns-2 gap-3">
              {visiblePins.map(pin => {
                const f = folders.find(x => x.id === pin.folderId);
                return (
                  <div key={pin.id} className="break-inside-avoid mb-3 rounded-2xl overflow-hidden relative"
                    style={{ border: '1px solid var(--border)' }}>
                    <img src={pin.imageUrl} className="w-full object-cover"
                      alt={pin.note || 'Inspiration'}
                      onError={e => { e.currentTarget.style.display = 'none'; }} />
                    {pin.note && (
                      <div className="px-2 py-1.5">
                        <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{pin.note}</p>
                      </div>
                    )}
                    {f && (
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium text-white"
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
            className="fixed z-40 w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
            style={{ bottom: '88px', right: '16px', background: 'var(--accent)', color: 'white' }}>
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
          {/* Outfit log */}
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-secondary)' }}>Outfit</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {dayItemIds.map(id => {
                const item = wardrobeItems.find(w => w.id === id);
                return item ? (
                  <div key={id} className="relative w-14 h-14 rounded-xl overflow-hidden"
                    style={{ border: '1px solid var(--border)' }}>
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
                style={{ border: '1.5px dashed var(--border)', color: 'var(--text-secondary)' }}>
                <Plus size={18} />
              </button>
            </div>
            {showItemPicker && (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', maxHeight: '180px', overflowY: 'auto' }}>
                {wardrobeItems.map(item => (
                  <button key={item.id}
                    onClick={() => setDayItemIds(prev => prev.includes(item.id) ? prev.filter(x => x !== item.id) : [...prev, item.id])}
                    className="w-full flex items-center gap-3 px-3 py-2"
                    style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0">
                      {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs opacity-40">👕</div>}
                    </div>
                    <span className="flex-1 text-xs capitalize text-left" style={{ color: 'var(--text-primary)' }}>
                      {item.color} {item.subcategory}
                    </span>
                    {dayItemIds.includes(item.id) && <Check size={14} style={{ color: 'var(--accent)' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Events */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>Events</p>
              <button onClick={() => setShowAddEvent(p => !p)}
                className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--accent)' }}>
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
                  style={{ border: '1px solid var(--border)', background: 'var(--surface)' }} />
                <div className="flex gap-2">
                  {EVENT_COLORS.map(c => (
                    <button key={c} onClick={() => setNewEventColor(c)}
                      className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ background: c, outline: newEventColor === c ? `2.5px solid ${c}` : 'none', outlineOffset: '2px' }}>
                      {newEventColor === c && <Check size={11} color="white" />}
                    </button>
                  ))}
                </div>
                <button onClick={addCalEvent} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'var(--accent)' }}>Save event</button>
                <button
                  onClick={() => alert('Google Calendar sync coming soon! 🗓️')}
                  className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
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
          <button onClick={saveDayLog} className="w-full py-3.5 rounded-2xl font-semibold text-white"
            style={{ background: 'var(--accent)' }}>Save</button>
        </ModalSheet>
      )}

      {/* Slot picker */}
      {pickingSlot && (
        <ModalSheet onClose={() => setPickingSlot(null)} title={`Pick ${pickingSlot}`}>
          <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            {slotPool(pickingSlot).length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: 'var(--text-secondary)' }}>
                No {pickingSlot} items in your wardrobe yet.
              </p>
            ) : (
              <div className="space-y-2">
                {slotPool(pickingSlot).map(item => (
                  <button key={item.id} onClick={() => pickSlot(item)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-2xl active:scale-[0.98] transition-transform"
                    style={{ border: '1px solid var(--border)' }}>
                    <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0">
                      {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xl opacity-40">👕</div>}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                        {item.color} {item.subcategory}
                      </p>
                      {item.brand && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.brand}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ModalSheet>
      )}

      {/* Add trip */}
      {showAddTrip && (
        <ModalSheet onClose={() => setShowAddTrip(false)} title="Add trip">
          <div className="space-y-3">
            <input value={tripDest} onChange={e => setTripDest(e.target.value)}
              placeholder="Destination (e.g. New York)"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ border: '1px solid var(--border)', background: 'var(--surface)' }} />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>From</label>
                <input type="date" value={tripStart} onChange={e => setTripStart(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', background: 'var(--surface)' }} />
              </div>
              <div className="flex-1">
                <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>To</label>
                <input type="date" value={tripEnd} onChange={e => setTripEnd(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', background: 'var(--surface)' }} />
              </div>
            </div>
            <button onClick={addTrip} className="w-full py-3.5 rounded-2xl font-semibold text-white"
              style={{ background: 'var(--accent)' }}>Save trip</button>
          </div>
        </ModalSheet>
      )}

      {/* Add pin */}
      {showAddPin && (
        <ModalSheet onClose={() => setShowAddPin(false)} title="Pin inspiration">
          <div className="space-y-3">
            <input value={pinUrl} onChange={e => setPinUrl(e.target.value)}
              placeholder="Paste image URL"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ border: '1px solid var(--border)', background: 'var(--surface)' }} />
            <input value={pinNote} onChange={e => setPinNote(e.target.value)}
              placeholder="Note (optional)"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ border: '1px solid var(--border)', background: 'var(--surface)' }} />
            <div>
              <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>Save to folder</p>
              <div className="flex gap-2 flex-wrap">
                {folders.map(f => (
                  <button key={f.id} onClick={() => setPinFolder(f.id)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium"
                    style={{
                      background: pinFolder === f.id ? f.color : 'var(--surface)',
                      color:      pinFolder === f.id ? 'white' : 'var(--text-secondary)',
                      border:     `1px solid ${pinFolder === f.id ? f.color : 'var(--border)'}`,
                    }}>{f.name}</button>
                ))}
              </div>
            </div>
            <button onClick={addPin} className="w-full py-3.5 rounded-2xl font-semibold text-white"
              style={{ background: 'var(--accent)' }}>Pin it</button>
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
              style={{ border: '1px solid var(--border)', background: 'var(--surface)' }} />
            <div className="flex gap-2">
              {EVENT_COLORS.map(c => (
                <button key={c} onClick={() => setFolderColor(c)}
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: c, outline: folderColor === c ? `2.5px solid ${c}` : 'none', outlineOffset: '2px' }}>
                  {folderColor === c && <Check size={14} color="white" />}
                </button>
              ))}
            </div>
            <button onClick={addFolder} className="w-full py-3.5 rounded-2xl font-semibold text-white"
              style={{ background: 'var(--accent)' }}>Create folder</button>
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
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full rounded-t-3xl pt-5 px-5 pb-6"
        style={{ background: 'var(--surface)', maxHeight: 'calc(90vh - 4rem)', overflowY: 'auto' }}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{title}</p>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-secondary)' }} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
