import { useUser } from '../store';
import type { WardrobeItem } from '../types';
import PageHeader from '../components/PageHeader';
import { TrendingUp, Award, AlertCircle } from 'lucide-react';

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function costPerWear(item: WardrobeItem): number | null {
  if (!item.estimatedValue || !item.wearCount) return null;
  return Math.round((item.estimatedValue / item.wearCount) * 100) / 100;
}

export default function Insights() {
  const { user } = useUser();
  const items = user.wardrobeItems;

  if (items.length === 0) {
    return (
      <div className="px-4 pb-4">
        <PageHeader title="Insights" subtitle="Your wardrobe intelligence" />
        <div
          className="rounded-2xl flex flex-col items-center py-16 text-center"
          style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)' }}
        >
          <div className="text-4xl mb-3">📊</div>
          <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
            No data yet
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Add items to your wardrobe to see insights.
          </p>
        </div>
      </div>
    );
  }

  // Sorted by wear count
  const mostWorn = [...items].sort((a, b) => b.wearCount - a.wearCount).slice(0, 3);
  const leastWorn = [...items].sort((a, b) => a.wearCount - b.wearCount).filter(i => i.wearCount === 0 || daysSince(i.lastWorn) > 60).slice(0, 3);
  const totalWears = items.reduce((s, i) => s + i.wearCount, 0);
  const unwornCount = items.filter(i => i.wearCount === 0).length;
  const dormantCount = items.filter(i => daysSince(i.lastWorn) > 90).length;

  // Category breakdown
  const categories = ['top', 'bottom', 'shoes', 'outerwear', 'dress', 'accessory'] as const;
  const catCounts = categories.map(c => ({ label: c, count: items.filter(i => i.category === c).length })).filter(c => c.count > 0);
  const maxCount = Math.max(...catCounts.map(c => c.count));

  // Best CPW item
  const withCPW = items.filter(i => i.estimatedValue > 0 && i.wearCount > 0).map(i => ({ item: i, cpw: costPerWear(i)! }));
  const bestCPW = withCPW.sort((a, b) => a.cpw - b.cpw)[0];

  return (
    <div className="px-4 pb-4">
      <PageHeader title="Insights" subtitle="Your wardrobe at a glance" />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Items', value: items.length },
          { label: 'Total wears', value: totalWears },
          { label: 'Unworn', value: unwornCount },
        ].map(s => (
          <div
            key={s.label}
            className="rounded-2xl px-3 py-4 text-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <p className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {dormantCount > 0 && (
        <div
          className="rounded-2xl px-4 py-3 mb-4 flex items-start gap-3"
          style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}
        >
          <AlertCircle size={18} style={{ color: '#D97706', flexShrink: 0, marginTop: '1px' }} />
          <p className="text-sm" style={{ color: '#92400E' }}>
            <strong>{dormantCount} item{dormantCount > 1 ? 's' : ''}</strong> haven't been worn in 90+ days. Consider decluttering.
          </p>
        </div>
      )}

      {/* Category breakdown */}
      <div
        className="rounded-2xl px-5 py-4 mb-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p className="font-semibold text-sm mb-4" style={{ color: 'var(--text-primary)' }}>Wardrobe breakdown</p>
        <div className="space-y-3">
          {catCounts.map(({ label, count }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs capitalize" style={{ color: 'var(--text-secondary)' }}>{label}s</span>
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{count}</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(count / maxCount) * 100}%`, background: 'var(--accent)' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Most worn */}
      {mostWorn.length > 0 && mostWorn[0].wearCount > 0 && (
        <div
          className="rounded-2xl px-5 py-4 mb-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={15} style={{ color: 'var(--accent)' }} />
            <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Most worn</p>
          </div>
          <div className="flex gap-3">
            {mostWorn.filter(i => i.wearCount > 0).map(item => (
              <div key={item.id} className="flex-1 min-w-0">
                <div className="aspect-square rounded-xl overflow-hidden mb-1.5" style={{ background: 'var(--bg)' }}>
                  <img src={item.imageUrl} className="w-full h-full object-cover" alt={item.subcategory} />
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
        <div
          className="rounded-2xl px-5 py-4 mb-4 flex items-center gap-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0">
            <img src={bestCPW.item.imageUrl} className="w-full h-full object-cover" alt="" />
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

      {/* Least worn / dormant */}
      {leastWorn.length > 0 && (
        <div
          className="rounded-2xl px-5 py-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p className="font-semibold text-sm mb-3" style={{ color: 'var(--text-primary)' }}>Gathering dust</p>
          <div className="space-y-3">
            {leastWorn.map(item => (
              <div key={item.id} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
                  <img src={item.imageUrl} className="w-full h-full object-cover" alt="" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm capitalize truncate" style={{ color: 'var(--text-primary)' }}>
                    {item.color} {item.subcategory}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {item.wearCount === 0 ? 'Never worn' : `Last worn ${daysSince(item.lastWorn)} days ago`}
                  </p>
                </div>
                <span
                  className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: '#FEE2E2', color: '#DC2626' }}
                >
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
