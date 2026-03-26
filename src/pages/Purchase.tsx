import { useState, useRef, useEffect } from 'react';
import {
  Upload, Link2, ScanLine, Pencil,
  TrendingUp, Leaf, Heart, RefreshCw,
  Loader2, X, ShoppingBag, Sparkles,
} from 'lucide-react';
import { useUser, fileToBase64 } from '../store';
import { analyzePurchase, detectFabricFromImage, detectFabricFromUrl } from '../api';
import type { PurchaseAnalysis } from '../api';
import PageHeader from '../components/PageHeader';

// ── Types ────────────────────────────────────────────────────────────────────

type InputMethod = 'photo' | 'link' | 'scan' | 'manual';

interface LocalAnalysis extends PurchaseAnalysis {
  itemName: string;
  price: number;
  currency: string;
  imageUrl: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

const METHODS: { id: InputMethod; label: string; Icon: React.ElementType }[] = [
  { id: 'photo',  label: 'Photo',    Icon: Upload   },
  { id: 'link',   label: 'Link',     Icon: Link2    },
  { id: 'scan',   label: 'Scan tag', Icon: ScanLine },
  { id: 'manual', label: 'Manual',   Icon: Pencil   },
];

// Simple keyword → fabric map used as demo fallback for URL detection
const URL_FABRIC_HINTS: [string, string][] = [
  ['linen',     '100% linen'],
  ['cotton',    '100% cotton'],
  ['silk',      '100% silk'],
  ['cashmere',  '100% cashmere'],
  ['wool',      '100% wool'],
  ['denim',     '98% cotton, 2% elastane'],
  ['polyester', '100% polyester'],
  ['viscose',   '100% viscose'],
  ['velvet',    '80% polyester, 20% viscose'],
  ['satin',     '95% polyester, 5% elastane'],
  ['jersey',    '95% cotton, 5% elastane'],
  ['knit',      '60% acrylic, 40% wool'],
];

const REC = {
  'no brainer': {
    label: 'No brainer',
    color: '#15803D',
    bg: 'linear-gradient(135deg, #DCFCE7 0%, #BBF7D0 100%)',
    glow: '0 0 48px rgba(22,163,74,0.28)',
    border: '#86EFAC',
  },
  'why not': {
    label: 'Why not',
    color: '#1D4ED8',
    bg: 'linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%)',
    glow: '0 0 48px rgba(29,78,216,0.2)',
    border: '#93C5FD',
  },
  'maybe consider if you need it': {
    label: 'Maybe consider\nif you need it',
    color: '#C2410C',
    bg: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)',
    glow: '0 0 48px rgba(217,119,6,0.24)',
    border: '#FCD34D',
  },
} as const;

const PLASTIC = {
  'plastic-free': { label: 'Plastic-free', dot: '#15803D' },
  'low':          { label: 'Low impact',   dot: '#CA8A04' },
  'medium':       { label: 'Medium impact',dot: '#EA580C' },
  'high':         { label: 'High impact',  dot: '#DC2626' },
} as const;

const fieldStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
} as const;

// ── Component ────────────────────────────────────────────────────────────────

