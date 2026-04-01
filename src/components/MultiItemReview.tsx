import { useState, useRef, useCallback } from 'react';
import { Check, X, Pencil, ChevronUp, ImagePlus, Crop, Maximize } from 'lucide-react';
import type { DetectedItem, WardrobeItem } from '../types';
import { genId, fileToBase64 } from '../store';

/**
 * Compress a base64 image to fit comfortably in localStorage.
 * Resizes to max 400px and converts to JPEG at 0.75 quality.
 * This keeps each image under ~60-80KB instead of 2-5MB PNGs.
 */
async function compressForStorage(dataUrl: string, maxDim = 400): Promise<string> {
  // Skip if it's a blob URL or not a data URL — can't compress
  if (!dataUrl.startsWith('data:')) return dataUrl;
  // Skip if already small enough (under 100KB)
  if (dataUrl.length < 100_000) return dataUrl;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', 0.75);
      canvas.width = 0; canvas.height = 0; // free memory
      console.log(`[Compress] ${Math.round(dataUrl.length / 1024)}KB → ${Math.round(compressed.length / 1024)}KB`);
      resolve(compressed);
    };
    img.onerror = () => resolve(dataUrl); // fallback: return original
    img.src = dataUrl;
  });
}

const CATEGORIES: WardrobeItem['category'][] = ['top', 'bottom', 'footwear', 'outerwear', 'dress', 'bag', 'jewellery', 'belt', 'hat'];
const CAT_LABELS: Record<WardrobeItem['category'], string> = {
  top: 'Top', bottom: 'Bottom', footwear: 'Footwear',
  outerwear: 'Outerwear', dress: 'Dress', bag: 'Bag', jewellery: 'Jewellery',
  belt: 'Belt', hat: 'Hat',
};

// ── Design tokens ─────────────────────────────────────────────────────────
const CARAMEL = '#C4956A';
const CARAMEL_DARK = '#A67B52';
const CARAMEL_LIGHT = '#F0E6DA';
const SAGE = '#C5CEAE';
const SAGE_DARK = '#2D8B73';
const BUTTER = '#F0DEB4';
const BUTTER_DARK = '#92400E';
const SURFACE = '#FFFFFF';
const BG = '#F5F0EB';
const SHADOW = '0 4px 20px rgba(0,0,0,0.05)';
const SOFT_RED = '#FEE2E2';
const SOFT_RED_TEXT = '#DC2626';
const SOFT_RED_BORDER = '#FECACA';

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

function confidenceColor(item: DetectedItem): { bg: string; text: string; dot: string } {
  const mc = minConfidence(item);
  if (mc >= 0.85) return { bg: SAGE, text: SAGE_DARK, dot: SAGE_DARK };
  if (mc >= 0.6) return { bg: BUTTER, text: BUTTER_DARK, dot: '#D97706' };
  return { bg: SOFT_RED, text: SOFT_RED_TEXT, dot: SOFT_RED_TEXT };
}

// ── ConfidenceField: input with confidence-based visual styling ─────────────

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
      <div className="flex items-center gap-1.5 mb-1.5">
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9CA3AF' }}>
          {label}
        </span>
        {isHigh && (
          <span style={{ fontSize: 11, color: SAGE_DARK, opacity: 0.85, fontWeight: 700, lineHeight: 1 }}>&#10003;</span>
        )}
        {isMed && (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#D97706', display: 'inline-block', flexShrink: 0 }} />
        )}
        {isLow && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
            background: BUTTER, color: BUTTER_DARK, border: 'none',
            letterSpacing: '0.03em', lineHeight: '1.6',
          }}>
            Please confirm
          </span>
        )}
      </div>
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
      borderRadius: 12,
      outline: isLow ? `1.5px solid ${BUTTER}` : undefined,
      background: isLow ? '#FFFDF5' : undefined,
      borderBottom: isMed ? '2px solid #D97706' : undefined,
      overflow: 'hidden',
    }}>
      {children}
    </div>
  );
}

