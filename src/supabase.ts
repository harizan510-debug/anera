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
  feelsLike: number;
  description: string;
  isRainy: boolean;
  icon: string;
  windSpeed: number;       // km/h
  rainMm: number;          // mm precipitation
  uvIndex: number;
  cityName: string;
}

/** Fetch weather by lat/lon (used by geolocation) */
export async function getWeatherByCoords(lat: number, lon: number): Promise<WeatherInfo | null> {
  try {
    // Use reverse geocoding to get city name from nominatim
    let cityName = '';
    try {
      const revRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`
      );
      const revData = await revRes.json();
      cityName = revData.address?.city || revData.address?.town || revData.address?.village || revData.address?.state || '';
    } catch {
      cityName = '';
    }

    return await fetchWeatherData(lat, lon, cityName);
  } catch {
    return null;
  }
}

/** Fetch weather using IP-based geolocation (fallback when browser geolocation denied) */
export async function getWeatherByIP(): Promise<WeatherInfo | null> {
  try {
    // ip-api.com is free, no key needed, returns lat/lon + city
    const ipRes = await fetch('http://ip-api.com/json/?fields=status,city,lat,lon');
    const ipData = await ipRes.json();
    if (ipData.status !== 'success') return null;
    return await fetchWeatherData(ipData.lat, ipData.lon, ipData.city || '');
  } catch {
    // Try ipapi.co as a backup
    try {
      const ipRes2 = await fetch('https://ipapi.co/json/');
      const ipData2 = await ipRes2.json();
      if (!ipData2.latitude || !ipData2.longitude) return null;
      return await fetchWeatherData(ipData2.latitude, ipData2.longitude, ipData2.city || '');
    } catch {
      return null;
    }
  }
}

/** Fetch weather by city name */
export async function getCityWeather(city: string): Promise<WeatherInfo | null> {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );
    const geoData = await geoRes.json();
    if (!geoData.results?.length) return null;
    const { latitude, longitude, name } = geoData.results[0];

    return await fetchWeatherData(latitude, longitude, name || city);
  } catch {
    return null;
  }
}

async function fetchWeatherData(lat: number, lon: number, cityName: string): Promise<WeatherInfo | null> {
  try {
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,uv_index` +
      `&timezone=auto`
    );
    const weatherData = await weatherRes.json();
    const c = weatherData.current;

    const temp = Math.round(c.temperature_2m);
    const feelsLike = Math.round(c.apparent_temperature);
    const code = c.weather_code;
    const windSpeed = Math.round(c.wind_speed_10m);
    const rainMm = Math.round((c.precipitation ?? 0) * 10) / 10;
    const uvIndex = Math.round(c.uv_index ?? 0);

    const isRainy = [51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,95,96,99].includes(code);
    const { description, icon } = getWeatherDesc(code);

    return { temp, feelsLike, description, isRainy, icon, windSpeed, rainMm, uvIndex, cityName };
  } catch {
    return null;
  }
}

function getWeatherDesc(code: number): { description: string; icon: string } {
  if (code === 0) return { description: 'Clear sky', icon: 'clear' };
  if (code <= 2) return { description: 'Partly cloudy', icon: 'cloudy' };
  if (code === 3) return { description: 'Overcast', icon: 'overcast' };
  if (code <= 57) return { description: 'Drizzle', icon: 'drizzle' };
  if (code <= 67) return { description: 'Rain', icon: 'rain' };
  if (code <= 77) return { description: 'Snow', icon: 'snow' };
  if (code <= 82) return { description: 'Rain showers', icon: 'rain' };
  return { description: 'Thunderstorm', icon: 'storm' };
}
