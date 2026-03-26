import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Gracefully handle missing Supabase config (e.g. demo/preview deploys)
export const supabase = url && key
  ? createClient(url, key)
  : (null as unknown as ReturnType<typeof createClient>);

export const isSupabaseConfigured = Boolean(url && key);

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  facebook_handle: string | null;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  occupation: string | null;
  age: number | null;
  gender: 'menswear' | 'womenswear' | 'both' | null;
  how_heard: string | null;
  brand_preferences: string[];
  profile_complete: boolean;
};

export type OotdPost = {
  id: string;
  user_id: string;
  image_url: string;
  media_type: 'image' | 'video';
  caption: string | null;
  tags: string[];
  occasion: string | null;
  created_at: string;
  profiles?: Profile;
  likes_count?: number;
  comments_count?: number;
  user_has_liked?: boolean;
};

export type PostComment = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  profiles?: Profile;
};

// ── Weather helpers (Open-Meteo — no API key needed) ──────────────────────
export interface WeatherInfo {
  temp: number;
  description: string;
  isRainy: boolean;
  icon: string;
}

export async function getCityWeather(city: string): Promise<WeatherInfo | null> {
  try {
    // Geocode city → lat/lon
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );
    const geoData = await geoRes.json();
    if (!geoData.results?.length) return null;
    const { latitude, longitude } = geoData.results[0];

    // Get current weather
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`
    );
    const weatherData = await weatherRes.json();
    const temp = Math.round(weatherData.current.temperature_2m);
    const code = weatherData.current.weather_code;

    // WMO weather codes
    const isRainy = [51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,95,96,99].includes(code);
    const { description, icon } = getWeatherDesc(code);

    return { temp, description, isRainy, icon };
  } catch {
    return null;
  }
}

function getWeatherDesc(code: number): { description: string; icon: string } {
  if (code === 0) return { description: 'Clear sky', icon: '☀️' };
  if (code <= 2) return { description: 'Partly cloudy', icon: '⛅' };
  if (code === 3) return { description: 'Overcast', icon: '☁️' };
  if (code <= 57) return { description: 'Drizzle', icon: '🌦️' };
  if (code <= 67) return { description: 'Rain', icon: '🌧️' };
  if (code <= 77) return { description: 'Snow', icon: '❄️' };
  if (code <= 82) return { description: 'Rain showers', icon: '🌧️' };
  return { description: 'Thunderstorm', icon: '⛈️' };
}
