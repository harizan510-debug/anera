import { useState, useRef } from 'react';
import { Plus, Search, X, Trash2, Check } from 'lucide-react';
import { useUser, addWardrobeItem, updateWardrobeItem, deleteWardrobeItem, fileToBase64, genId } from '../store';
import type { WardrobeItem } from '../types';
import { analyzeClothingImage } from '../api';
import PageHeader from '../components/PageHeader';

const CATEGORIES: WardrobeItem['category'][] = ['top', 'bottom', 'shoes', 'outerwear', 'accessory', 'dress'];

const categoryLabel: Record<WardrobeItem['category'], string> = {
  top: 'Tops', bottom: 'Bottoms', shoes: 'Shoes', outerwear: 'Outerwear', accessory: 'Accessories', dress: 'Dresses',
};

const CATEGORY_COLORS: Record<WardrobeItem['category'], string> = {
  top: '#E8D5C0', bottom: '#D0DDE8', shoes: '#D8E0D0', outerwear: '#E0D0D8', accessory: '#E8E0C8', dress: '#D8D0E8',
};

interface EditModal {
  item: WardrobeItem;
}

export default function Wardrobe() {
  const { user, refresh } = useUser();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | WardrobeItem['category']>('all');
  const [editModal, setEditModal] = useState<EditModal | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const items = user.wardrobeItems;

  const filtered = items.filter(item => {
    const matchCategory = activeCategory === 'all' || item.category === activeCategory;
    const q = search.toLowerCase();
    const matchSearch = !q || item.color.includes(q) || item.subcategory.includes(q) || item.category.includes(q) || item.tags.some(t => t.includes(q));
    return matchCategory && matchSearch;
  });

  const counts: Record<string, number> = { all: items.length };
  for (const c of CATEGORIES) counts[c] = items.filter(i => i.category === c).length;

  const handleAddPhoto = async (file: File) => {
    setAddLoading(true);
    const base64 = await fileToBase64(file);
    const previewUrl = URL.createObjectURL(file);
    try {
      const hasApiKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY;
      let analysed: Partial<WardrobeItem> = {};
      if (hasApiKey) {
        analysed = await analyzeClothingImage(base64, file.type || 'image/jpeg');
      }
      const newItem: WardrobeItem = {
        id: genId(),
        imageUrl: previewUrl,
        category: analysed.category || 'top',
        subcategory: analysed.subcategory || 'item',
        color: analysed.color || 'unknown',
        pattern: analysed.pattern || 'plain',
        fit: analysed.fit || 'regular',
        wearCount: 0,
        lastWorn: null,
        estimatedValue: 0,
        tags: analysed.tags || [],
      };
      addWardrobeItem(newItem);
      refresh();
      setEditModal({ item: newItem }); // Open edit to confirm details
    } catch (err) {
      console.error(err);
    }
    setAddLoading(false);
  };

  const saveEdit = () => {
    if (!editModal) return;
    updateWardrobeItem(editModal.item);
    refresh();
    setEditModal(null);
  };

  const handleDelete = (id: string) => {
    deleteWardrobeItem(id);
    refresh();
    setEditModal(null);
  };

  const summary = () => {
    const tops = items.filter(i => i.category === 'top').length;
    const bottoms = items.filter(i => i.category === 'bottom').length;
    const shoes = items.filter(i => i.category === 'shoes').length;
    const parts = [];
    if (tops) parts.push(`${tops} top${tops > 1 ? 's' : ''}`);
    if (bottoms) parts.push(`${bottoms} bottom${bottoms > 1 ? 's' : ''}`);
    if (shoes) parts.push(`${shoes} pair${shoes > 1 ? 's' : ''} of shoes`);
    return parts.length ? parts.join(', ') : `${items.length} items`;
  };

  return (
    <div className="px-4 pt-4 pb-4">
      <PageHeader
        title="Wardrobe"
        subtitle={items.length > 0 ? `You own ${summary()}` : 'No items yet — add your first piece'}
        action={
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={addLoading}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {addLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Plus size={18} />}
          </button>
        }
      />

      {/* Search */}
      <div className="relative mb-4">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by colour, type, tag…"
          className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 no-scrollbar">
        {(['all', ...CATEGORIES] as const).map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{
              background: activeCategory === cat ? 'var(--accent)' : 'var(--surface)',
              color: activeCategory === cat ? 'white' : 'var(--text-secondary)',
              border: `1px solid ${activeCategory === cat ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            {cat === 'all' ? 'All' : categoryLabel[cat]} {counts[cat] > 0 && `(${counts[cat]})`}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div
          className="rounded-2xl flex flex-col items-center justify-center py-16 text-center"
          style={{ border: '1.5px dashed var(--border)', background: 'var(--surface)' }}
        >
          <div className="text-4xl mb-3">👗</div>
          <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
            {search ? 'No items match your search' : 'Your wardrobe is empty'}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {search ? 'Try a different keyword' : 'Tap + to add your first item'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {filtered.map(item => (
            <div
              key={item.id}
              onClick={() => setEditModal({ item: { ...item } })}
              className="rounded-2xl overflow-hidden cursor-pointer active:scale-95 transition-transform"
              style={{ background: CATEGORY_COLORS[item.category] || 'var(--accent-light)' }}
            >
              <div className="aspect-square w-full overflow-hidden">
                <img src={item.imageUrl} className="w-full h-full object-cover" alt={item.subcategory} />
              </div>
              <div className="px-2 py-2">
                <p className="text-xs font-medium capitalize truncate" style={{ color: 'var(--text-primary)' }}>
                  {item.color} {item.subcategory}
                </p>
                <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  worn {item.wearCount}×
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => e.target.files?.[0] && handleAddPhoto(e.target.files[0])}
      />

      {/* Edit Modal */}
      {editModal && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={e => { if (e.target === e.currentTarget) setEditModal(null); }}
        >
          <div
            className="w-full rounded-t-3xl p-6"
            style={{ background: 'var(--surface)', maxHeight: '85vh', overflowY: 'auto' }}
          >
            <div className="flex items-start gap-4 mb-5">
              <div className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0">
                <img src={editModal.item.imageUrl} className="w-full h-full object-cover" alt="" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Edit Item
                </p>
                <h3 className="font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                  {editModal.item.color} {editModal.item.subcategory}
                </h3>
              </div>
              <button onClick={() => setEditModal(null)}>
                <X size={20} style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>

            <div className="space-y-3">
              <FieldRow label="Subcategory">
                <input
                  value={editModal.item.subcategory}
                  onChange={e => setEditModal(m => m && ({ ...m, item: { ...m.item, subcategory: e.target.value } }))}
                  className="field-input"
                  style={fieldStyle}
                />
              </FieldRow>
              <FieldRow label="Category">
                <select
                  value={editModal.item.category}
                  onChange={e => setEditModal(m => m && ({ ...m, item: { ...m.item, category: e.target.value as WardrobeItem['category'] } }))}
                  style={fieldStyle}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel[c]}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Colour">
                <input
                  value={editModal.item.color}
                  onChange={e => setEditModal(m => m && ({ ...m, item: { ...m.item, color: e.target.value } }))}
                  style={fieldStyle}
                  className="field-input"
                />
              </FieldRow>
              <FieldRow label="Fit">
                <input
                  value={editModal.item.fit}
                  onChange={e => setEditModal(m => m && ({ ...m, item: { ...m.item, fit: e.target.value } }))}
                  style={fieldStyle}
                  className="field-input"
                />
              </FieldRow>
              <FieldRow label="Est. value (£)">
                <input
                  type="number"
                  value={editModal.item.estimatedValue || ''}
                  onChange={e => setEditModal(m => m && ({ ...m, item: { ...m.item, estimatedValue: parseFloat(e.target.value) || 0 } }))}
                  style={fieldStyle}
                  className="field-input"
                  placeholder="0"
                />
              </FieldRow>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => handleDelete(editModal.item.id)}
                className="flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: '#FEE2E2', color: '#DC2626' }}
              >
                <Trash2 size={18} />
              </button>
              <button
                onClick={saveEdit}
                className="flex-1 py-3 rounded-2xl font-medium text-white flex items-center justify-center gap-2"
                style={{ background: 'var(--accent)' }}
              >
                <Check size={18} /> Save changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '10px 12px',
  fontSize: '14px',
  color: 'var(--text-primary)',
  outline: 'none',
};

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
