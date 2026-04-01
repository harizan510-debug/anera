import { useState } from 'react';
import { RefreshCw, ShoppingBag, Heart } from 'lucide-react';
import { useUser, deleteWardrobeItem } from '../store';
import type { WardrobeItem } from '../types';
import PageHeader from '../components/PageHeader';

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

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

type Action = 'sell' | 'donate' | 'restyle' | null;

interface ItemState {
  action: Action;
  dismissed: boolean;
}

export default function Declutter() {
  const { user, refresh } = useUser();
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  const [filter, setFilter] = useState<'all' | 'high' | 'medium'>('all');

  const items = user.wardrobeItems;

  const candidates = items
    .map(item => ({ item, score: getDeclutterScore(item) }))
    .filter(({ score }) => score >= 15)
    .sort((a, b) => b.score - a.score);

  const filtered = candidates.filter(({ score }) => {
    if (filter === 'high') return score >= 60;
    if (filter === 'medium') return score >= 30 && score < 60;
    return true;
  }).filter(({ item }) => !itemStates[item.id]?.dismissed);

  const setAction = (id: string, action: Action) => {
    setItemStates(prev => ({ ...prev, [id]: { ...prev[id], action } }));
  };

  const confirmDelete = (id: string) => {
    deleteWardrobeItem(id);
    refresh();
    setItemStates(prev => ({ ...prev, [id]: { ...prev[id], dismissed: true } }));
  };

  const dismiss = (id: string) => {
    setItemStates(prev => ({ ...prev, [id]: { ...prev[id], dismissed: true } }));
  };

  if (items.length === 0) {
    return (
      <div className="px-4 pb-4">
        <PageHeader title="Declutter" subtitle="Clear out what you don't wear" />
        <div
          className="rounded-2xl flex flex-col items-center py-16 text-center"
          style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)' }}
        >
          <div className="text-4xl mb-3">🧹</div>
          <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
            Nothing to declutter
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Add items to your wardrobe first.
          </p>
        </div>
      </div>
    );
  }

  if (candidates.length === 0 || filtered.length === 0) {
    return (
      <div className="px-4 pb-4">
        <PageHeader title="Declutter" subtitle="Clear out what you don't wear" />
        <div
          className="rounded-2xl flex flex-col items-center py-16 text-center"
          style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)' }}
        >
          <div className="text-4xl mb-3">✨</div>
          <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
            Your wardrobe looks great!
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            No items flagged for decluttering right now.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4">
      <PageHeader
        title="Declutter"
        subtitle={`${filtered.length} item${filtered.length > 1 ? 's' : ''} to review`}
      />

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {(['all', 'high', 'medium'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              background: filter === f ? 'var(--accent)' : 'var(--surface)',
              color: filter === f ? 'white' : 'var(--text-secondary)',
              border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            {f === 'all' ? 'All' : f === 'high' ? 'Let it go' : 'Consider'}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {filtered.map(({ item, score }) => {
          const { label, color, bg } = getScoreLabel(score);
          const state = itemStates[item.id];
          const ds = daysSince(item.lastWorn);

          return (
            <div
              key={item.id}
              className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              {/* Item header */}
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
                <span
                  className="text-[10px] font-medium px-2.5 py-1 rounded-full flex-shrink-0"
                  style={{ background: bg, color }}
                >
                  {label}
                </span>
              </div>

              {/* Reason */}
              <div className="px-4 pb-3">
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {item.wearCount === 0
                    ? "You've never worn this item."
                    : ds > 180
                      ? `You haven't worn this in ${ds} days.`
                      : `Low wear count — only ${item.wearCount} time${item.wearCount > 1 ? 's' : ''}.`}
                </p>
              </div>

              {/* Action buttons */}
              {!state?.action ? (
                <div className="flex gap-2 px-4 pb-4">
                  {[
                    { id: 'sell' as const, label: 'Sell', icon: ShoppingBag, color: '#2563EB', bg: '#EFF6FF' },
                    { id: 'donate' as const, label: 'Donate', icon: Heart, color: '#16A34A', bg: '#DCFCE7' },
                    { id: 'restyle' as const, label: 'Restyle', icon: RefreshCw, color: '#5C3D2E', bg: '#F5F0EB' },
                  ].map(btn => {
                    const Icon = btn.icon;
                    return (
                      <button
                        key={btn.id}
                        onClick={() => setAction(item.id, btn.id)}
                        className="flex-1 py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
                        style={{ background: btn.bg, color: btn.color }}
                      >
                        <Icon size={13} />
                        {btn.label}
                      </button>
                    );
                  })}
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
                  <div
                    className="rounded-xl px-4 py-3 flex items-center justify-between"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
                  >
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
                        <button
                          onClick={() => confirmDelete(item.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium"
                          style={{ background: '#DC2626', color: 'white' }}
                        >
                          Remove
                        </button>
                      )}
                      <button
                        onClick={() => dismiss(item.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                      >
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
  );
}
