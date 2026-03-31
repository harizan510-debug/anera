import { useState } from 'react';
import { RefreshCw, ShoppingBag, Heart, TrendingUp, Award, AlertCircle, Leaf } from 'lucide-react';
import { useUser, deleteWardrobeItem } from '../store';
import type { WardrobeItem } from '../types';
import PageHeader from '../components/PageHeader';

// ── Shared helpers ────────────────────────────────────────────────────────────

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function costPerWear(item: WardrobeItem): number | null {
  if (!item.estimatedValue || !item.wearCount) return null;
  return Math.round((item.estimatedValue / item.wearCount) * 100) / 100;
}

// ── Declutter helpers ─────────────────────────────────────────────────────────

function getDeclutterScore(item: WardrobeItem): number {
  let score = 0;
  if (item.wearCount === 0) score += 40;
  const ds = daysSince(item.lastWorn);
  if (ds > 180) score += 30;
  else if (ds > 90) score += 15;
  else if (ds > 60) score += 5;
  if (item.wearCount < 3) score += 15;
  return Math.min(score, 100);
}

function getScoreLabel(score: number): { label: string; color: string; bg: string } {
  if (score >= 60) return { label: 'Let it go', color: '#DC2626', bg: '#FEE2E2' };
  if (score >= 30) return { label: 'Consider it', color: '#D97706', bg: '#FEF3C7' };
  return { label: 'Keep it', color: '#16A34A', bg: '#DCFCE7' };
}

// ── Plastic / sustainability helpers ─────────────────────────────────────────

const SYNTHETIC_KEYWORDS = [
  'polyester', 'nylon', 'acrylic', 'spandex', 'elastane', 'lycra',
  'polyamide', 'polypropylene', 'pvc', 'vinyl', 'pleather', 'faux leather',
  'microfiber', 'microfibre', 'viscose rayon', 'acetate',
];

const NATURAL_KEYWORDS = [
  'cotton', 'linen', 'silk', 'wool', 'cashmere', 'hemp', 'bamboo',
  'mohair', 'alpaca', 'merino', 'leather', 'suede', 'denim',
  'tweed', 'flannel', 'muslin', 'organza', 'chiffon',
];

// Subcategory keywords that strongly suggest synthetic fibres (fallback when no materials set)
const PLASTIC_SUBCATEGORY_KEYWORDS = [
  'legging', 'yoga', 'cycling short', 'athletic', 'activewear', 'gym',
  'sports bra', 'sports top', 'track pant', 'track suit',
  'swimsuit', 'swimwear', 'bikini', 'swim trunk', 'swimshort',
  'fleece', 'puffer', 'padded jacket', 'padded coat',
  'windbreaker', 'rain jacket', 'raincoat', 'anorak', 'shell jacket',
  'polyester', 'nylon',
];

const PLASTIC_TAGS = new Set([
  'synthetic', 'polyester', 'nylon', 'spandex', 'acrylic', 'elastane',
  'athletic', 'activewear', 'sporty', 'waterproof', 'technical',
]);