export default function Purchase() {
  const { user } = useUser();

  // Input
  const [method, setMethod]             = useState<InputMethod>('photo');
  const [itemName, setItemName]         = useState('');
  const [link, setLink]                 = useState('');
  const [price, setPrice]               = useState('');
  const [currency, setCurrency]         = useState('£');
  const [estimatedWears, setEstWears]   = useState('');
  const [fabric, setFabric]             = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64]   = useState<string | null>(null);

  // Auto-detect state
  const [fabricLoading, setFabricLoading]       = useState(false);
  const [fabricSource, setFabricSource]         = useState<'label' | 'inferred' | null>(null);

  // Submission
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [analysis, setAnalysis] = useState<LocalAnalysis | null>(null);
  const [badgeReady, setBadgeReady] = useState(false);
  const [wished, setWished]     = useState(false);

  const photoRef       = useRef<HTMLInputElement>(null);
  const scanRef        = useRef<HTMLInputElement>(null);
  const linkDebounce   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Spring-animate the badge when results land
  useEffect(() => {
    if (!analysis) return;
    setBadgeReady(false);
    const t = setTimeout(() => setBadgeReady(true), 100);
    return () => clearTimeout(t);
  }, [analysis]);

  // Auto-detect fabric from URL with 700 ms debounce
  useEffect(() => {
    if (method !== 'link') return;
    if (linkDebounce.current) clearTimeout(linkDebounce.current);
    if (!link || link.length < 10) return;

    linkDebounce.current = setTimeout(async () => {
      setFabricLoading(true);
      setFabricSource(null);
      try {
        const hasKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY;
        if (hasKey) {
          const res = await detectFabricFromUrl(link);
          if (res.fabric) { setFabric(res.fabric); setFabricSource('inferred'); }
          if (res.itemName && !itemName) setItemName(res.itemName);
        } else {
          // Demo: keyword match on URL
          const lower = link.toLowerCase();
          const hit = URL_FABRIC_HINTS.find(([k]) => lower.includes(k));
          if (hit) { setFabric(hit[1]); setFabricSource('inferred'); }
        }
      } catch { /* silently ignore */ }
      setFabricLoading(false);
    }, 700);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, method]);

  // Auto-detect fabric (+ item name) immediately after image is chosen
  const handleImage = async (file: File) => {
    const b64 = await fileToBase64(file);
    setImagePreview(URL.createObjectURL(file));
    setImageBase64(b64);
    setFabricLoading(true);
    setFabricSource(null);
    try {
      const hasKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY;
      if (hasKey) {
        const res = await detectFabricFromImage(b64);
        if (res.fabric) { setFabric(res.fabric); setFabricSource(res.source); }
        if (res.itemName && !itemName) setItemName(res.itemName);
      }
      // No demo fallback for image — can't analyse without the API
    } catch { /* silently ignore */ }
    setFabricLoading(false);
  };

  const analyse = async () => {
    if (!price) { setError('Please enter a price.'); return; }
    setError('');
    setLoading(true);
    try {
      const priceNum = parseFloat(price);
      const description =
        method === 'link'
          ? `Product URL: ${link}${itemName ? ` — ${itemName}` : ''}`
          : itemName || (method === 'scan' || method === 'photo' ? 'Item in photo' : 'Unknown item');

      const hasKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY;

      if (hasKey) {
        const result = await analyzePurchase(
          description, priceNum, currency,
          user.wardrobeItems,
          imageBase64 || undefined,
          estimatedWears ? parseInt(estimatedWears) : undefined,
          fabric || undefined,
        );
        setAnalysis({ ...result, itemName: description, price: priceNum, currency, imageUrl: imagePreview || '' });
      } else {
        // Demo fallback
        await new Promise(r => setTimeout(r, 1500));
        const ew = estimatedWears ? parseInt(estimatedWears) : priceNum > 100 ? 40 : 20;
        const cpw = Math.round((priceNum / ew) * 100) / 100;
        const plastic = fabric
          ? (['polyester','nylon','elastane','spandex','acrylic'].some(s => fabric.toLowerCase().includes(s)) ? 55 : 8)
          : 22;
        const impact: PurchaseAnalysis['plastic_impact'] =
          plastic <= 0 ? 'plastic-free' : plastic <= 30 ? 'low' : plastic <= 70 ? 'medium' : 'high';
        const impactCol: PurchaseAnalysis['impact_colour'] =
          plastic <= 0 ? 'green' : plastic <= 30 ? 'yellow' : plastic <= 70 ? 'orange' : 'red';
        const lifetime = priceNum > 150 ? 4 : priceNum > 60 ? 2.5 : 1.5;
        const fv = Math.round(priceNum * Math.pow(1.07, lifetime) * 100) / 100;
        const rec: PurchaseAnalysis['recommendation'] =
          cpw < 8 ? 'no brainer' : cpw < 25 ? 'why not' : 'maybe consider if you need it';
        setAnalysis({
          itemName: description, price: priceNum, currency, imageUrl: imagePreview || '',
          cost_per_wear: cpw, estimated_wears: ew,
          plastic_percentage: plastic, plastic_impact: impact, impact_colour: impactCol,
          estimated_lifetime_years: lifetime, future_value_if_invested: fv, recommendation: rec,
          reasoning: `At ${currency}${cpw.toFixed(2)} per wear over ~${ew} wears, this piece ${rec === 'no brainer' ? 'is a genuinely solid wardrobe investment' : rec === 'why not' ? 'could be a great addition if you love the style' : 'deserves a second thought before buying'}. Fabric estimated ~${plastic}% synthetic. If invested instead, ${currency}${priceNum} could grow to approximately ${currency}${fv} over ${lifetime} years at 7% annual return.`,
        });
      }
    } catch {
      setError('Analysis failed. Check your API key and try again.');
    }
    setLoading(false);
  };

  const reset = () => {
    setAnalysis(null); setWished(false); setBadgeReady(false);
    setItemName(''); setLink(''); setPrice(''); setFabric(''); setEstWears('');
    setImagePreview(null); setImageBase64(null); setError('');
    setFabricLoading(false); setFabricSource(null);
  };

  // ── Input screen ───────────────────────────────────────────────────────────
  if (!analysis) {
    return (
      <div className="px-4 pb-24">
        <PageHeader title="Buy decision" subtitle="Should you buy it? Let Anera decide." />

        {/* Method tabs */}
        <div className="flex gap-2 mb-5">
          {METHODS.map(({ id, label, Icon }) => {
            const active = method === id;
            return (
              <button
                key={id}
                onClick={() => setMethod(id)}
                className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl text-xs font-medium transition-all"
                style={{
                  background: active ? 'var(--accent-light)' : 'var(--surface)',
                  border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  color: active ? 'var(--accent-dark)' : 'var(--text-secondary)',
                }}
              >
                <Icon size={15} />
                {label}
              </button>
            );
          })}
        </div>

        {/* Photo / Scan upload area */}
        {(method === 'photo' || method === 'scan') && (
          <div
            onClick={() => (method === 'photo' ? photoRef : scanRef).current?.click()}
            className="w-full rounded-3xl cursor-pointer mb-5 overflow-hidden relative flex items-center justify-center"
            style={{
              border: imagePreview ? 'none' : '1.5px dashed var(--border)',
              background: imagePreview ? 'transparent' : 'var(--surface)',
              minHeight: '200px',
            }}
          >
            {imagePreview ? (
              <>
                <img
                  src={imagePreview}
                  className="w-full object-cover rounded-3xl"
                  style={{ maxHeight: '280px' }}
                  alt="Item preview"
                />
                <button
                  onClick={e => { e.stopPropagation(); setImagePreview(null); setImageBase64(null); setFabric(''); setFabricSource(null); }}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(0,0,0,0.55)' }}
                >
                  <X size={14} color="white" />
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-10">
                <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-light)' }}>
                  {method === 'scan'
                    ? <ScanLine size={24} style={{ color: 'var(--accent)' }} />
                    : <Upload   size={24} style={{ color: 'var(--accent)' }} />
                  }
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {method === 'scan' ? 'Scan product tag' : 'Upload item photo'}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {method === 'scan'
                    ? 'Point camera at the care label — fabric auto-detected'
                    : 'Fabric auto-detected from image or label'}
                </p>
              </div>
            )}
            <input
              ref={method === 'photo' ? photoRef : scanRef}
              type="file" accept="image/*"
              capture={method === 'scan' ? 'environment' : undefined}
              className="hidden"
              onChange={e => e.target.files?.[0] && handleImage(e.target.files[0])}
            />
          </div>
        )}

        {/* Link input */}
        {method === 'link' && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Product URL
              </label>
              {fabricLoading && (
                <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--accent)' }}>
                  <Loader2 size={10} className="animate-spin" /> Reading link…
                </span>
              )}
            </div>
            <input
              type="url" value={link} onChange={e => setLink(e.target.value)}
              placeholder="https://www.zara.com/…"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={fieldStyle}
            />
          </div>
        )}

        {/* Item name */}
        <div className="mb-3">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Item name{method !== 'manual' && (
              <span style={{ fontWeight: 400 }}> (optional)</span>
            )}
          </label>
          <input
            type="text" value={itemName} onChange={e => setItemName(e.target.value)}
            placeholder="e.g. Black ankle boots, silk midi dress…"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none"
            style={fieldStyle}
          />
        </div>

        {/* Price row */}
        <div className="flex gap-2 mb-4">
          <div className="w-20">
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Currency</label>
            <select
              value={currency} onChange={e => setCurrency(e.target.value)}
              className="w-full px-3 py-3 rounded-xl text-sm outline-none"
              style={fieldStyle}
            >
              {['£','$','€','¥'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Price</label>
            <input
              type="number" value={price} onChange={e => setPrice(e.target.value)}
              placeholder="0.00" min="0"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={fieldStyle}
            />
          </div>
        </div>

        {/* Fabric composition — auto-detected */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Fabric composition
            </label>
            {fabricLoading && (
              <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--accent)' }}>
                <Loader2 size={10} className="animate-spin" /> Detecting…
              </span>
            )}
            {!fabricLoading && fabricSource && fabric && (
              <span
                className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: '#DCFCE7', color: '#15803D' }}
              >
                <Sparkles size={9} />
                {fabricSource === 'label' ? 'Read from label' : 'Auto-detected'}
              </span>
            )}
          </div>
          <div className="relative">
            <input
              type="text" value={fabric}
              onChange={e => { setFabric(e.target.value); setFabricSource(null); }}
              placeholder={
                method === 'manual'
                  ? 'e.g. 80% cotton, 20% polyester'
                  : fabricLoading
                    ? 'Detecting…'
                    : 'e.g. 80% cotton, 20% polyester (auto-detected)'
              }
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{
                ...fieldStyle,
                borderColor: (fabricSource && fabric) ? '#86EFAC' : 'var(--border)',
                paddingRight: fabricLoading ? '2.5rem' : undefined,
              }}
            />
            {fabricLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            )}
          </div>
        </div>

        {/* Estimated wears — optional */}
        <div className="mb-5">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Estimated number of wears <span style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="number" value={estimatedWears} onChange={e => setEstWears(e.target.value)}
            placeholder="e.g. 40 — Anera will infer if left blank"
            min="1"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none"
            style={fieldStyle}
          />
        </div>

        {error && (
          <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: '#FEE2E2', color: '#DC2626' }}>
            {error}
          </div>
        )}

        <button
          onClick={analyse}
          disabled={loading}
          className="w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2"
          style={{ background: 'var(--accent)' }}
        >
          {loading
            ? <><Loader2 size={18} className="animate-spin" />Analysing…</>
            : <>Analyse purchase</>
          }
        </button>
      </div>
    );
  }

  // ── Results screen ─────────────────────────────────────────────────────────
  const rec     = REC[analysis.recommendation];
  const plastic = PLASTIC[analysis.plastic_impact];

  return (
    <div className="pb-28">
      <div className="px-4">
        <PageHeader
          title="Buy decision"
          subtitle={analysis.itemName.length > 42 ? analysis.itemName.slice(0, 42) + '…' : analysis.itemName}
        />
      </div>

      {/* ── 1. Hero image ── */}
      <div className="px-4 mb-6">
        <div
          className="w-full rounded-3xl overflow-hidden flex items-center justify-center"
          style={{
            background: analysis.imageUrl ? 'transparent' : '#F8F8F8',
            border: analysis.imageUrl ? 'none' : '1px solid var(--border)',
            minHeight: '220px',
          }}
        >
          {analysis.imageUrl ? (
            <img
              src={analysis.imageUrl}
              className="w-full object-cover rounded-3xl"
              style={{ maxHeight: '300px' }}
              alt={analysis.itemName}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 py-14">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-light)' }}>
                <ShoppingBag size={28} style={{ color: 'var(--accent)' }} />
              </div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{analysis.itemName}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Decision badge ── */}
      <div className="flex flex-col items-center px-4 mb-7">
        <div
          style={{
            background: rec.bg,
            border: `2px solid ${rec.border}`,
            boxShadow: badgeReady ? rec.glow : 'none',
            borderRadius: '9999px',
            padding: '16px 36px',
            animation: badgeReady ? 'badge-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : 'none',
            opacity: badgeReady ? undefined : 0,
          }}
        >
          <p
            className="text-2xl font-bold text-center tracking-tight"
            style={{ color: rec.color, whiteSpace: 'pre-line', lineHeight: 1.25 }}
          >
            {rec.label}
          </p>
        </div>
        <p
          className="text-xs mt-2.5"
          style={{
            color: 'var(--text-secondary)',
            animation: badgeReady ? 'fade-up 0.4s ease 0.3s both' : 'none',
          }}
        >
          {analysis.currency}{analysis.price} · {analysis.currency}{analysis.cost_per_wear.toFixed(2)} per wear
        </p>
      </div>

      {/* ── 3. Stat cards ── */}
      <div
        className="grid grid-cols-3 gap-3 px-4 mb-5"
        style={{ animation: badgeReady ? 'fade-up 0.4s ease 0.2s both' : 'none' }}
      >
        {[
          { label: 'Cost / wear', value: `${analysis.currency}${analysis.cost_per_wear.toFixed(2)}` },
          { label: 'Est. wears',  value: `~${analysis.estimated_wears}` },
          { label: 'If invested', value: `${analysis.currency}${analysis.future_value_if_invested.toFixed(0)}` },
        ].map(stat => (
          <div
            key={stat.label}
            className="rounded-2xl px-3 py-4 text-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{stat.value}</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── 4. Plastic impact bar ── */}
      <div className="px-4 mb-5">
        <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Leaf size={14} style={{ color: '#16A34A' }} />
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Plastic impact</span>
            <span className="ml-auto text-xs font-semibold" style={{ color: plastic.dot }}>{plastic.label}</span>
          </div>
          <div
            className="relative h-3 rounded-full mb-2"
            style={{
              background: 'linear-gradient(to right, #16A34A 0%, #CA8A04 30%, #EA580C 70%, #DC2626 100%)',
              overflow: 'visible',
            }}
          >
            <div
              className="absolute w-5 h-5 rounded-full border-2 border-white shadow-md"
              style={{
                left: `${Math.min(100, Math.max(0, analysis.plastic_percentage))}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                background: plastic.dot,
                transition: 'left 0.9s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          </div>
          <div className="flex justify-between text-[9px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            <span>0%</span><span>30%</span><span>70%</span><span>100%</span>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
            ~{analysis.plastic_percentage}% synthetic materials
            {analysis.plastic_percentage === 0 && ' — fully natural fibres 🌿'}
          </p>
        </div>
      </div>

      {/* ── 5. Investment insight ── */}
      <div className="px-4 mb-5">
        <div className="rounded-2xl px-4 py-4" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: '#DCFCE7' }}>
              <TrendingUp size={15} style={{ color: '#15803D' }} />
            </div>
            <div>
              <p className="text-xs font-semibold mb-1" style={{ color: '#15803D' }}>Investment insight</p>
              <p className="text-xs leading-relaxed" style={{ color: '#166534' }}>
                If invested instead, this{' '}
                <span className="font-semibold">{analysis.currency}{analysis.price}</span>{' '}
                could grow to approximately{' '}
                <span className="font-semibold">{analysis.currency}{analysis.future_value_if_invested.toFixed(0)}</span>{' '}
                over ~{analysis.estimated_lifetime_years} years at 7% annual return.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 6. Reasoning ── */}
      <div className="px-4 mb-6">
        <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{analysis.reasoning}</p>
        </div>
      </div>

      {/* ── 7. Action buttons ── */}
      <div className="px-4 flex gap-3">
        <button
          onClick={() => setWished(v => !v)}
          className="flex-1 py-3.5 rounded-2xl font-medium text-sm flex items-center justify-center gap-2 transition-all"
          style={{
            background: wished ? '#FEE2E2' : 'var(--surface)',
            border: `1.5px solid ${wished ? '#FECACA' : 'var(--border)'}`,
            color: wished ? '#DC2626' : 'var(--text-primary)',
          }}
        >
          <Heart size={15} fill={wished ? '#DC2626' : 'none'} strokeWidth={wished ? 0 : 2} />
          {wished ? 'Saved ✓' : 'Save to wishlist'}
        </button>
        <button
          onClick={reset}
          className="flex-1 py-3.5 rounded-2xl font-medium text-sm flex items-center justify-center gap-2"
          style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', color: 'var(--text-primary)' }}
        >
          <RefreshCw size={15} />
          Compare another
        </button>
      </div>
    </div>
  );
}
