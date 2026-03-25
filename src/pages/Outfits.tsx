import { useState, useEffect } from 'react';
import { Sparkles, CloudSun, Loader2 } from 'lucide-react';
import { useUser } from '../store';
import type { WardrobeItem } from '../types';
import { generateOutfitRecommendations } from '../api';
import { supabase, getCityWeather } from '../supabase';
import type { WeatherInfo } from '../supabase';
import PageHeader from '../components/PageHeader';

const OCCASIONS = ['Everyday', 'Work', 'Casual', 'Date night', 'Weekend', 'Travel', 'Formal', 'Gym'];
const WEATHERS = ['Hot (25°C+)', 'Warm (18-24°C)', 'Mild (12-17°C)', 'Cool (6-11°C)', 'Cold (<5°C)', 'Rainy'];

function tempToWeatherChip(temp: number, isRainy: boolean): string {
  if (isRainy) return 'Rainy';
  if (temp >= 25) return 'Hot (25°C+)';
  if (temp >= 18) return 'Warm (18-24°C)';
  if (temp >= 12) return 'Mild (12-17°C)';
  if (temp >= 6) return 'Cool (6-11°C)';
  return 'Cold (<5°C)';
}

interface GeneratedOutfit {
  items: WardrobeItem[];
  note: string;
}

