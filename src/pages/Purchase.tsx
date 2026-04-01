import { useState, useRef, useEffect } from 'react';
import {
  Upload, Link2, ScanLine, Pencil,
  TrendingUp, Leaf, Heart, RefreshCw,
  Loader2, X, CircleDollarSign, Sparkles,
} from 'lucide-react';
import { useUser, fileToBase64 } from '../store';
import { analyzePurchase, detectFabricFromImage, detectFabricFromUrl } from '../api';
import { hasClaudeKey, scrapeUrl } from '../apiHelper';
import type { PurchaseAnalysis } from '../api';


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
  ['polyamide', '100% polyamide'],
  ['nylon',     '100% nylon'],
  ['viscose',   '100% viscose'],
  ['velvet',    '80% polyester, 20% viscose'],
  ['satin',     '95% polyester, 5% elastane'],
  ['jersey',    '95% cotton, 5% elastane'],
  ['knit',      '60% acrylic, 40% wool'],
  ['lycra',     '90% nylon, 10% lycra'],
  ['modal',     '100% modal'],
  ['tencel',    '100% tencel'],
  ['lyocell',   '100% lyocell'],
  ['rayon',     '100% rayon'],
];

/** All synthetic / plastic-derived fibre names */
const SYNTHETIC_FIBRES = [
  'polyester', 'nylon', 'elastane', 'spandex', 'acrylic',
  'polyamide', 'microfibre', 'microfiber', 'lycra', 'lurex',
  'polypropylene', 'polyurethane', 'pvc', 'vinyl',
  'modacrylic', 'aramid', 'olefin',
];

/** Infer synthetic % from item name when fabric composition is unknown */
function inferSyntheticFromItem(name: string): number {
  const n = name.toLowerCase();
  // Denim / jeans → typically 98-100% cotton
  if (/\bjeans\b|\bdenim\b/.test(n)) return 2;
  // Cotton basics
  if (/\bcotton\b|\blinen\b|\bsilk\b|\bwool\b|\bcashmere\b/.test(n)) return 0;
  // Activewear / sportswear → high synthetic
  if (/\bsport|\bactive|\bgym|\byoga|\blegging/.test(n)) return 75;
  // Knitwear — varies, assume moderate blend
  if (/\bknit|\bsweater|\bcardigan|\bjumper/.test(n)) return 30;
  // Blouse / shirt → usually natural or minimal synthetic
  if (/\bblouse\b|\bshirt\b/.test(n)) return 5;
  // Dress → moderate default
  if (/\bdress\b/.test(n)) return 20;
  // Outerwear / coats — moderate
  if (/\bjacket\b|\bcoat\b|\bblazer\b/.test(n)) return 25;
  // Shoes / boots — mixed
  if (/\bshoe|\bboot|\bsneaker|\bheel|\bsandal/.test(n)) return 40;
  // Default unknown item
  return 20;
}

/** Infer realistic lifetime in years from item type + price.
 *  Price is a major factor — higher quality items last significantly longer. */
function inferLifetime(name: string, p: number): number {
  const n = name.toLowerCase();
  // Jeans / denim — extremely durable
  if (/\bjeans\b|\bdenim\b/.test(n)) return p > 150 ? 8 : p > 80 ? 6 : p > 40 ? 4 : 3;
  // Coats / outerwear — built to last
  if (/\bcoat\b|\bjacket\b|\bblazer\b|\bparka\b|\btrench/.test(n)) return p > 300 ? 10 : p > 150 ? 7 : p > 70 ? 5 : 3;
  // Leather goods — ages beautifully, lasts decades if quality
  if (/\bleather\b/.test(n)) return p > 300 ? 20 : p > 150 ? 15 : p > 80 ? 10 : 7;
  // Shoes / boots
  if (/\bboot|\bshoe/.test(n)) return p > 200 ? 8 : p > 100 ? 5 : p > 50 ? 3.5 : 2;
  // Sneakers — wear faster
  if (/\bsneaker|\btrainer/.test(n)) return p > 150 ? 4 : p > 80 ? 3 : 2;
  // Blouses / shirts
  if (/\bblouse\b|\bshirt\b/.test(n)) return p > 150 ? 6 : p > 80 ? 4.5 : p > 40 ? 3.5 : 2.5;
  // Knitwear — good quality lasts ages
  if (/\bsweater\b|\bcardigan\b|\bjumper\b|\bknit/.test(n)) return p > 150 ? 7 : p > 80 ? 5 : p > 40 ? 3.5 : 2.5;
  // Dresses
  if (/\bdress\b/.test(n)) return p > 200 ? 7 : p > 100 ? 5 : p > 50 ? 3.5 : 2.5;
  // Skirts / trousers
  if (/\bskirt\b|\btrouser\b|\bpant\b|\bchino/.test(n)) return p > 100 ? 5 : p > 50 ? 4 : 3;
  // T-shirts / basics — shorter lifespan
  if (/\bt-shirt\b|\btee\b|\btank\b|\bvest\b|\bcami/.test(n)) return p > 60 ? 4 : p > 30 ? 2.5 : 1.5;
  // Bags — very durable
  if (/\bbag\b|\btote\b|\bpurse\b|\bbackpack/.test(n)) return p > 200 ? 10 : p > 80 ? 6 : 3;
  // Accessories / scarves
  if (/\bscarf\b|\bhat\b|\bbelt\b|\bglove/.test(n)) return p > 80 ? 6 : p > 30 ? 4 : 2.5;
  // Generic fallback — price-sensitive
  return p > 200 ? 7 : p > 100 ? 5 : p > 50 ? 3.5 : 2.5;
}

