import { useState, useRef } from 'react';
import { Check, X, Pencil, ChevronUp, ImagePlus } from 'lucide-react';
import type { DetectedItem, WardrobeItem } from '../types';
import { genId, fileToBase64 } from '../store';

const CATEGORIES: WardrobeItem['category'][] = ['top', 'bottom', 'footwear', 'outerwear', 'dress', 'bag', 'jewellery', 'belt', 'hat'];
const CAT_LABELS: Record<WardrobeItem['category'], string> = {
  top: 'Top', bottom: 'Bottom', footwear: 'Footwear',
  outerwear: 'Outerwear', dress: 'Dress', bag: 'Bag', jewellery: 'Jewellery',
  belt: 'Belt', hat: 'Hat',
};

// ── Confidence helpers ──────────────────────────────────────────────────────

function minConfidence(item: DetectedItem): number {
  const vals = [item.categoryConfidence, item.subcategoryConfidence, item.colorConfidence];
  if (item.brand) vals.push(item.brandConfidence); // only count brand if detected
  return Math.min(...vals);
}

function avgConfidence(item: DetectedItem): number {
  const vals = [item.categoryConfidence, item.subcategoryConfidence, item.colorConfidence];
  if (item.brand) vals.push(item.brandConfidence);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function cardAccentColor(item: DetectedItem): string {
  const mc = minConfidence(item);
  if (mc >= 0.85) return '#22c55e';
  if (mc >= 0.6) return '#f59e0b';
  return '#ef4444';
}

// ── ConfidenceField: input with confidence-based visual styling ─────────────
// > 0.85 → normal input + faded green ✓
// 0.6–0.85 → amber bottom border + amber dot
// < 0.6 → amber background + red border + "Please confirm" badge

interface ConfidenceFieldProps {
  label: string;
  confidence: number;
  children: React.ReactNode;
}

function ConfidenceField({ label, confidence, children }: ConfidenceFieldProps) {
  const isHigh = confidence >= 0.85;
  const isMed = confidence >= 0.6 && confidence < 0.85;
  const isLow = confidence < 0.6;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          {label}
        </span>
        {isHigh && (
          <span style={{ fontSize: 11, color: '#22c55e', opacity: 0.75, fontWeight: 700, lineHeight: 1 }}>✓</span>
        )}
        {isMed && (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block', flexShrink: 0 }} />
        )}
        {isLow && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: '#FEF9C3', color: '#92400E', border: '1px solid #FCD34D', letterSpacing: '0.03em', lineHeight: '1.6' }}>
            Please confirm
          </span>
        )}
      </div>
      {/* Clone children with confidence-derived style injected */}
      <ConfidenceInputWrapper confidence={confidence}>
        {children}
      </ConfidenceInputWrapper>
    </div>
  );
}

function ConfidenceInputWrapper({ confidence, children }: { confidence: number; children: React.ReactNode }) {
  const isMed = confidence >= 0.6 && confidence < 0.85;
  const isLow = confidence < 0.6;

  if (!isMed && !isLow) return <>{children}</>;

  return (
    <div style={{
      borderRadius: 10,
      outline: isLow ? '1.5px solid #FCD34D' : undefined,
      background: isLow ? '#FFFBEB' : undefined,
      borderBottom: isMed ? '2px solid #f59e0b' : undefined,
      overflow: 'hidden',
    }}>
      {children}
    </div>
  );
}

// ── Shared input style ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--text-primary)',
  outline: 'none',
  width: '100%',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

// ── Main component ──────────────────────────────────────────────────────────

interface MultiItemReviewProps {
  items: DetectedItem[];
  onConfirm: (items: WardrobeItem[]) => void;
  onCancel: () => void;
}