export default function Outfits() {
  const { user } = useUser();
  const [occasion, setOccasion] = useState('Everyday');
  const [weather, setWeather] = useState('Mild (12-17°C)');
  const [outfits, setOutfits] = useState<GeneratedOutfit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [weatherInfo, setWeatherInfo] = useState<WeatherInfo | null>(null);
  const [weatherCity, setWeatherCity] = useState('');

  // Auto-fetch weather from user's saved city
  useEffect(() => {
    (async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('city')
        .eq('id', authUser.id)
        .single();
      if (!profile?.city) return;
      setWeatherCity(profile.city);
      const info = await getCityWeather(profile.city);
      if (info) {
        setWeatherInfo(info);
        setWeather(tempToWeatherChip(info.temp, info.isRainy));
      }
    })();
  }, []);

  const wardrobeItems = user.wardrobeItems;

  const generate = async () => {
    if (wardrobeItems.length < 2) {
      setError('Add at least 2 items to your wardrobe to generate outfits.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const hasApiKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY;
      const weatherContext = weatherInfo
        ? `${weather} — ${weatherInfo.temp}°C, ${weatherInfo.description}${weatherInfo.isRainy ? '. Rain is forecast — suggest grabbing an umbrella.' : ''}`
        : weather;

      if (hasApiKey) {
        const result = await generateOutfitRecommendations(wardrobeItems, occasion, weatherContext);
        const resolved: GeneratedOutfit[] = result.outfits.map(o => ({
          items: o.items.map(id => wardrobeItems.find(w => w.id === id)).filter(Boolean) as WardrobeItem[],
          note: o.note,
        })).filter(o => o.items.length > 0);
        setOutfits(resolved);
      } else {
        // Demo mode — pick random items
        await new Promise(r => setTimeout(r, 1000));
        const demoOutfits: GeneratedOutfit[] = [];
        const tops = wardrobeItems.filter(i => i.category === 'top' || i.category === 'dress');
        const bottoms = wardrobeItems.filter(i => i.category === 'bottom');
        const shoes = wardrobeItems.filter(i => i.category === 'shoes');

        for (let i = 0; i < Math.min(3, Math.max(1, Math.floor(tops.length / 1))); i++) {
          const outfit: WardrobeItem[] = [];
          if (tops[i]) outfit.push(tops[i]);
          if (bottoms[i % bottoms.length]) outfit.push(bottoms[i % bottoms.length]);
          if (shoes[i % shoes.length]) outfit.push(shoes[i % shoes.length]);
          if (outfit.length > 0) {
            demoOutfits.push({
              items: outfit,
              note: `Perfect for ${occasion.toLowerCase()} in ${weather.toLowerCase()} weather.${weatherInfo?.isRainy ? ' ☂️ Don\'t forget your umbrella!' : ''}`,
            });
          }
        }
        setOutfits(demoOutfits);
      }
    } catch (err) {
      setError('Could not generate outfits. Check your API key.');
    }
    setLoading(false);
  };

  return (
    <div className="px-4 pb-4">
      <PageHeader
        title="Outfit Ideas"
        subtitle="Tell Anera what you need"
      />

      {/* Live weather banner */}
      {weatherInfo && (
        <div
          className="mb-4 px-4 py-3 rounded-2xl flex items-start gap-3"
          style={{ background: weatherInfo.isRainy ? '#EFF6FF' : 'var(--accent-light)', border: `1px solid ${weatherInfo.isRainy ? '#BFDBFE' : 'var(--border)'}` }}
        >
          <span className="text-xl flex-shrink-0">{weatherInfo.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {weatherInfo.temp}°C · {weatherInfo.description}
              {weatherCity && <span className="font-normal" style={{ color: 'var(--text-secondary)' }}> in {weatherCity}</span>}
            </p>
            {weatherInfo.isRainy && (
              <p className="text-xs mt-0.5" style={{ color: '#1D4ED8' }}>
                ☂️ Rain forecast — Anera will include an umbrella reminder in your outfit suggestions.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Occasion selector */}
      <div className="mb-4">
        <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Occasion</p>
        <div className="flex flex-wrap gap-2">
          {OCCASIONS.map(occ => (
            <button
              key={occ}
              onClick={() => setOccasion(occ)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: occasion === occ ? 'var(--accent)' : 'var(--surface)',
                color: occasion === occ ? 'white' : 'var(--text-secondary)',
                border: `1px solid ${occasion === occ ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              {occ}
            </button>
          ))}
        </div>
      </div>

      {/* Weather selector */}
      <div className="mb-5">
        <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
          <CloudSun size={12} className="inline mr-1" />Weather
        </p>
        <div className="flex flex-wrap gap-2">
          {WEATHERS.map(w => (
            <button
              key={w}
              onClick={() => setWeather(w)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: weather === w ? '#5B8DB8' : 'var(--surface)',
                color: weather === w ? 'white' : 'var(--text-secondary)',
                border: `1px solid ${weather === w ? '#5B8DB8' : 'var(--border)'}`,
              }}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={generate}
        disabled={loading}
        className="w-full py-4 rounded-2xl font-medium text-white flex items-center justify-center gap-2 mb-5"
        style={{ background: 'var(--accent)' }}
      >
        {loading
          ? <><Loader2 size={18} className="animate-spin" /> Styling…</>
          : <><Sparkles size={18} /> {outfits.length > 0 ? 'Regenerate outfits' : 'Generate outfits'}</>
        }
      </button>

      {error && (
        <div className="rounded-2xl px-4 py-3 mb-4 text-sm" style={{ background: '#FEE2E2', color: '#DC2626' }}>
          {error}
        </div>
      )}

      {/* Empty wardrobe nudge */}
      {wardrobeItems.length === 0 && !loading && (
        <div
          className="rounded-2xl px-5 py-8 flex flex-col items-center text-center"
          style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)' }}
        >
          <div className="text-4xl mb-3">👗</div>
          <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
            Your wardrobe is empty
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Add items to your wardrobe first to get outfit ideas.
          </p>
        </div>
      )}

      {/* Outfits */}
      {outfits.map((outfit, idx) => (
        <div
          key={idx}
          className="mb-4 rounded-2xl overflow-hidden"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
              Look {idx + 1}
            </p>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-light)', color: 'var(--accent-dark)' }}>
              {occasion}
            </span>
          </div>
          <div className="flex gap-2 p-3">
            {outfit.items.map(item => (
              <div key={item.id} className="flex-1 min-w-0">
                <div
                  className="aspect-square rounded-xl overflow-hidden mb-1"
                  style={{ background: 'var(--bg)' }}
                >
                  <img src={item.imageUrl} className="w-full h-full object-cover" alt={item.subcategory} />
                </div>
                <p className="text-[10px] text-center truncate capitalize" style={{ color: 'var(--text-secondary)' }}>
                  {item.subcategory}
                </p>
              </div>
            ))}
          </div>
          {outfit.note && (
            <div className="px-4 pb-4">
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                💡 {outfit.note}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