const REC = {
  'no brainer': {
    label: 'No brainer',
    color: '#5C4A32',
    bg: 'linear-gradient(135deg, #F0EBE3 0%, #8B7355 100%)',
    glow: '0 0 48px rgba(139,115,85,0.3)',
    border: '#8B7355',
  },
  'why not': {
    label: 'Why not',
    color: '#5C7A52',
    bg: 'linear-gradient(135deg, #E2EACE 0%, #C5CEAE 100%)',
    glow: '0 0 48px rgba(197,206,174,0.3)',
    border: '#C5CEAE',
  },
  'maybe consider if you need it': {
    label: 'Maybe consider if you need it',
    color: '#7A5C3E',
    bg: 'linear-gradient(135deg, #F0DEB4 0%, #E8D098 100%)',
    glow: '0 0 48px rgba(240,222,180,0.35)',
    border: '#F0DEB4',
  },
} as const;

const PLASTIC = {
  'plastic-free': { label: 'Plastic-free', dot: '#8B7355' },
  'low':          { label: 'Low impact',   dot: '#A3B18A' },
  'medium':       { label: 'Medium impact',dot: '#E8D098' },
  'high':         { label: 'High impact',  dot: '#DC2626' },
} as const;

const fieldStyle = {
  background: '#FFFFFF',
  border: '1px solid rgba(43,43,43,0.08)',
  color: '#2B2B2B',
  boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
} as const;

