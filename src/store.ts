import { useState, useEffect } from 'react';
import type { User, WardrobeItem, ChatMessage } from './types';

const STORAGE_KEY = 'anera_user';

const defaultUser: User = {
  id: 'user_1',
  name: '',
  wardrobeItems: [],
  styleProfile: {
    dominantColors: [],
    styleTags: [],
    fitPreferences: [],
  },
  onboardingComplete: false,
};

// Simple global state using localStorage
export function loadUser(): User {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultUser, ...JSON.parse(raw) };
  } catch {}
  return { ...defaultUser };
}

export function saveUser(user: User) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function addWardrobeItem(item: WardrobeItem) {
  const user = loadUser();
  user.wardrobeItems.push(item);
  saveUser(user);
}

export function updateWardrobeItem(item: WardrobeItem) {
  const user = loadUser();
  const idx = user.wardrobeItems.findIndex(i => i.id === item.id);
  if (idx >= 0) user.wardrobeItems[idx] = item;
  saveUser(user);
}

export function deleteWardrobeItem(id: string) {
  const user = loadUser();
  user.wardrobeItems = user.wardrobeItems.filter(i => i.id !== id);
  saveUser(user);
}

export function incrementWearCount(id: string) {
  const user = loadUser();
  const item = user.wardrobeItems.find(i => i.id === id);
  if (item) {
    item.wearCount += 1;
    item.lastWorn = new Date().toISOString();
  }
  saveUser(user);
}

export function completeOnboarding(name: string, items: WardrobeItem[]) {
  const user = loadUser();
  user.name = name;
  user.wardrobeItems = items;
  user.onboardingComplete = true;
  saveUser(user);
}

// Image → base64 helper
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Generate unique id
export function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Chat messages stored in memory (session only)
let chatMessages: ChatMessage[] = [];
export function getChatMessages() { return chatMessages; }
export function addChatMessage(msg: ChatMessage) { chatMessages.push(msg); }
export function clearChatMessages() { chatMessages = []; }

// Simple hook to reactively get user data
export function useUser() {
  const [user, setUser] = useState<User>(loadUser);

  useEffect(() => {
    const handler = () => setUser(loadUser());
    window.addEventListener('anera_update', handler);
    return () => window.removeEventListener('anera_update', handler);
  }, []);

  const refresh = () => {
    const u = loadUser();
    setUser(u);
    window.dispatchEvent(new Event('anera_update'));
    return u;
  };

  return { user, refresh };
}