function estimatePlastic(item: WardrobeItem): { likely: boolean; reason: string } {
  // 1. If materials field is set, use it as the primary source
  const mat = (item.materials || '').toLowerCase();
  if (mat.length > 0) {
    const hasSynthetic = SYNTHETIC_KEYWORDS.some(kw => mat.includes(kw));
    const hasNatural   = NATURAL_KEYWORDS.some(kw => mat.includes(kw));

    if (hasSynthetic && !hasNatural) {
      const matched = SYNTHETIC_KEYWORDS.find(kw => mat.includes(kw))!;
      return { likely: true, reason: `Contains ${matched}` };
    }
    if (hasSynthetic && hasNatural) {
      // Mixed blend — check if synthetic percentage is dominant
      const synMatch = mat.match(/(\d+)\s*%\s*(polyester|nylon|acrylic|spandex|elastane|lycra|polyamide)/i);
      if (synMatch && parseInt(synMatch[1]) >= 50) {
        return { likely: true, reason: `${synMatch[1]}% ${synMatch[2]} — mostly synthetic` };
      }
      const matched = SYNTHETIC_KEYWORDS.find(kw => mat.includes(kw))!;
      return { likely: true, reason: `Synthetic blend (contains ${matched})` };
    }
    if (hasNatural) {
      const matched = NATURAL_KEYWORDS.find(kw => mat.includes(kw))!;
      return { likely: false, reason: `${matched.charAt(0).toUpperCase() + matched.slice(1)} — natural fibre` };
    }
  }

  // 2. Fallback: guess from subcategory and tags
  const sub  = item.subcategory.toLowerCase();
  const tags = item.tags.map(t => t.toLowerCase());

  for (const kw of PLASTIC_SUBCATEGORY_KEYWORDS) {
    if (sub.includes(kw)) {
      return { likely: true, reason: `${item.subcategory} typically contains synthetic fibres` };
    }
  }
  for (const tag of tags) {
    if (PLASTIC_TAGS.has(tag)) {
      return { likely: true, reason: `Tagged as "${tag}"` };
    }
  }
  return { likely: false, reason: mat ? 'Likely natural fibres' : 'Unknown — add materials to get an accurate result' };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type DeclutterFilter = 'all' | 'high' | 'medium' | 'plastic';
type Action = 'sell' | 'donate' | 'restyle' | null;
interface ItemState { action: Action; dismissed: boolean }

// ── Design tokens ─────────────────────────────────────────────────────────────

const CARD_SHADOW = '0 4px 20px rgba(0,0,0,0.05)';
const LILAC = '#C8B6FF';
const LILAC_DEEP = '#A78BFA';
const MINT = '#B8F2E6';
const BUTTER = '#FFF3B0';

// ── Component ─────────────────────────────────────────────────────────────────

export default function Insights() {
  const { user, refresh } = useUser();
  const items = user.wardrobeItems;

  const [activeTab, setActiveTab]     = useState<'insights' | 'declutter'>('insights');
  const [filter, setFilter]           = useState<DeclutterFilter>('all');
  const [itemStates, setItemStates]   = useState<Record<string, ItemState>>({});

  // ── Declutter actions ──────────────────────────────────────────────────────
  const setAction = (id: string, action: Action) =>
    setItemStates(prev => ({ ...prev, [id]: { ...prev[id], action } }));

  const confirmDelete = (id: string) => {
    deleteWardrobeItem(id);
    refresh();
    setItemStates(prev => ({ ...prev, [id]: { ...prev[id], dismissed: true } }));
  };

  const dismiss = (id: string) =>
    setItemStates(prev => ({ ...prev, [id]: { ...prev[id], dismissed: true } }));

  // ── Shared tab bar ─────────────────────────────────────────────────────────
  const TabBar = () => (
    <div className="flex gap-2 mb-5">
      {(['insights', 'declutter'] as const).map(tab => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className="px-5 py-2 rounded-full text-xs font-semibold transition-all capitalize"
          style={{
            background: activeTab === tab ? LILAC : 'transparent',
            color: activeTab === tab ? '#2B2B2B' : 'var(--text-secondary)',
            border: activeTab === tab ? `1px solid ${LILAC}` : '1px solid rgba(43,43,43,0.12)',
          }}
        >
          {tab === 'insights' ? 'Insights' : 'Declutter'}
        </button>
      ))}
    </div>
  );

  // ── Empty state ────────────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div className="px-4 pb-4">
        <PageHeader title="Insights" subtitle="Your wardrobe intelligence" />
        <TabBar />
        <div
          className="rounded-2xl flex flex-col items-center py-16 text-center"
          style={{ background: '#FFFFFF', border: `1.5px dashed ${LILAC}`, boxShadow: CARD_SHADOW }}
        >
          <div className="text-4xl mb-3">{activeTab === 'insights' ? '📊' : '🧹'}</div>
          <p className="font-medium text-sm mb-1" style={{ color: '#2B2B2B' }}>No data yet</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Add items to your wardrobe first.</p>
        </div>
      </div>
    );
  }

  // ── Insights tab ──────────────────────────────────────────────────────────
  if (activeTab === 'insights') {
    const mostWorn    = [...items].sort((a, b) => b.wearCount - a.wearCount).slice(0, 5);
    const leastWorn   = [...items].sort((a, b) => a.wearCount - b.wearCount)
                          .filter(i => i.wearCount === 0 || daysSince(i.lastWorn) > 60).slice(0, 5);
    const totalWears  = items.reduce((s, i) => s + i.wearCount, 0);
    const unwornCount = items.filter(i => i.wearCount === 0).length;
    const dormantCount = items.filter(i => daysSince(i.lastWorn) > 90).length;

    const categories = ['top', 'bottom', 'footwear', 'outerwear', 'dress', 'bag', 'jewellery', 'belt', 'hat'] as const;
    // Matching colors from Wardrobe page CATEGORY_TAG_COLORS
    const CAT_CHART_COLORS: Record<string, string> = {
      top:       '#7C3AED',  // deep purple
      bottom:    '#3B82F6',  // blue
      footwear:  '#059669',  // teal
      outerwear: '#9F1239',  // burgundy
      dress:     '#DB2777',  // pink
      bag:       '#D97706',  // amber
      jewellery: '#EAB308',  // gold
      belt:      '#6B7C4E',  // olive
      hat:       '#0EA5E9',  // sky blue
    };
    const CAT_CHART_TEXT: Record<string, string> = {
      top:       '#FFFFFF',
      bottom:    '#FFFFFF',
      footwear:  '#FFFFFF',
      outerwear: '#FFFFFF',
      dress:     '#FFFFFF',
      bag:       '#FFFFFF',
      jewellery: '#422006',
      belt:      '#FFFFFF',
      hat:       '#FFFFFF',
    };
    const catCounts  = categories
      .map(c => ({ label: c, count: items.filter(i => i.category === c).length }))
      .filter(c => c.count > 0);

    const withCPW = items
      .filter(i => i.estimatedValue > 0 && i.wearCount > 0)
      .map(i => ({ item: i, cpw: costPerWear(i)! }));
    const bestCPW = withCPW.sort((a, b) => a.cpw - b.cpw)[0];

    // Sustainability score
    const plasticItems  = items.filter(i => estimatePlastic(i).likely);
    const naturalCount  = items.length - plasticItems.length;
    const naturalPct    = Math.round((naturalCount / items.length) * 100);

    return (
      <div className="px-4 pb-4">
        <PageHeader title="Insights" subtitle="Your wardrobe at a glance" />
        <TabBar />

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Items',       value: items.length  },
            { label: 'Total wears', value: totalWears    },
            { label: 'Unworn',      value: unwornCount   },
          ].map(s => (
            <div key={s.label} className="rounded-2xl px-3 py-4 text-center"
              style={{ background: '#FFFFFF', boxShadow: CARD_SHADOW }}>
              <p className="text-2xl font-semibold" style={{ color: '#2B2B2B' }}>{s.value}</p>
              <p className="mt-1" style={{ color: 'rgba(43,43,43,0.45)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Dormant alert */}
        {dormantCount > 0 && (
          <div className="rounded-2xl px-4 py-3 mb-4 flex items-start gap-3"
            style={{ background: BUTTER, border: '1px solid rgba(217,119,6,0.15)', boxShadow: CARD_SHADOW }}>
            <AlertCircle size={18} style={{ color: '#D97706', flexShrink: 0, marginTop: '1px' }} />
            <p className="text-sm" style={{ color: '#92400E' }}>
              <strong>{dormantCount} item{dormantCount > 1 ? 's' : ''}</strong> haven't been worn in 90+ days.{' '}
              <button onClick={() => setActiveTab('declutter')}
                className="underline font-medium" style={{ color: '#D97706' }}>
                Declutter now
              </button>
            </p>
          </div>
        )}

        {/* Sustainability score */}
        <div className="rounded-2xl px-5 py-4 mb-4"
          style={{ background: naturalPct >= 70 ? '#F0FDF4' : '#FFFBEB',
                   border: `1px solid ${naturalPct >= 70 ? 'rgba(22,163,74,0.15)' : 'rgba(217,119,6,0.15)'}`,
                   boxShadow: CARD_SHADOW }}>
          <div className="flex items-center gap-2 mb-3">
            <Leaf size={14} style={{ color: naturalPct >= 70 ? '#15803D' : '#CA8A04' }} />
            <p className="text-sm"
              style={{ color: naturalPct >= 70 ? '#15803D' : '#92400E', fontWeight: 700, letterSpacing: '-0.3px' }}>
              Wardrobe sustainability
            </p>
            <span className="ml-auto text-xs font-bold"
              style={{ color: naturalPct >= 70 ? '#15803D' : '#CA8A04' }}>
              {naturalPct}% natural
            </span>
          </div>
          {/* Bar */}
          <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: '#E5E7EB' }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${naturalPct}%`,
                       background: naturalPct >= 70 ? '#16A34A' : naturalPct >= 40 ? '#CA8A04' : '#DC2626' }} />
          </div>
          <p className="text-xs" style={{ color: naturalPct >= 70 ? '#166534' : '#92400E' }}>
            {naturalCount} of {items.length} items estimated natural fibres
            {plasticItems.length > 0 && (
              <> · <button onClick={() => { setActiveTab('declutter'); setFilter('plastic'); }}
                className="underline font-medium">
                Remove {plasticItems.length} plastic item{plasticItems.length > 1 ? 's' : ''}
              </button></>
            )}
          </p>
        </div>

        {/* Category breakdown — doughnut chart */}
        <div className="rounded-2xl px-4 py-5 mb-4"
          style={{ background: '#FFFFFF', boxShadow: CARD_SHADOW }}>
          <p className="text-sm mb-4" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.3px' }}>Wardrobe breakdown</p>

          <div className="flex items-center">
            {/* SVG doughnut — 50% */}
            <div className="relative" style={{ width: '50%', aspectRatio: '1' }}>
              <svg viewBox="0 0 100 100" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                {(() => {
                  const total = catCounts.reduce((s, c) => s + c.count, 0);
                  const R = 36;
                  const CIRC = 2 * Math.PI * R;
                  const GAP_DEG = 0.7;                      // degrees of gap per segment
                  const GAP = (GAP_DEG / 360) * CIRC;       // gap in stroke units
                  let offset = 0;
                  return catCounts.map(({ label, count }) => {
                    const pct = count / total;
                    const segLen = pct * CIRC;
                    const arcLen = Math.max(segLen - GAP, 1);
                    const segOffset = offset + GAP / 2;      // center the gap
                    const el = (
                      <circle
                        key={label}
                        cx="50" cy="50" r={R}
                        fill="none"
                        stroke={CAT_CHART_COLORS[label] || '#E5E7EB'}
                        strokeWidth="13"
                        strokeDasharray={`${arcLen} ${CIRC - arcLen}`}
                        strokeDashoffset={-segOffset}
                        strokeLinecap="butt"
                        style={{ transition: 'stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease' }}
                      />
                    );
                    offset += segLen;
                    return el;
                  });
                })()}
              </svg>
              {/* Center label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold" style={{ color: '#2B2B2B', lineHeight: 1 }}>{items.length}</span>
                <span className="text-[9px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: 'rgba(43,43,43,0.4)' }}>items</span>
              </div>
            </div>

            {/* Legend — 50% */}
            <div className="w-1/2 pl-3 space-y-1.5">
              {catCounts.map(({ label, count }) => {
                const pct = Math.round((count / items.length) * 100);
                return (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CAT_CHART_COLORS[label] }} />
                    <span className="capitalize text-[11px] flex-1 truncate" style={{ color: '#2B2B2B' }}>{label}s</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                      style={{ background: CAT_CHART_COLORS[label], color: CAT_CHART_TEXT[label] }}>
                      {count} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Most worn — top 5 with cost per wear */}
        {mostWorn.length > 0 && (
          <div className="rounded-2xl px-5 py-4 mb-4"
            style={{ background: '#FFFFFF', boxShadow: CARD_SHADOW }}>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={15} style={{ color: LILAC_DEEP }} />
              <p className="text-sm" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.3px' }}>Most worn items</p>
            </div>
            {mostWorn[0].wearCount === 0 ? (
              <p className="text-xs py-2" style={{ color: 'var(--text-secondary)' }}>
                Log outfits on the calendar to track your most worn items.
              </p>
            ) : (
            <div className="space-y-2">
              {mostWorn.filter(i => i.wearCount > 0).map((item, idx) => {
                const cpw = costPerWear(item);
                const isTop = idx === 0;
                return (
                  <div key={item.id}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                    style={{
                      background: isTop ? 'rgba(167,139,250,0.08)' : 'transparent',
                      border: isTop ? '1px solid rgba(167,139,250,0.18)' : '1px solid transparent',
                    }}>
                    <span className="text-sm font-bold w-5 text-center" style={{ color: isTop ? LILAC_DEEP : 'rgba(43,43,43,0.3)' }}>
                      {idx + 1}
                    </span>
                    <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0" style={{ background: '#FAFAFA', border: '1px solid rgba(43,43,43,0.06)' }}>
                      {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt={item.subcategory} /> : <div className="w-full h-full flex items-center justify-center text-sm opacity-40">👕</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold capitalize truncate" style={{ color: '#2B2B2B' }}>
                        {item.color} {item.subcategory}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {item.wearCount}x worn
                        </span>
                        {cpw !== null && (
                          <>
                            <span className="text-[10px]" style={{ color: 'rgba(43,43,43,0.2)' }}>·</span>
                            <span className="text-[10px] font-semibold px-1.5 py-px rounded-full"
                              style={{ background: cpw <= 5 ? '#DCFCE7' : cpw <= 15 ? '#FEF3C7' : '#FEE2E2',
                                       color: cpw <= 5 ? '#15803D' : cpw <= 15 ? '#92400E' : '#DC2626' }}>
                              £{cpw.toFixed(2)}/wear
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                      style={{ background: isTop ? LILAC_DEEP : LILAC, color: isTop ? '#FFFFFF' : '#5B21B6' }}>
                      {item.wearCount}x
                    </span>
                  </div>
                );
              })}
              {!withCPW.length && (
                <p className="text-[10px] text-center pt-1" style={{ color: 'var(--text-secondary)' }}>
                  💡 Add estimated values to your items to see cost per wear
                </p>
              )}
            </div>
            )}
          </div>
        )}

        {/* Best CPW */}
        {bestCPW && (
          <div className="rounded-2xl px-5 py-4 mb-4 flex items-center gap-4"
            style={{ background: '#FFFFFF', boxShadow: CARD_SHADOW }}>
            <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0">
              {bestCPW.item.imageUrl ? <img src={bestCPW.item.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xl opacity-40">👕</div>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Award size={13} style={{ color: LILAC_DEEP }} />
                <p className="text-xs font-medium" style={{ color: LILAC_DEEP }}>Best cost per wear</p>
              </div>
              <p className="font-semibold text-sm capitalize truncate" style={{ color: '#2B2B2B' }}>
                {bestCPW.item.color} {bestCPW.item.subcategory}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                £{bestCPW.cpw} per wear · worn {bestCPW.item.wearCount}x
              </p>
            </div>
          </div>
        )}

        {/* Gathering dust */}
        {leastWorn.length > 0 && (
          <div className="rounded-2xl px-5 py-4"
            style={{ background: '#FFFFFF', boxShadow: CARD_SHADOW }}>
            <p className="text-sm mb-3" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.3px' }}>Gathering dust</p>
            <div className="space-y-3">
              {leastWorn.map(item => {
                const state = itemStates[item.id];
                if (state?.dismissed) return null;
                return (
                  <div key={item.id} className="rounded-xl overflow-hidden"
                    style={{ border: '1px solid rgba(43,43,43,0.06)' }}>
                    <div className="flex items-center gap-3 p-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0">
                        {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xl opacity-40">👕</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm capitalize truncate" style={{ color: '#2B2B2B', fontWeight: 600 }}>
                          {item.color} {item.subcategory}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {item.wearCount === 0 ? 'Never worn' : `Last worn ${daysSince(item.lastWorn)} days ago`}
                        </p>
                      </div>
                      <span className="text-xs px-2.5 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: '#FEE2E2', color: '#DC2626' }}>
                        {item.wearCount}x
                      </span>
                    </div>
                    {/* Declutter actions */}
                    {!state?.action ? (
                      <div className="flex gap-2 px-3 pb-3">
                        {[
                          { id: 'sell'    as const, label: 'Sell',    Icon: ShoppingBag, color: '#2B2B2B', bg: LILAC },
                          { id: 'donate'  as const, label: 'Donate',  Icon: Heart,       color: '#15803D', bg: MINT },
                          { id: 'restyle' as const, label: 'Restyle', Icon: RefreshCw,   color: '#92400E', bg: BUTTER },
                        ].map(btn => (
                          <button
                            key={btn.id}
                            onClick={() => setAction(item.id, btn.id)}
                            className="flex-1 py-2 rounded-full text-[11px] font-semibold flex items-center justify-center gap-1 transition-all active:scale-[0.97]"
                            style={{ background: btn.bg, color: btn.color }}
                          >
                            <btn.Icon size={12} />
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-3 pb-3">
                        <div className="rounded-xl px-3 py-2.5 flex items-center justify-between"
                          style={{ background: '#FAFAFA' }}>
                          <p className="text-xs font-medium capitalize" style={{ color: '#2B2B2B' }}>
                            {state.action === 'sell' ? 'List for sale' : state.action === 'donate' ? 'Donate' : 'Restyle it'}
                          </p>
                          <div className="flex gap-2 ml-2">
                            {state.action !== 'restyle' && (
                              <button onClick={() => confirmDelete(item.id)}
                                className="px-2.5 py-1 rounded-full text-[10px] font-semibold"
                                style={{ background: '#DC2626', color: 'white' }}>
                                Remove
                              </button>
                            )}
                            <button onClick={() => dismiss(item.id)}
                              className="px-2.5 py-1 rounded-full text-[10px] font-semibold"
                              style={{ background: '#FFFFFF', border: '1px solid rgba(43,43,43,0.12)', color: 'var(--text-secondary)' }}>
                              Done
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Declutter tab ─────────────────────────────────────────────────────────

  const candidates = items
    .map(item => ({ item, score: getDeclutterScore(item), plastic: estimatePlastic(item) }))
    .filter(({ score, plastic }) => filter === 'plastic' ? plastic.likely : score >= 15)
    .sort((a, b) => b.score - a.score);

  const filtered = candidates.filter(({ score, plastic }) => {
    if (filter === 'plastic')  return plastic.likely;
    if (filter === 'high')     return score >= 60;
    if (filter === 'medium')   return score >= 30 && score < 60;
    return true;
  }).filter(({ item }) => !itemStates[item.id]?.dismissed);

  const plasticCount = items.filter(i => estimatePlastic(i).likely).length;

  return (
    <div className="px-4 pb-4">
      <PageHeader title="Insights" subtitle="Clear out what you don't wear" />
      <TabBar />

      {/* Make my wardrobe green banner */}
      <button
        onClick={() => setFilter(filter === 'plastic' ? 'all' : 'plastic')}
        className="w-full rounded-2xl px-4 py-4 mb-4 flex items-center gap-3 text-left transition-all"
        style={{
          background: filter === 'plastic' ? '#DCFCE7' : '#F0FDF4',
          border: `1px solid ${filter === 'plastic' ? '#16A34A' : '#BBF7D0'}`,
          boxShadow: CARD_SHADOW,
        }}
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: filter === 'plastic' ? '#16A34A' : MINT }}>
          <Leaf size={18} color={filter === 'plastic' ? 'white' : '#15803D'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm" style={{ color: '#15803D', fontWeight: 700, letterSpacing: '-0.3px' }}>
            {filter === 'plastic' ? 'Showing plastic items' : 'Make my wardrobe green'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#166534' }}>
            {plasticCount > 0
              ? `${plasticCount} item${plasticCount > 1 ? 's' : ''} likely contain synthetic fibres — tap to review`
              : 'Your wardrobe looks plastic-free!'}
          </p>
        </div>
        {filter === 'plastic' && (
          <span className="font-semibold px-3 py-1 rounded-full flex-shrink-0"
            style={{ background: MINT, color: '#15803D', fontSize: '11px' }}>
            Active
          </span>
        )}
      </button>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {([
          { id: 'all'     as DeclutterFilter, label: 'All'         },
          { id: 'high'    as DeclutterFilter, label: 'Let it go'   },
          { id: 'medium'  as DeclutterFilter, label: 'Consider'    },
        ]).map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className="px-3 py-1.5 rounded-full font-semibold"
            style={{
              fontSize: '11px',
              background: filter === f.id ? LILAC : 'transparent',
              color:      filter === f.id ? '#2B2B2B' : 'var(--text-secondary)',
              border: filter === f.id ? `1px solid ${LILAC}` : '1px solid rgba(43,43,43,0.12)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Plastic-mode info banner */}
      {filter === 'plastic' && (
        <div className="rounded-2xl px-4 py-3 mb-4 flex items-start gap-2"
          style={{ background: '#F0FDF4', border: '1px solid rgba(22,163,74,0.15)', boxShadow: CARD_SHADOW }}>
          <span className="text-base flex-shrink-0">🌊</span>
          <p className="text-xs leading-relaxed" style={{ color: '#166534' }}>
            Synthetic fabrics shed <strong>microplastics</strong> every time you wash them, ending up in oceans and food chains.
            Swapping these for natural fibres like cotton, linen, wool, or silk makes a real difference.
          </p>
        </div>
      )}

      {/* Empty states */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl flex flex-col items-center py-16 text-center"
          style={{ background: '#FFFFFF', border: `1.5px dashed ${LILAC}`, boxShadow: CARD_SHADOW }}>
          <div className="text-4xl mb-3">
            {filter === 'plastic' ? '🌿' : '✨'}
          </div>
          <p className="font-medium text-sm mb-1" style={{ color: '#2B2B2B' }}>
            {filter === 'plastic' ? 'No plastic items detected!' : 'Your wardrobe looks great!'}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {filter === 'plastic'
              ? 'We couldn\'t identify any synthetic items. Keep it up!'
              : 'No items flagged for decluttering right now.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(({ item, score, plastic }) => {
            const { label, color, bg } = getScoreLabel(score);
            const state = itemStates[item.id];
            const ds    = daysSince(item.lastWorn);

            return (
              <div key={item.id} className="rounded-2xl overflow-hidden"
                style={{ background: '#FFFFFF', boxShadow: CARD_SHADOW }}>

                {/* Header */}
                <div className="flex items-center gap-3 p-4">
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
                    {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt={item.subcategory} /> : <div className="w-full h-full flex items-center justify-center text-xl opacity-40">👕</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm capitalize truncate" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.3px' }}>
                      {item.color} {item.subcategory}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {item.wearCount === 0
                        ? 'Never worn'
                        : ds < 999
                          ? `Last worn ${ds} days ago`
                          : `Worn ${item.wearCount}x`}
                    </p>
                  </div>
                  {/* Badge — green leaf for plastic mode, score label otherwise */}
                  {filter === 'plastic' ? (
                    <span className="text-[10px] font-medium px-2.5 py-1 rounded-full flex-shrink-0 flex items-center gap-1"
                      style={{ background: MINT, color: '#15803D' }}>
                      <Leaf size={10} /> Plastic
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium px-2.5 py-1 rounded-full flex-shrink-0"
                      style={{ background: bg, color }}>
                      {label}
                    </span>
                  )}
                </div>

                {/* Reason */}
                <div className="px-4 pb-3">
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {filter === 'plastic'
                      ? plastic.reason
                      : item.wearCount === 0
                        ? "You've never worn this item."
                        : ds > 180
                          ? `You haven't worn this in ${ds} days.`
                          : `Low wear count — only ${item.wearCount} time${item.wearCount > 1 ? 's' : ''}.`}
                  </p>
                </div>

                {/* Actions */}
                {!state?.action ? (
                  <div className="flex gap-2 px-4 pb-4">
                    {[
                      { id: 'sell'    as const, label: 'Sell',    Icon: ShoppingBag, color: '#2B2B2B', bg: LILAC },
                      { id: 'donate'  as const, label: 'Donate',  Icon: Heart,       color: '#15803D', bg: MINT },
                      { id: 'restyle' as const, label: 'Restyle', Icon: RefreshCw,   color: '#92400E', bg: BUTTER },
                    ].map(btn => (
                      <button
                        key={btn.id}
                        onClick={() => setAction(item.id, btn.id)}
                        className="flex-1 py-2.5 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
                        style={{ background: btn.bg, color: btn.color }}
                      >
                        <btn.Icon size={13} />
                        {btn.label}
                      </button>
                    ))}
                    <button
                      onClick={() => dismiss(item.id)}
                      className="px-3 py-2.5 rounded-full text-xs font-semibold transition-all"
                      style={{ background: '#FAFAFA', border: '1px solid rgba(43,43,43,0.12)', color: 'var(--text-secondary)' }}
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <div className="px-4 pb-4">
                    <div className="rounded-2xl px-4 py-3 flex items-center justify-between"
                      style={{ background: '#FAFAFA' }}>
                      <div>
                        <p className="text-sm font-medium capitalize" style={{ color: '#2B2B2B' }}>
                          {state.action === 'sell' ? 'List for sale' : state.action === 'donate' ? 'Donate' : 'Restyle'}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                          {state.action === 'sell'
                            ? 'Remove from wardrobe after listing'
                            : state.action === 'donate'
                              ? 'Remove from wardrobe after donating'
                              : 'Keep but repurpose — consider altering or styling differently'}
                        </p>
                      </div>
                      <div className="flex gap-2 ml-3">
                        {state.action !== 'restyle' && (
                          <button onClick={() => confirmDelete(item.id)}
                            className="px-3 py-1.5 rounded-full text-xs font-semibold"
                            style={{ background: '#DC2626', color: 'white' }}>
                            Remove
                          </button>
                        )}
                        <button onClick={() => dismiss(item.id)}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold"
                          style={{ background: '#FFFFFF', border: '1px solid rgba(43,43,43,0.12)', color: 'var(--text-secondary)' }}>
                          Done
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