const labelStyle = {
  color: 'rgba(43,43,43,0.45)',
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  fontWeight: 700,
  letterSpacing: '0.4px',
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
  const [lifetimeYrs, setLifetimeYrs]   = useState('');   // optional item lifetime in years
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64]   = useState<string | null>(null);

  // Auto-detect state
  const [fabricLoading, setFabricLoading]       = useState(false);
  const [fabricSource, setFabricSource]         = useState<'label' | 'inferred' | null>(null);
  const [urlDetecting, setUrlDetecting]         = useState(false);
  const [urlDetected, setUrlDetected]           = useState(false);
  const [urlError, setUrlError]                 = useState('');

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

  // Detect product details from URL — called manually or auto-triggered
  const detectFromUrl = async (url: string) => {
    if (!url || url.length < 10) return;
    setUrlDetecting(true);
    setUrlDetected(false);
    setUrlError('');
    setFabricLoading(true);
    setFabricSource(null);
    try {
      let detected = false;

      // Step 1: Scrape once — reuse for both structured data + Claude fabric call
      const scraped = await scrapeUrl(url).catch(() => ({ text: '' } as Awaited<ReturnType<typeof scrapeUrl>>));

      // Use structured product data directly (Shopify, AJAX handlers, etc.)
      if (scraped.productName) { setItemName(scraped.productName); detected = true; }
      if (scraped.productPrice && scraped.productPrice > 0) {
        setPrice(String(scraped.productPrice));
        detected = true;
      }
      if (scraped.productCurrency) {
        const sym = scraped.productCurrency === 'GBP' ? '£' : scraped.productCurrency === 'USD' ? '$' : scraped.productCurrency === 'EUR' ? '€' : scraped.productCurrency;
        setCurrency(sym);
      }

      // Step 2: Use Claude API for fabric + any fields still missing
      // Pass pre-scraped data so it doesn't call /api/scrape a second time
      const hasKey = hasClaudeKey();
      if (hasKey) {
        try {
          const res = await detectFabricFromUrl(url, scraped);
          if (res.fabric) { setFabric(res.fabric); setFabricSource(res.source || 'inferred'); detected = true; }
          if (res.itemName) { setItemName(res.itemName); detected = true; }
          // Only use Claude's price if scraper didn't already provide one
          if (res.price && res.price > 0 && !(scraped.productPrice && scraped.productPrice > 0)) {
            setPrice(String(res.price));
            detected = true;
          }
          if (res.currency) { setCurrency(res.currency); }
        } catch (e) {
          // Claude failed but we may already have scraped data
          console.warn('[Purchase] Claude detection failed:', e);
        }
      } else if (!detected) {
        // Demo: keyword match on URL
        const lower = url.toLowerCase();
        const hit = URL_FABRIC_HINTS.find(([k]) => lower.includes(k));
        if (hit) { setFabric(hit[1]); setFabricSource('inferred'); detected = true; }
      }

      if (detected) {
        setUrlDetected(true);
      } else {
        setUrlError('Could not detect details from this URL. Please fill in manually.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Purchase] URL detection failed:', msg);
      setUrlError(`Detection failed: ${msg.length > 80 ? msg.slice(0, 80) + '…' : msg}`);
    }
    setFabricLoading(false);
    setUrlDetecting(false);
  };

  // Auto-trigger detection when URL is pasted (with 800ms debounce)
  useEffect(() => {
    if (method !== 'link') return;
    if (linkDebounce.current) clearTimeout(linkDebounce.current);
    if (!link || link.length < 10) return;

    // Reset detected state when URL changes
    setUrlDetected(false);
    setUrlError('');

    linkDebounce.current = setTimeout(() => {
      detectFromUrl(link);
    }, 800);

    return () => { if (linkDebounce.current) clearTimeout(linkDebounce.current); };
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
      const hasKey = hasClaudeKey();
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
      // For Claude API: include URL for context. For display: use item name only.
      const apiDescription =
        method === 'link'
          ? `Product URL: ${link}${itemName ? ` — ${itemName}` : ''}`
          : itemName || (method === 'scan' || method === 'photo' ? 'Item in photo' : 'Unknown item');
      const displayName = itemName || (method === 'link' ? 'Linked item' : method === 'scan' || method === 'photo' ? 'Item in photo' : 'Unknown item');

      const hasKey = hasClaudeKey();

      if (hasKey) {
        const result = await analyzePurchase(
          apiDescription, priceNum, currency,
          user.wardrobeItems,
          imageBase64 || undefined,
          estimatedWears ? parseInt(estimatedWears) : undefined,
          fabric || undefined,
        );
        setAnalysis({ ...result, itemName: displayName, price: priceNum, currency, imageUrl: imagePreview || '' });
      } else {
        // Demo fallback
        await new Promise(r => setTimeout(r, 1500));
        const ew = estimatedWears ? parseInt(estimatedWears) : priceNum > 100 ? 40 : 20;
        const cpw = Math.round((priceNum / ew) * 100) / 100;

        // Compute synthetic % — check provided fabric against the full list, or infer from item type
        let plastic: number;
        if (fabric) {
          const fabricLower = fabric.toLowerCase();
          const syntheticMatch = SYNTHETIC_FIBRES.some(s => fabricLower.includes(s));
          if (syntheticMatch) {
            // Try to extract actual percentage from fabric string (e.g. "30% polyester")
            let synPct = 0;
            for (const fib of SYNTHETIC_FIBRES) {
              const pctMatch = fabricLower.match(new RegExp(`(\\d+)\\s*%\\s*${fib}`));
              if (pctMatch) synPct += parseInt(pctMatch[1]);
            }
            plastic = synPct > 0 ? synPct : 55; // if we found fibres but no %, assume 55%
          } else {
            plastic = 0; // fabric provided and no synthetics detected
          }
        } else {
          // No fabric provided — infer from item name/description
          plastic = inferSyntheticFromItem(apiDescription);
        }

        const impact: PurchaseAnalysis['plastic_impact'] =
          plastic <= 0 ? 'plastic-free' : plastic <= 30 ? 'low' : plastic <= 70 ? 'medium' : 'high';
        const impactCol: PurchaseAnalysis['impact_colour'] =
          plastic <= 0 ? 'green' : plastic <= 30 ? 'yellow' : plastic <= 70 ? 'orange' : 'red';
        const lifetime = lifetimeYrs ? parseFloat(lifetimeYrs) : inferLifetime(apiDescription, priceNum);
        const fv = Math.round(priceNum * Math.pow(1.07, lifetime) * 100) / 100;
        const rec: PurchaseAnalysis['recommendation'] =
          cpw < 8 ? 'no brainer' : cpw < 25 ? 'why not' : 'maybe consider if you need it';
        setAnalysis({
          itemName: displayName, price: priceNum, currency, imageUrl: imagePreview || '',
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
    setItemName(''); setLink(''); setPrice(''); setFabric(''); setEstWears(''); setLifetimeYrs('');
    setImagePreview(null); setImageBase64(null); setError('');
    setFabricLoading(false); setFabricSource(null);
    setUrlDetecting(false); setUrlDetected(false); setUrlError('');
  };

  // ── Input screen ───────────────────────────────────────────────────────────
  if (!analysis) {
    return (
      <div className="px-4 pb-24" style={{ background: '#F5F0EB', minHeight: '100vh' }}>
        <div className="mb-5 pt-4">
          <h1 className="text-2xl" style={{ fontWeight: 700, letterSpacing: '-0.5px', color: '#2B2B2B' }}>
            Buy decision
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(43,43,43,0.45)' }}>
            Should you buy it? Let Anera decide.
          </p>
        </div>

        {/* Method tabs */}
        <div className="flex gap-2 mb-5">
          {METHODS.map(({ id, label, Icon }) => {
            const active = method === id;
            return (
              <button
                key={id}
                onClick={() => setMethod(id)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: active ? '#8B7355' : '#FFFFFF',
                  border: active ? '1px solid #8B7355' : '1px solid rgba(43,43,43,0.08)',
                  color: active ? '#FFFFFF' : 'var(--text-secondary)',
                  boxShadow: active ? 'none' : '0 4px 20px rgba(0,0,0,0.05)',
                }}
              >
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>

        {/* Photo / Scan upload area */}
        {(method === 'photo' || method === 'scan') && (
          <div
            onClick={() => (method === 'photo' ? photoRef : scanRef).current?.click()}
            className="w-full rounded-2xl cursor-pointer mb-5 overflow-hidden relative flex items-center justify-center"
            style={{
              border: imagePreview ? 'none' : '1.5px dashed rgba(139,115,85,0.35)',
              background: imagePreview ? 'transparent' : '#FFFFFF',
              minHeight: '200px',
              boxShadow: imagePreview ? 'none' : '0 4px 20px rgba(0,0,0,0.05)',
            }}
          >
            {imagePreview ? (
              <>
                <img
                  src={imagePreview}
                  className="w-full object-cover rounded-2xl"
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
                <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: '#F0EBE3' }}>
                  {method === 'scan'
                    ? <ScanLine size={24} style={{ color: '#8B7355' }} />
                    : <Upload   size={24} style={{ color: '#8B7355' }} />
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
              <label className="text-[11px] font-bold uppercase" style={labelStyle}>
                Product URL
              </label>
              {urlDetecting && (
                <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: '#8B7355' }}>
                  <Loader2 size={10} className="animate-spin" /> Detecting name, price, fabric…
                </span>
              )}
              {urlDetected && !urlDetecting && (
                <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: '#15803D' }}>
                  <Sparkles size={10} /> Auto-detected
                </span>
              )}
            </div>
            <input
              type="url" value={link} onChange={e => setLink(e.target.value)}
              placeholder="https://www.zara.com/…"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{
                ...fieldStyle,
                borderColor: urlDetected ? '#86EFAC' : urlError ? '#FECACA' : 'rgba(43,43,43,0.12)',
              }}
            />
            {/* Detection status / retry */}
            {urlError && (
              <div className="flex items-center justify-between mt-2 px-1">
                <span className="text-[11px]" style={{ color: '#DC2626' }}>{urlError}</span>
                <button
                  onClick={() => detectFromUrl(link)}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: '#F0EBE3', color: '#8B7355' }}
                >
                  Retry
                </button>
              </div>
            )}
            {urlDetecting && (
              <div className="mt-2 px-1">
                <div className="h-1 rounded-full overflow-hidden" style={{ background: '#F0EBE3' }}>
                  <div className="h-full rounded-full animate-pulse" style={{ background: '#8B7355', width: '60%' }} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Item name */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-bold uppercase" style={labelStyle}>
              Item name{method !== 'manual' && (
                <span style={{ fontWeight: 400, textTransform: 'none' as const }}> (optional)</span>
              )}
            </label>
            {method === 'link' && urlDetected && itemName && (
              <span className="text-[10px] font-semibold" style={{ color: '#15803D' }}>Auto-detected</span>
            )}
          </div>
          <input
            type="text" value={itemName} onChange={e => setItemName(e.target.value)}
            placeholder="e.g. Black ankle boots, silk midi dress…"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none"
            style={{
              ...fieldStyle,
              borderColor: (method === 'link' && urlDetected && itemName) ? '#86EFAC' : 'rgba(43,43,43,0.12)',
            }}
          />
        </div>

        {/* Price row */}
        <div className="flex gap-2 mb-4">
          <div className="w-20">
            <label className="block text-[11px] font-bold uppercase mb-1.5" style={labelStyle}>Currency</label>
            <select
              value={currency} onChange={e => setCurrency(e.target.value)}
              className="w-full px-3 py-3 rounded-xl text-sm outline-none"
              style={fieldStyle}
            >
              {['£','$','€','¥'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold uppercase" style={labelStyle}>Price</label>
              {method === 'link' && urlDetected && price && parseFloat(price) > 0 && (
                <span className="text-[10px] font-semibold" style={{ color: '#15803D' }}>Auto-detected</span>
              )}
            </div>
            <input
              type="number" value={price} onChange={e => setPrice(e.target.value)}
              placeholder="0.00" min="0"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{
                ...fieldStyle,
                borderColor: (method === 'link' && urlDetected && price && parseFloat(price) > 0) ? '#86EFAC' : 'rgba(43,43,43,0.12)',
              }}
            />
          </div>
        </div>

        {/* Fabric composition — auto-detected */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-bold uppercase" style={labelStyle}>
              Fabric composition
            </label>
            {fabricLoading && (
              <span className="flex items-center gap-1 text-[10px]" style={{ color: '#8B7355' }}>
                <Loader2 size={10} className="animate-spin" /> Detecting…
              </span>
            )}
            {!fabricLoading && fabricSource && fabric && (
              <span
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
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
                borderColor: (fabricSource && fabric) ? '#86EFAC' : 'rgba(43,43,43,0.12)',
                paddingRight: fabricLoading ? '2.5rem' : undefined,
              }}
            />
            {fabricLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 size={14} className="animate-spin" style={{ color: '#8B7355' }} />
              </div>
            )}
          </div>
        </div>

        {/* Estimated wears + Item lifetime row */}
        <div className="flex gap-2 mb-5">
          <div className="flex-1">
            <label className="block text-[11px] font-bold uppercase mb-1.5" style={labelStyle}>
              Est. wears <span style={{ fontWeight: 400, textTransform: 'none' as const }}>(optional)</span>
            </label>
            <input
              type="number" value={estimatedWears} onChange={e => setEstWears(e.target.value)}
              placeholder="e.g. 40"
              min="1"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={fieldStyle}
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-bold uppercase mb-1.5" style={labelStyle}>
              Lifetime yrs <span style={{ fontWeight: 400, textTransform: 'none' as const }}>(optional)</span>
            </label>
            <input
              type="number" value={lifetimeYrs} onChange={e => setLifetimeYrs(e.target.value)}
              placeholder="e.g. 5"
              min="0.5" step="0.5"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={fieldStyle}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: '#FEE2E2', color: '#DC2626' }}>
            {error}
          </div>
        )}

        <button
          onClick={analyse}
          disabled={loading}
          className="w-full py-4 rounded-full font-semibold flex items-center justify-center gap-2"
          style={{ background: '#8B7355', color: '#FFFFFF' }}
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
    <div className="pb-24" style={{ background: '#F5F0EB', minHeight: '100vh' }}>
      <div className="px-4 mb-4 pt-5">
        <h1 className="text-xl" style={{ fontWeight: 700, letterSpacing: '-0.5px', color: '#2B2B2B' }}>
          {analysis.itemName.length > 50 ? analysis.itemName.slice(0, 50) + '…' : analysis.itemName}
        </h1>
      </div>

      {/* ── Decision badge ── */}
      <div className="flex flex-col items-center px-4 mb-6">
        <div
          style={{
            background: rec.bg,
            border: `2px solid ${rec.border}`,
            boxShadow: badgeReady ? rec.glow : 'none',
            borderRadius: '9999px',
            padding: '14px 28px',
            animation: badgeReady ? 'badge-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : 'none',
            opacity: badgeReady ? undefined : 0,
          }}
        >
          <p
            className="text-xl font-bold text-center tracking-tight"
            style={{ color: rec.color, lineHeight: 1.3 }}
          >
            {rec.label}
          </p>
        </div>
      </div>

      {/* ── 3. Stat cards ── */}
      <div
        className="grid grid-cols-3 gap-2.5 px-4 mb-4"
        style={{ animation: badgeReady ? 'fade-up 0.4s ease 0.2s both' : 'none' }}
      >
        {[
          { label: 'Cost / wear', value: `${analysis.currency}${analysis.cost_per_wear.toFixed(2)}` },
          { label: 'Est. wears',  value: `~${analysis.estimated_wears}` },
          { label: 'If invested', value: `${analysis.currency}${analysis.future_value_if_invested.toFixed(0)}` },
        ].map(stat => (
          <div
            key={stat.label}
            className="rounded-2xl px-3 py-3 text-center"
            style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
          >
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{stat.value}</p>
            <p className="text-[10px] font-semibold mt-0.5 uppercase" style={{ color: 'rgba(43,43,43,0.45)', letterSpacing: '0.3px' }}>{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── 4. Plastic impact bar ── */}
      <div className="px-4 mb-4">
        <div className="rounded-2xl px-4 py-3" style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Leaf size={13} style={{ color: '#16A34A' }} />
            <span className="text-xs font-semibold" style={{ color: '#2B2B2B' }}>Plastic impact</span>
            <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: plastic.dot, background: `${plastic.dot}14` }}>{plastic.label}</span>
          </div>
          <div
            className="relative h-2.5 rounded-full mb-1.5"
            style={{
              background: 'linear-gradient(to right, #16A34A 0%, #CA8A04 30%, #EA580C 70%, #DC2626 100%)',
              overflow: 'visible',
            }}
          >
            <div
              className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md"
              style={{
                left: `${Math.min(100, Math.max(0, analysis.plastic_percentage))}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                background: plastic.dot,
                transition: 'left 0.9s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          </div>
          <div className="flex justify-between text-[8px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            <span>0%</span><span>30%</span><span>70%</span><span>100%</span>
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            ~{analysis.plastic_percentage}% synthetic materials
            {analysis.plastic_percentage === 0 && ' — fully natural fibres 🌿'}
          </p>
        </div>
      </div>

      {/* ── 5. Investment insight — stock ticker style ── */}
      <div className="px-4 mb-4">
        <div className="rounded-2xl overflow-hidden" style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
          <div className="flex">
            {/* Left — $ icon + invested amount */}
            <div
              className="w-[90px] flex-shrink-0 flex flex-col items-center justify-center gap-1.5"
              style={{ background: '#F0EBE3', minHeight: '110px' }}
            >
              <CircleDollarSign size={28} style={{ color: '#8B7355' }} />
              <p className="text-sm font-bold" style={{ color: '#8B7355' }}>
                {analysis.currency}{analysis.price}
              </p>
              <p className="text-[9px] font-medium" style={{ color: 'rgba(139,115,85,0.7)' }}>
                invested
              </p>
            </div>

            {/* Right — stock ticker content */}
            <div className="flex-1 px-3.5 py-2.5">
              {/* Header: badge */}
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{ background: '#F0EBE3', color: '#8B7355' }}>
                  Investment
                </span>
              </div>
              {/* Future value — large, stock-style */}
              <p className="text-xl font-bold tracking-tight" style={{ color: '#1A1A1A' }}>
                {analysis.currency}{analysis.future_value_if_invested.toFixed(2)}
              </p>
              {/* Growth badge */}
              <div className="flex items-center gap-1 mt-0.5 mb-1.5">
                <TrendingUp size={11} style={{ color: '#16A34A' }} />
                <span className="text-xs font-semibold" style={{ color: '#16A34A' }}>
                  +{analysis.currency}{(analysis.future_value_if_invested - analysis.price).toFixed(2)}
                </span>
                <span className="text-[10px]" style={{ color: 'rgba(43,43,43,0.4)' }}>
                  ({((analysis.future_value_if_invested / analysis.price - 1) * 100).toFixed(1)}%)
                </span>
              </div>
              {/* Mini bar chart — two-tone: dark caramel = principal, light = gains */}
              <InvestmentBarChart
                startVal={analysis.price}
                endVal={analysis.future_value_if_invested}
                years={analysis.estimated_lifetime_years}
              />
              {/* Subtitle */}
              <p className="text-[9px] mt-1 leading-snug" style={{ color: 'rgba(43,43,43,0.5)' }}>
                7% p.a. over {analysis.estimated_lifetime_years} yrs
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 6. Reasoning ── */}
      <div className="px-4 mb-4">
        <div className="rounded-2xl px-4 py-3" style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
          <p className="text-[13px] leading-relaxed" style={{ color: '#2B2B2B' }}>{analysis.reasoning}</p>
        </div>
      </div>

      {/* ── 7. Action buttons ── */}
      <div className="px-4 flex gap-3">
        <button
          onClick={() => setWished(v => !v)}
          className="flex-1 py-3 rounded-full font-semibold text-sm flex items-center justify-center gap-2 transition-all"
          style={{
            background: wished ? 'rgba(139,115,85,0.12)' : '#FFFFFF',
            border: `1px solid ${wished ? '#8B7355' : 'rgba(0,0,0,0.08)'}`,
            color: wished ? '#8B7355' : '#2B2B2B',
            boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
          }}
        >
          <Heart size={14} fill={wished ? '#8B7355' : 'none'} strokeWidth={wished ? 0 : 2} />
          {wished ? 'Saved' : 'Save to wishlist'}
        </button>
        <button
          onClick={reset}
          className="flex-1 py-3 rounded-full font-semibold text-sm flex items-center justify-center gap-2"
          style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.08)', color: '#2B2B2B', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
        >
          <RefreshCw size={14} />
          Compare another
        </button>
      </div>
    </div>
  );
}

// ── Investment bar chart — two-tone: dark caramel = principal, caramel = gains ──
function InvestmentBarChart({ startVal, endVal, years }: { startVal: number; endVal: number; years: number }) {
  const barCount = Math.max(Math.min(Math.round(years), 10), 3);
  const bars: number[] = [];
  for (let i = 0; i <= barCount; i++) {
    const t = i / barCount;
    bars.push(startVal * Math.pow(endVal / startVal, t));
  }
  const maxVal = bars[bars.length - 1];
  const minDisplay = startVal * 0.5;
  const range = maxVal - minDisplay;

  const W = 160;
  const H = 40;
  const PAD_X = 2;
  const PAD_TOP = 2;
  const gap = 2;
  const barW = (W - PAD_X * 2 - gap * (bars.length - 1)) / bars.length;
  const rx = barW > 6 ? 3 : 1.5;

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
      {bars.map((val, i) => {
        const totalH = Math.max(3, ((val - minDisplay) / range) * (H - PAD_TOP - 2));
        const principalH = Math.max(2, ((startVal - minDisplay) / range) * (H - PAD_TOP - 2));
        const gainsH = Math.max(0, totalH - principalH);
        const x = PAD_X + i * (barW + gap);
        const yTotal = H - totalH;

        return (
          <g key={i}>
            {/* Gains portion (top — lighter lilac) */}
            {gainsH > 0 && (
              <rect
                x={x} y={yTotal}
                width={barW} height={gainsH}
                rx={rx} ry={rx}
                fill="#7B5B4C"
              />
            )}
            {/* Principal portion (bottom — dark purple) */}
            <rect
              x={x} y={H - principalH}
              width={barW} height={principalH}
              rx={rx} ry={rx}
              fill="#5C3D2E"
            />
            {/* Cover the gap between the two rects with a flat join */}
            {gainsH > 1 && (
              <rect
                x={x} y={H - principalH - Math.min(rx, gainsH)}
                width={barW} height={Math.min(rx * 2, gainsH + rx)}
                fill="#7B5B4C"
              />
            )}
            {gainsH > 1 && (
              <rect
                x={x} y={H - principalH}
                width={barW} height={Math.min(rx, principalH)}
                fill="#5C3D2E"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
