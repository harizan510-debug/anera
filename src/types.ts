export interface WardrobeItem {
  id: string;
  imageUrl: string;
  category: 'top' | 'bottom' | 'shoes' | 'outerwear' | 'accessory' | 'dress';
  subcategory: string;
  color: string;
  pattern: string;
  fit: string;
  wearCount: number;
  lastWorn: string | null;
  estimatedValue: number;
  tags: string[];
}

export interface Outfit {
  id: string;
  items: WardrobeItem[];
  occasion: string;
  weather?: string;
  wornCount: number;
  createdAt: string;
}

export interface StyleProfile {
  dominantColors: string[];
  styleTags: string[];
  fitPreferences: string[];
}

export interface User {
  id: string;
  name: string;
  wardrobeItems: WardrobeItem[];
  styleProfile: StyleProfile;
  onboardingComplete: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface PurchaseAnalysis {
  itemName: string;
  price: number;
  currency: string;
  imageUrl: string;
  compatibilityScore: number;
  matchingOutfits: number;
  estimatedWearsPerMonth: number;
  costPerWear: number;
  recommendation: 'high-value' | 'moderate-value' | 'low-value';
  matchingItems: WardrobeItem[];
}
