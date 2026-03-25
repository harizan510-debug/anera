import { useState, useRef } from 'react';
import { Upload, ShoppingBag, TrendingUp, TrendingDown, Minus, Loader2, X } from 'lucide-react';
import { useUser, fileToBase64 } from '../store';
import { analyzePurchase } from '../api';
import PageHeader from '../components/PageHeader';

interface Analysis {
  itemName: string;
  price: number;
  currency: string;
  imageUrl: string;
  matchingOutfits: number;
  estimatedWearsPerMonth: number;
  costPerWear: number;
  recommendation: 'high-value' | 'moderate-value' | 'low-value';
  reasoning: string;
}

const REC_CONFIG = {
  'high-value': { label: 'High Value Purchase', color: '#16A34A', bg: '#DCFCE7', icon: TrendingUp },
  'moderate-value': { label: 'Moderate Value', color: '#D97706', bg: '#FEF3C7', icon: Minus },
  'low-value': { label: 'Low Value', color: '#DC2626', bg: '#FEE2E2', icon: TrendingDown },
};

export default function Purchase() {
  const { user } = useUser();
  const [itemName, setItemName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('£');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImage = async (file: File) => {
    const base64 = await fileToBase64(file);
    setImagePreview(URL.createObjectURL(file));
    setImageBase64(base64);
    if (!itemName) {
      setItemName('New item');
    }
  };

  const analyse = async () => {
    if (!itemName.trim() || !price) {
      setError('Please enter the item name and price.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const priceNum = parseFloat(price);
      const hasApiKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY;
      if (hasApiKey) {
        const result = await analyzePurchase(
          itemName,
          priceNum,
          currency,
          user.wardrobeItems,
          imageBase64 || undefined
        );
        setAnalysis({
          itemName,
          price: priceNum,
          currency,
          imageUrl: imagePreview || '',
          matchingOutfits: result.matchingOutfits,
          estimatedWearsPerMonth: result.estimatedWearsPerMonth,
          costPerWear: result.costPerWear,
          recommendation: result.recommendation,
          reasoning: result.reasoning,
        });
      } else {
        // Demo fallback
        await new Promise(r => setTimeout(r, 1200));
        const wpm = 4;
        const cpw = Math.round((priceNum / (wpm * 6)) * 100) / 100;
        setAnalysis({
          itemName,
          price: priceNum,
          currency,
          imageUrl: imagePreview || '',
          matchingOutfits: Math.max(2, Math.min(10, user.wardrobeItems.length)),
          estimatedWearsPerMonth: wpm,
          costPerWear: cpw,
          recommendation: cpw < 5 ? 'high-value' : cpw < 15 ? 'moderate-value' : 'low-value',
          reasoning: `At ${currency}${cpw} per wear, this item ${cpw < 5 ? 'offers excellent value' : cpw < 15 ? 'offers moderate value' : 'may not justify its cost'} for your wardrobe.`,
        });
      }
    } catch (err) {
      setError('Analysis failed. Check your API key and try again.');
    }
    setLoading(false);
  };

  const reset = () => {
    setAnalysis(null);
    setItemName('');
    setPrice('');
    setImagePreview(null);
    setImageBase64(null);
  };

  return (
    <div className="px-4 pb-4">
      <PageHeader
        title="Purchase Decision"
        subtitle="Should you buy it? Let Anera decide."
      />

      {!analysis ? (
        <>
          {/* Image upload */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-2xl flex items-center justify-center cursor-pointer mb-4 overflow-hidden relative"
            style={{
              border: '1.5px dashed var(--border)',
              background: imagePreview ? 'transparent' : 'var(--surface)',
              minHeight: '180px',
            }}
          >
            {imagePreview ? (
              <>
                <img src={imagePreview} className="w-full h-48 object-cover" alt="Item preview" />
                <button
                  onClick={e => { e.stopPropagation(); setImagePreview(null); setImageBase64(null); }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(0,0,0,0.55)' }}
                >
                  <X size={14} color="white" />
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8">
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-light)' }}>
                  <Upload size={20} style={{ color: 'var(--accent)' }} />
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Upload item photo (optional)</p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Helps Anera analyse compatibility</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => e.target.files?.[0] && handleImage(e.target.files[0])}
            />
          </div>

          {/* Form */}
          <div className="space-y-3 mb-5">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Item name
              </label>
              <input
                type="text"
                value={itemName}
                onChange={e => setItemName(e.target.value)}
                placeholder="e.g. Black ankle boots"
                className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex gap-2">
              <div className="w-20">
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Currency
                </label>
                <select
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  {['£', '$', '€', '¥'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Price
                </label>
                <input
                  type="number"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
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
            className="w-full py-4 rounded-2xl font-medium text-white flex items-center justify-center gap-2"
            style={{ background: 'var(--accent)' }}
          >
            {loading
              ? <><Loader2 size={18} className="animate-spin" /> Analysing…</>
              : <><ShoppingBag size={18} /> Analyse purchase</>
            }
          </button>
        </>
      ) : (
        /* Results */
        <div>
          {/* Item */}
          <div
            className="rounded-2xl overflow-hidden mb-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            {analysis.imageUrl && (
              <img src={analysis.imageUrl} className="w-full h-44 object-cover" alt={analysis.itemName} />
            )}
            <div className="px-5 py-4">
              <div className="flex items-start justify-between mb-1">
                <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
                  {analysis.itemName}
                </h3>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {analysis.currency}{analysis.price}
                </span>
              </div>
            </div>
          </div>

          {/* Verdict */}
          {(() => {
            const rec = REC_CONFIG[analysis.recommendation];
            const Icon = rec.icon;
            return (
              <div
                className="rounded-2xl px-5 py-4 mb-4 flex items-center gap-3"
                style={{ background: rec.bg }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: rec.color }}
                >
                  <Icon size={18} color="white" />
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: rec.color }}>
                    {rec.label}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: rec.color, opacity: 0.85 }}>
                    {analysis.reasoning}
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Matching outfits', value: analysis.matchingOutfits },
              { label: 'Wears / month', value: analysis.estimatedWearsPerMonth },
              { label: 'Cost per wear', value: `${analysis.currency}${analysis.costPerWear.toFixed(2)}` },
            ].map(stat => (
              <div
                key={stat.label}
                className="rounded-2xl px-3 py-4 text-center"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {stat.value}
                </p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {stat.label}
                </p>
              </div>
            ))}
          </div>

          <button
            onClick={reset}
            className="w-full py-4 rounded-2xl font-medium text-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            Analyse another item
          </button>
        </div>
      )}
    </div>
  );
}