export default function MultiItemReview({ items: initialItems, onConfirm, onCancel }: MultiItemReviewProps) {
  const [editItems, setEditItems] = useState<DetectedItem[]>(initialItems);
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});
  const [imageUrlInputs, setImageUrlInputs] = useState<Record<string, string>>({});
  const [showImageInput, setShowImageInput] = useState<Record<string, boolean>>({});
  const imgFileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Auto-expand cards that have any field with low confidence
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const auto = new Set<string>();
    for (const item of initialItems) {
      if (minConfidence(item) < 0.6) auto.add(item.tempId);
    }
    return auto;
  });

  const isExpanded = (id: string) => expandedIds.has(id);
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const update = <K extends keyof DetectedItem>(tempId: string, field: K, value: DetectedItem[K]) => {
    setEditItems(prev => prev.map(item => item.tempId === tempId ? { ...item, [field]: value } : item));
  };

  const removeItem = (tempId: string) => {
    setEditItems(prev => prev.filter(item => item.tempId !== tempId));
    setExpandedIds(prev => { const n = new Set(prev); n.delete(tempId); return n; });
  };

  const removeTag = (tempId: string, tag: string) => {
    setEditItems(prev => prev.map(item =>
      item.tempId === tempId ? { ...item, tags: item.tags.filter(t => t !== tag) } : item
    ));
  };

  const commitTag = (tempId: string) => {
    const val = (tagInputs[tempId] ?? '').trim().toLowerCase();
    if (!val) return;
    setEditItems(prev => prev.map(item =>
      item.tempId === tempId && !item.tags.includes(val)
        ? { ...item, tags: [...item.tags, val] }
        : item
    ));
    setTagInputs(prev => ({ ...prev, [tempId]: '' }));
  };

  const handleConfirm = () => {
    if (editItems.length === 0) { onCancel(); return; }
    const wardrobeItems: WardrobeItem[] = editItems.map(d => ({
      id: genId(),
      imageUrl: d.croppedImageUrl || d.originalImageUrl,
      category: d.category,
      subcategory: d.subcategory || 'item',
      color: d.color || 'unknown',
      pattern: d.pattern || 'plain',
      fit: d.fit || 'regular',
      brand: d.brand || undefined,
      wearCount: 0,
      lastWorn: null,
      estimatedValue: 0,
      tags: d.tags,
    }));
    onConfirm(wardrobeItems);
  };

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: 'var(--bg)' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <button onClick={onCancel} className="flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--text-secondary)' }}>
          <X size={18} /> Cancel
        </button>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {editItems.length} item{editItems.length !== 1 ? 's' : ''} detected
        </p>
        <button onClick={handleConfirm} disabled={editItems.length === 0}
          className="flex items-center gap-1.5 text-sm font-semibold disabled:opacity-40"
          style={{ color: 'var(--accent)' }}>
          <Check size={16} /> Save all
        </button>
      </div>

      {/* ── Legend ── */}
      <div className="px-4 pt-2.5 pb-2 flex-shrink-0 flex items-center gap-3 flex-wrap">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Anera's confidence:</span>
        {[['#22c55e', '✓ High'], ['#f59e0b', '● Unsure'], ['#ef4444', '● Please check']].map(([color, label]) => (
          <span key={label} className="flex items-center gap-1 text-xs" style={{ color }}>
            {label}
          </span>
        ))}
      </div>

      {/* ── Scrollable item list ── */}
      <div className="flex-1 overflow-y-auto pb-28 px-4 pt-1">
        {editItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-2xl mb-2">👗</p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>All items removed. Tap Cancel to go back.</p>
          </div>
        )}

        {editItems.map((item, idx) => {
          const expanded = isExpanded(item.tempId);
          const accent = cardAccentColor(item);
          const pct = Math.round(avgConfidence(item) * 100);

          return (
            <div key={item.tempId} className="mb-3 rounded-2xl overflow-hidden"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${accent}` }}>

              {/* ── Compact row (always visible) ── */}
              <div className="flex gap-3 p-3 items-start">
                {/* Crop thumbnail — or add-image prompt when missing */}
                <div className="flex-shrink-0 rounded-xl overflow-hidden"
                  style={{ width: 64, height: 64, background: '#F2F2F4' }}>
                  {(item.croppedImageUrl || item.originalImageUrl) ? (
                    <img
                      src={item.croppedImageUrl || item.originalImageUrl}
                      alt={item.subcategory}
                      className="w-full h-full object-contain p-1"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setShowImageInput(p => ({ ...p, [item.tempId]: true }));
                        if (!expandedIds.has(item.tempId)) toggleExpand(item.tempId);
                      }}
                      className="w-full h-full flex flex-col items-center justify-center gap-0.5"
                      style={{ color: 'var(--accent)' }}
                      title="Add image"
                    >
                      <ImagePlus size={18} />
                      <span style={{ fontSize: 8, fontWeight: 600 }}>Add</span>
                    </button>
                  )}
                </div>

                {/* Summary text */}
                <div className="flex-1 min-w-0 py-0.5">
                  <p className="text-sm font-semibold capitalize leading-tight mb-1"
                    style={{ color: 'var(--text-primary)' }}>
                    {item.color} {item.subcategory}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{ background: 'var(--accent-light)', color: 'var(--accent-dark)' }}>
                      {CAT_LABELS[item.category]}
                    </span>
                    {item.brand && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                        {item.brand}
                      </span>
                    )}
                    {item.tags.slice(0, 2).map(t => (
                      <span key={t} className="text-[11px] px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Confidence % + Edit toggle */}
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0 pt-0.5">
                  <span className="text-[11px] font-semibold" style={{ color: accent }}>
                    {pct}% sure
                  </span>
                  <button
                    onClick={() => toggleExpand(item.tempId)}
                    className="flex items-center gap-1 text-xs font-medium"
                    style={{ color: expanded ? 'var(--text-secondary)' : 'var(--accent)' }}
                  >
                    {expanded ? <><ChevronUp size={13} /> Done</> : <><Pencil size={12} /> Edit</>}
                  </button>
                </div>
              </div>

              {/* ── Expanded edit form ── */}
              {expanded && (
                <div className="px-3 pb-3 pt-1 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>

                  {/* Image upload (shown when no image or user clicks Add) */}
                  {(!item.croppedImageUrl && !item.originalImageUrl) || showImageInput[item.tempId] ? (
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                        Product image
                      </span>
                      <div className="flex gap-2">
                        <input
                          value={imageUrlInputs[item.tempId] ?? ''}
                          onChange={e => setImageUrlInputs(p => ({ ...p, [item.tempId]: e.target.value }))}
                          onBlur={() => {
                            const v = (imageUrlInputs[item.tempId] ?? '').trim();
                            if (v && v.startsWith('http')) {
                              update(item.tempId, 'croppedImageUrl', v);
                              update(item.tempId, 'originalImageUrl', v);
                              setShowImageInput(p => ({ ...p, [item.tempId]: false }));
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const v = (imageUrlInputs[item.tempId] ?? '').trim();
                              if (v && v.startsWith('http')) {
                                update(item.tempId, 'croppedImageUrl', v);
                                update(item.tempId, 'originalImageUrl', v);
                                setShowImageInput(p => ({ ...p, [item.tempId]: false }));
                              }
                            }
                          }}
                          placeholder="Paste image URL…"
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          ref={el => { imgFileRefs.current[item.tempId] = el; }}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const b64 = await fileToBase64(file);
                            update(item.tempId, 'croppedImageUrl', b64);
                            update(item.tempId, 'originalImageUrl', b64);
                            setShowImageInput(p => ({ ...p, [item.tempId]: false }));
                          }}
                        />
                        <button
                          onClick={() => imgFileRefs.current[item.tempId]?.click()}
                          className="px-3 py-2 rounded-xl text-xs font-medium flex-shrink-0"
                          style={{ background: 'var(--accent-light)', color: 'var(--accent-dark)' }}
                        >
                          Upload
                        </button>
                      </div>
                      <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Tip: Right-click the product image on the website → "Copy image address" → paste here
                      </p>
                    </div>
                  ) : null}

                  {/* Subcategory */}
                  <ConfidenceField label="Item type" confidence={item.subcategoryConfidence}>
                    <input
                      value={item.subcategory}
                      onChange={e => update(item.tempId, 'subcategory', e.target.value)}
                      placeholder="e.g. blazer, straight-leg jeans…"
                      style={inputStyle}
                    />
                  </ConfidenceField>

                  {/* Category + Colour */}
                  <div className="grid grid-cols-2 gap-2">
                    <ConfidenceField label="Category" confidence={item.categoryConfidence}>
                      <select
                        value={item.category}
                        onChange={e => update(item.tempId, 'category', e.target.value as WardrobeItem['category'])}
                        style={selectStyle}
                      >
                        {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
                      </select>
                    </ConfidenceField>
                    <ConfidenceField label="Colour" confidence={item.colorConfidence}>
                      <input
                        value={item.color}
                        onChange={e => update(item.tempId, 'color', e.target.value)}
                        placeholder="e.g. navy"
                        style={inputStyle}
                      />
                    </ConfidenceField>
                  </div>

                  {/* Brand */}
                  <ConfidenceField
                    label="Brand"
                    confidence={item.brand ? item.brandConfidence : 0.85}
                  >
                    <input
                      value={item.brand}
                      onChange={e => update(item.tempId, 'brand', e.target.value)}
                      placeholder="e.g. Zara, Nike… (optional)"
                      style={inputStyle}
                    />
                  </ConfidenceField>

                  {/* Tags */}
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                      Style tags
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {item.tags.map(tag => (
                        <span key={tag} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs"
                          style={{ background: 'var(--accent-light)', color: 'var(--accent-dark)' }}>
                          {tag}
                          <button onClick={() => removeTag(item.tempId, tag)} className="flex-shrink-0 leading-none">
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                      <input
                        value={tagInputs[item.tempId] ?? ''}
                        onChange={e => setTagInputs(prev => ({ ...prev, [item.tempId]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitTag(item.tempId); } }}
                        onBlur={() => commitTag(item.tempId)}
                        placeholder="+ tag"
                        className="px-2.5 py-1 rounded-full text-xs outline-none"
                        style={{ background: 'var(--bg)', border: '1px dashed var(--border)', color: 'var(--text-secondary)', width: 68 }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Card footer ── */}
              <div className="px-3 py-2 flex items-center justify-between"
                style={{ borderTop: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Item {idx + 1} of {editItems.length}
                </span>
                <button onClick={() => removeItem(item.tempId)}
                  className="flex items-center gap-1 text-xs"
                  style={{ color: '#ef4444' }}>
                  <X size={12} /> Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Sticky CTA ── */}
      <div className="fixed bottom-0 left-0 right-0 z-[61] px-4 pb-8 pt-3 safe-area-bottom"
        style={{ background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
        <button
          onClick={handleConfirm}
          disabled={editItems.length === 0}
          className="w-full py-4 rounded-2xl font-medium text-white flex items-center justify-center gap-2 disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          <Check size={18} />
          Add {editItems.length} item{editItems.length !== 1 ? 's' : ''} to wardrobe
        </button>
      </div>
    </div>
  );
}