// ── Shared input style ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: BG,
  border: '1.5px solid #E5E7EB',
  borderRadius: 12,
  padding: '10px 12px',
  fontSize: 13,
  color: '#1F2937',
  outline: 'none',
  width: '100%',
  transition: 'border-color 0.2s, box-shadow 0.2s',
};

const inputFocusStyle = `
  .anera-input:focus {
    border-color: ${CARAMEL} !important;
    box-shadow: 0 0 0 3px rgba(196, 149, 106, 0.2) !important;
  }
  .anera-select:focus {
    border-color: ${CARAMEL} !important;
    box-shadow: 0 0 0 3px rgba(196, 149, 106, 0.2) !important;
  }
`;

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
  // Track which items the user toggled to use the original (uncropped) image
  const [useOriginal, setUseOriginal] = useState<Record<string, boolean>>({});
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

  const [saving, setSaving] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (editItems.length === 0) { onCancel(); return; }
    setSaving(true);
    try {
      // Compress all images in parallel before storing
      const wardrobeItems: WardrobeItem[] = await Promise.all(
        editItems.map(async (d) => {
          const rawUrl = useOriginal[d.tempId]
            ? (d.bgRemovedImageUrl || d.originalImageUrl || d.croppedImageUrl)
            : (d.croppedImageUrl || d.originalImageUrl);
          const imageUrl = await compressForStorage(rawUrl);
          return {
            id: genId(),
            imageUrl,
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
          };
        })
      );
      onConfirm(wardrobeItems);
    } finally {
      setSaving(false);
    }
  }, [editItems, useOriginal, onConfirm, onCancel]);

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: BG }}>

      {/* Inject focus styles */}
      <style>{inputFocusStyle}</style>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
        style={{ background: SURFACE, boxShadow: '0 1px 8px rgba(0,0,0,0.04)' }}>
        <button onClick={onCancel} className="flex items-center gap-1.5 text-sm"
          style={{ color: '#9CA3AF' }}>
          <X size={18} /> Cancel
        </button>
        <p className="text-sm font-semibold" style={{ color: '#1F2937' }}>
          {editItems.length} item{editItems.length !== 1 ? 's' : ''} detected
        </p>
        <button onClick={handleConfirm} disabled={editItems.length === 0 || saving}
          className="flex items-center gap-1.5 text-sm font-semibold disabled:opacity-40"
          style={{ color: CARAMEL_DARK }}>
          <Check size={16} /> {saving ? 'Saving...' : 'Save all'}
        </button>
      </div>

      {/* ── Legend ── */}
      <div className="px-5 pt-3 pb-2 flex-shrink-0 flex items-center gap-4 flex-wrap">
        <span className="text-xs font-medium" style={{ color: '#9CA3AF' }}>Confidence:</span>
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: SAGE_DARK }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: SAGE, border: `1.5px solid ${SAGE_DARK}`, display: 'inline-block' }} />
          High
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: '#D97706' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: BUTTER, border: '1.5px solid #D97706', display: 'inline-block' }} />
          Unsure
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: SOFT_RED_TEXT }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: SOFT_RED, border: `1.5px solid ${SOFT_RED_TEXT}`, display: 'inline-block' }} />
          Check
        </span>
      </div>

      {/* ── Scrollable item list ── */}
      <div className="flex-1 overflow-y-auto pb-28 px-4 pt-2">
        {editItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-2xl mb-3" role="img" aria-label="dress">&#128087;</p>
            <p className="text-sm" style={{ color: '#9CA3AF' }}>All items removed. Tap Cancel to go back.</p>
          </div>
        )}

        {editItems.map((item, idx) => {
          const expanded = isExpanded(item.tempId);
          const conf = confidenceColor(item);
          const pct = Math.round(avgConfidence(item) * 100);

          return (
            <div key={item.tempId} className="mb-4 rounded-2xl overflow-hidden"
              style={{
                background: SURFACE,
                boxShadow: SHADOW,
                border: '1px solid #F3F4F6',
              }}>

              {/* ── Compact row (always visible) ── */}
              <div className="flex gap-3.5 p-3.5 items-start">
                {/* Crop thumbnail */}
                <div className="flex-shrink-0 rounded-2xl overflow-hidden"
                  style={{ width: 68, height: 68, background: BG, border: '1px solid #F3F4F6' }}>
                  {(item.croppedImageUrl || item.originalImageUrl) ? (
                    <img
                      src={useOriginal[item.tempId] ? (item.bgRemovedImageUrl || item.originalImageUrl || item.croppedImageUrl) : (item.croppedImageUrl || item.originalImageUrl)}
                      alt={item.subcategory}
                      className="w-full h-full object-contain p-1.5"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setShowImageInput(p => ({ ...p, [item.tempId]: true }));
                        if (!expandedIds.has(item.tempId)) toggleExpand(item.tempId);
                      }}
                      className="w-full h-full flex flex-col items-center justify-center gap-0.5"
                      style={{ color: CARAMEL_DARK }}
                      title="Add image"
                    >
                      <ImagePlus size={20} />
                      <span style={{ fontSize: 9, fontWeight: 600 }}>Add</span>
                    </button>
                  )}
                </div>

                {/* Summary text */}
                <div className="flex-1 min-w-0 py-0.5">
                  <p className="text-sm font-semibold capitalize leading-tight mb-1.5"
                    style={{ color: '#1F2937' }}>
                    {item.color} {item.subcategory}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-medium"
                      style={{ background: CARAMEL_LIGHT, color: CARAMEL_DARK }}>
                      {CAT_LABELS[item.category]}
                    </span>
                    {item.brand && (
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full font-medium"
                        style={{ background: BG, color: '#6B7280', border: '1px solid #E5E7EB' }}>
                        {item.brand}
                      </span>
                    )}
                    {item.tags.slice(0, 2).map(t => (
                      <span key={t} className="text-[11px] px-2.5 py-0.5 rounded-full font-medium"
                        style={{ background: SAGE, color: SAGE_DARK }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Confidence % + Edit toggle */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0 pt-0.5">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: conf.bg, color: conf.text }}>
                    {pct}%
                  </span>
                  <button
                    onClick={() => toggleExpand(item.tempId)}
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full transition-all"
                    style={{
                      color: expanded ? '#6B7280' : CARAMEL_DARK,
                      background: expanded ? '#F3F4F6' : CARAMEL_LIGHT,
                    }}
                  >
                    {expanded ? <><ChevronUp size={13} /> Done</> : <><Pencil size={12} /> Edit</>}
                  </button>
                </div>
              </div>

              {/* ── Expanded edit form ── */}
              {expanded && (
                <div className="px-4 pb-4 pt-2 space-y-3.5" style={{ borderTop: '1px solid #F3F4F6', background: '#FDFBF7' }}>

                  {/* Cropped vs No-crop toggle */}
                  {item.croppedImageUrl && (item.bgRemovedImageUrl || item.originalImageUrl) && (
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9CA3AF', display: 'block', marginBottom: 8 }}>
                        Photo
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setUseOriginal(p => ({ ...p, [item.tempId]: false }))}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-xs font-semibold transition-all"
                          style={{
                            background: !useOriginal[item.tempId] ? CARAMEL : BG,
                            color: !useOriginal[item.tempId] ? '#1F2937' : '#9CA3AF',
                            border: `1.5px solid ${!useOriginal[item.tempId] ? CARAMEL_DARK : '#E5E7EB'}`,
                            boxShadow: !useOriginal[item.tempId] ? '0 2px 8px rgba(196,149,106,0.3)' : 'none',
                          }}
                        >
                          <Crop size={13} /> Cropped
                        </button>
                        <button
                          onClick={() => setUseOriginal(p => ({ ...p, [item.tempId]: true }))}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-xs font-semibold transition-all"
                          style={{
                            background: useOriginal[item.tempId] ? CARAMEL : BG,
                            color: useOriginal[item.tempId] ? '#1F2937' : '#9CA3AF',
                            border: `1.5px solid ${useOriginal[item.tempId] ? CARAMEL_DARK : '#E5E7EB'}`,
                            boxShadow: useOriginal[item.tempId] ? '0 2px 8px rgba(196,149,106,0.3)' : 'none',
                          }}
                        >
                          <Maximize size={13} /> No crop
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Image upload (shown when no image or user clicks Add) */}
                  {(!item.croppedImageUrl && !item.originalImageUrl) || showImageInput[item.tempId] ? (
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9CA3AF', display: 'block', marginBottom: 8 }}>
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
                          placeholder="Paste image URL..."
                          className="anera-input"
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
                          className="px-4 py-2.5 rounded-full text-xs font-semibold flex-shrink-0 transition-all"
                          style={{ background: CARAMEL_LIGHT, color: CARAMEL_DARK, border: `1px solid ${CARAMEL}` }}
                        >
                          Upload
                        </button>
                      </div>
                      <p className="text-[10px] mt-1.5" style={{ color: '#9CA3AF' }}>
                        Tip: Right-click the product image on the website, "Copy image address", paste here
                      </p>
                    </div>
                  ) : null}

                  {/* Subcategory */}
                  <ConfidenceField label="Item type" confidence={item.subcategoryConfidence}>
                    <input
                      value={item.subcategory}
                      onChange={e => update(item.tempId, 'subcategory', e.target.value)}
                      placeholder="e.g. blazer, straight-leg jeans..."
                      className="anera-input"
                      style={inputStyle}
                    />
                  </ConfidenceField>

                  {/* Category + Colour */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <ConfidenceField label="Category" confidence={item.categoryConfidence}>
                      <select
                        value={item.category}
                        onChange={e => update(item.tempId, 'category', e.target.value as WardrobeItem['category'])}
                        className="anera-select"
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
                        className="anera-input"
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
                      placeholder="e.g. Zara, Nike... (optional)"
                      className="anera-input"
                      style={inputStyle}
                    />
                  </ConfidenceField>

                  {/* Tags */}
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9CA3AF', display: 'block', marginBottom: 8 }}>
                      Style tags
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {item.tags.map(tag => (
                        <span key={tag} className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium"
                          style={{ background: SAGE, color: SAGE_DARK }}>
                          {tag}
                          <button onClick={() => removeTag(item.tempId, tag)} className="flex-shrink-0 leading-none ml-0.5 opacity-70 hover:opacity-100 transition-opacity">
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                      <input
                        value={tagInputs[item.tempId] ?? ''}
                        onChange={e => setTagInputs(prev => ({ ...prev, [item.tempId]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitTag(item.tempId); } }}
                        onBlur={() => commitTag(item.tempId)}
                        placeholder="+ tag"
                        className="anera-input px-3 py-1.5 rounded-full text-xs outline-none"
                        style={{ background: BG, border: `1.5px dashed ${CARAMEL}`, color: CARAMEL_DARK, width: 72, fontSize: 12 }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Card footer ── */}
              <div className="px-4 py-2.5 flex items-center justify-between"
                style={{ borderTop: '1px solid #F3F4F6', background: BG }}>
                <span className="text-xs font-medium" style={{ color: '#9CA3AF' }}>
                  Item {idx + 1} of {editItems.length}
                </span>
                <button onClick={() => removeItem(item.tempId)}
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full transition-all"
                  style={{ color: SOFT_RED_TEXT, background: SOFT_RED, border: `1px solid ${SOFT_RED_BORDER}` }}>
                  <X size={12} /> Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Sticky CTA ── */}
      <div className="fixed bottom-0 left-0 right-0 z-[61] px-5 pb-8 pt-4 safe-area-bottom"
        style={{ background: `linear-gradient(to top, ${BG} 70%, transparent)` }}>
        <button
          onClick={handleConfirm}
          disabled={editItems.length === 0 || saving}
          className="w-full py-4 rounded-full font-semibold flex items-center justify-center gap-2.5 disabled:opacity-40 transition-all"
          style={{
            background: CARAMEL,
            color: '#1F2937',
            boxShadow: '0 4px 20px rgba(196,149,106,0.4)',
            fontSize: 15,
          }}
        >
          <Check size={18} />
          {saving ? 'Saving...' : `Add ${editItems.length} item${editItems.length !== 1 ? 's' : ''} to wardrobe`}
        </button>
      </div>
    </div>
  );
}
