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

// Subcategory keywords that strongly suggest synthetic fibres
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
  return { likely: false, reason: 'Likely natural fibres' };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type DeclutterFilter = 'all' | 'high' | 'medium' | 'plastic';
type Action = 'sell' | 'donate' | 'restyle' | null;
interface ItemState { action: Action; dismissed: boolean }

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
    <div className="flex gap-1 mb-5 p-1 rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {(['insights', 'declutter'] as const).map(tab => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all capitalize"
          style={{
            background: activeTab === tab ? 'var(--accent)' : 'transparent',
            color: activeTab === tab ? 'white' : 'var(--text-secondary)',
          }}
        >
          {tab === 'insights' ? '📊 Insights' : '🧹 Declutter'}
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
          style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)' }}
        >
          <div className="text-4xl mb-3">{activeTab === 'insights' ? '📊' : '🧹'}</div>
          <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>No data yet</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Add items to your wardrobe first.</p>
        </div>
      </div>
    );
  }

  // ── Insights tab ──────────────────────────────────────────────────────────
  if (activeTab === 'insights') {
    const mostWorn    = [...items].sort((a, b) => b.wearCount - a.wearCount).slice(0, 3);
    const leastWorn   = [...items].sort((a, b) => a.wearCount - b.wearCount)
                          .filter(i => i.wearCount === 0 || daysSince(i.lastWorn) > 60).slice(0, 3);
    const totalWears  = items.reduce((s, i) => s + i.wearCount, 0);
    const unwornCount = items.filter(i => i.wearCount === 0).length;
    const dormantCount = items.filter(i => daysSince(i.lastWorn) > 90).length;

    const categories = ['top', 'bottom', 'footwear', 'outerwear', 'dress', 'bag', 'jewellery'] as const;
    const catCounts  = categories
      .map(c => ({ label: c, count: items.filter(i => i.category === c).length }))
      .filter(c => c.count > 0);
    const maxCount = Math.max(...catCounts.map(c => c.count));

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
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Dormant alert */}
        {dormantCount > 0 && (
          <div className="rounded-2xl px-4 py-3 mb-4 flex items-start gap-3"
            style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
            <AlertCircle size={18} style={{ color: '#D97706', flexShrink: 0, marginTop: '1px' }} />
            <p className="text-sm" style={{ color: '#92400E' }}>
              <strong>{dormantCount} item{dormantCount > 1 ? 's' : ''}</strong> haven't been worn in 90+ days.{' '}
              <button onClick={() => setActiveTab('declutter')}
                className="underline font-medium" style={{ color: '#D97706' }}>
                Declutter now →
              </button>
            </p>
          </div>
        )}

        {/* Sustainability score */}
        <div className="rounded-2xl px-5 py-4 mb-4"
          style={{ background: naturalPct >= 70 ? '#F0FDF4' : '#FFFBEB',
                   border: `1px solid ${naturalPct >= 70 ? '#BBF7D0' : '#FDE68A'}` }}>
          <div className="flex items-center gap-2 mb-3">
            <Leaf size={14} style={{ color: naturalPct >= 70 ? '#15803D' : '#CA8A04' }} />
            <p className="font-semibold text-sm"
              style={{ color: naturalPct >= 70 ? '#15803D' : '#92400E' }}>
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
                Remove {plasticItems.length} plastic item{plasticItems.length > 1 ? 's' : ''} →
              </button></>
            )}
          </p>
        </div>

        {/* Category breakdown */}
        <div className="rounded-2xl px-5 py-4 mb-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="font-semibold text-sm mb-4" style={{ color: 'var(--text-primary)' }}>Wardrobe breakdown</p>
          <div className="space-y-3">
            {catCounts.map(({ label, count }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs capitalize" style={{ color: 'var(--text-secondary)' }}>{label}s</span>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{count}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg)' }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(count / maxCount) * 100}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Most worn */}
        {mostWorn.length > 0 && mostWorn[0].wearCount > 0 && (
          <div className="rounded-2xl px-5 py-4 mb-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={15} style={{ color: 'var(--accent)' }} />
              <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Most worn</p>
            </div>
            <div className="flex gap-3">
              {mostWorn.filter(i => i.wearCount > 0).map(item => (
                <div key={item.id} className="flex-1 min-w-0">
                  <div className="aspect-square rounded-xl overflow-hidden mb-1.5" style={{ background: 'var(--bg)' }}>
                    {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt={item.subcategory} /> : <div className="w-full h-full flex items-center justify-center text-xl opacity-40">👕</div>}
                  </div>
                  <p className="text-[10px] text-center truncate capitalize" style={{ color: 'var(--text-secondary)' }}>
                    {item.color} {item.subcategory}
                  </p>
                  <p className="text-[10px] text-center font-medium" style={{ color: 'var(--accent)' }}>
                    {item.wearCount}×
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Best CPW */}
        {bestCPW && (
          <div className="rounded-2xl px-5 py-4 mb-4 flex items-center gap-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0">
              {bestCPW.item.imageUrl ? <img src={bestCPW.item.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xl opacity-40">👕</div>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Award size={13} style={{ color: 'var(--accent)' }} />
                <p className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Best cost per wear</p>
              </div>
              <p className="font-semibold text-sm capitalize truncate" style={{ color: 'var(--text-primary)' }}>
                {bestCPW.item.color} {bestCPW.item.subcategory}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                £{bestCPW.cpw} per wear · worn {bestCPW.item.wearCount}×
              </p>
            </div>
          </div>
        )}

        {/* Gathering dust */}
        {leastWorn.length > 0 && (
          <div className="rounded-2xl px-5 py-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="font-semibold text-sm mb-3" style={{ color: 'var(--text-primary)' }}>Gathering dust</p>
            <div className="space-y-3">
              {leastWorn.map(item => (
                <div key={item.id} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
                    {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xl opacity-40">👕</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm capitalize truncate" style={{ color: 'var(--text-primary)' }}>
                      {item.color} {item.subcategory}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {item.wearCount === 0 ? 'Never worn' : `Last worn ${daysSince(item.lastWorn)} days ago`}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: '#FEE2E2', color: '#DC2626' }}>
                    {item.wearCount}×
                  </span>
                </div>
              ))}
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

      {/* 🌿 Make my wardrobe green banner */}
      <button
        onClick={() => setFilter(filter === 'plastic' ? 'all' : 'plastic')}
        className="w-full rounded-2xl px-4 py-4 mb-4 flex items-center gap-3 text-left transition-all"
        style={{
          background: filter === 'plastic' ? '#DCFCE7' : '#F0FDF4',
          border: `1.5px solid ${filter === 'plastic' ? '#16A34A' : '#BBF7D0'}`,
        }}
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: filter === 'plastic' ? '#16A34A' : '#DCFCE7' }}>
          <Leaf size={18} color={filter === 'plastic' ? 'white' : '#15803D'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: '#15803D' }}>
            {filter === 'plastic' ? '🌿 Showing plastic items' : '🌿 Make my wardrobe green'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#166534' }}>
            {plasticCount > 0
              ? `${plasticCount} item${plasticCount > 1 ? 's' : ''} likely contain synthetic fibres — tap to review`
              : 'Your wardrobe looks plastic-free! 🎉'}
          </p>
        </div>
        {filter === 'plastic' && (
          <span className="text-xs font-medium px-2 py-1 rounded-full"
            style={{ background: '#16A34A', color: 'white' }}>
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
            className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              background: filter === f.id ? 'var(--accent)' : 'var(--surface)',
              color:      filter === f.id ? 'white'         : 'var(--text-secondary)',
              border: `1px solid ${filter === f.id ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Plastic-mode info banner */}
      {filter === 'plastic' && (
        <div className="rounded-2xl px-4 py-3 mb-4 flex items-start gap-2"
          style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
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
          style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)' }}>
          <div className="text-4xl mb-3">
            {filter === 'plastic' ? '🌿' : '✨'}
          </div>
          <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
            {filter === 'plastic' ? 'No plastic items detected!' : 'Your wardrobe looks great!'}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {filter === 'plastic'
              ? 'We couldn\'t identify any synthetic items. Keep it up 🌱'
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
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

                {/* Header */}
                <div className="flex items-center gap-3 p-4">
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
                    {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" alt={item.subcategory} /> : <div className="w-full h-full flex items-center justify-center text-xl opacity-40">👕</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm capitalize truncate" style={{ color: 'var(--text-primary)' }}>
                      {item.color} {item.subcategory}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {item.wearCount === 0
                        ? 'Never worn'
                        : ds < 999
                          ? `Last worn ${ds} days ago`
                          : `Worn ${item.wearCount}×`}
                    </p>
                  </div>
                  {/* Badge — green leaf for plastic mode, score label otherwise */}
                  {filter === 'plastic' ? (
                    <span className="text-[10px] font-medium px-2.5 py-1 rounded-full flex-shrink-0 flex items-center gap-1"
                      style={{ background: '#DCFCE7', color: '#15803D' }}>
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
                      { id: 'sell'    as const, label: 'Sell',    Icon: ShoppingBag, color: '#2563EB', bg: '#EFF6FF' },
                      { id: 'donate'  as const, label: 'Donate',  Icon: Heart,       color: '#16A34A', bg: '#DCFCE7' },
                      { id: 'restyle' as const, label: 'Restyle', Icon: RefreshCw,   color: '#7C3AED', bg: '#F5F3FF' },
                    ].map(btn => (
                      <button
                        key={btn.id}
                        onClick={() => setAction(item.id, btn.id)}
                        className="flex-1 py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
                        style={{ background: btn.bg, color: btn.color }}
                      >
                        <btn.Icon size={13} />
                        {btn.label}
                      </button>
                    ))}
                    <button
                      onClick={() => dismiss(item.id)}
                      className="px-3 py-2.5 rounded-xl text-xs font-medium"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <div className="px-4 pb-4">
                    <div className="rounded-xl px-4 py-3 flex items-center justify-between"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                      <div>
                        <p className="text-sm font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                          {state.action === 'sell' ? '🏷️ List for sale' : state.action === 'donate' ? '❤️ Donate' : '✂️ Restyle'}
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
                            className="px-3 py-1.5 rounded-lg text-xs font-medium"
                            style={{ background: '#DC2626', color: 'white' }}>
                            Remove
                          </button>
                        )}
                        <button onClick={() => dismiss(item.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium"
                          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
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
