export interface WardrobeItem {
  id: string;
  imageUrl: string;
  category: 'top' | 'bottom' | 'footwear' | 'outerwear' | 'jewellery' | 'bag' | 'dress';
  subcategory: string;
  color: string;
  pattern: string;
  fit: string;
  brand?: string;
  wearCount: number;
  lastWorn: string | null;
  estimatedValue: number;
  tags: string[];
}

export interface BoundingBox {
  x: number;      // normalised 0-1, left edge
  y: number;      // normalised 0-1, top edge
  width: number;  // normalised 0-1
  height: number; // normalised 0-1
}

export interface DetectedItem {
  tempId: string;
  croppedImageUrl: string;   // base64 data URL from canvas crop
  originalImageUrl: string;  // blob URL of the source photo
  category: WardrobeItem['category'];
  categoryConfidence: number;
  subcategory: string;
  subcategoryConfidence: number;
  color: string;
  colorConfidence: number;
  brand: string;
  brandConfidence: number;
  pattern: string;
  fit: string;
  tags: string[];
  boundingBox: BoundingBox;
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
