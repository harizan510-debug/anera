import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X, CheckCircle, ArrowRight, Loader2, Shirt } from 'lucide-react';
import { analyzeClothingImage } from '../api';
import { completeOnboarding, fileToBase64, genId } from '../store';
import type { WardrobeItem } from '../types';

type Step = 'welcome' | 'name' | 'upload' | 'processing' | 'done';

interface UploadedPhoto {
  file: File;
  previewUrl: string;
  base64?: string;
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [progressMsg, setProgressMsg] = useState('');
  const [detectedItems, setDetectedItems] = useState<WardrobeItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilePick = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const newPhotos: UploadedPhoto[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const previewUrl = URL.createObjectURL(file);
      const base64 = await fileToBase64(file);
      newPhotos.push({ file, previewUrl, base64 });
    }
    setPhotos(prev => [...prev, ...newPhotos]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFilePick(e.dataTransfer.files);
  }, [handleFilePick]);

  const removePhoto = (idx: number) => {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[idx].previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const processPhotos = async () => {
    setStep('processing');
    const items: WardrobeItem[] = [];
    const hasApiKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY;

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      setProgressMsg(`Analysing photo ${i + 1} of ${photos.length}…`);
      try {
        if (hasApiKey && photo.base64) {
          const mimeType = photo.file.type || 'image/jpeg';
          const analysed = await analyzeClothingImage(photo.base64, mimeType);
          items.push({
            id: genId(),
            imageUrl: photo.previewUrl,
            category: analysed.category || 'top',
            subcategory: analysed.subcategory || 'top',
            color: analysed.color || 'unknown',
            pattern: analysed.pattern || 'plain',
            fit: analysed.fit || 'regular',
            wearCount: 0,
            lastWorn: null,
            estimatedValue: 0,
            tags: analysed.tags || [],
          } as WardrobeItem);
        } else {
          // Demo fallback when no API key
          const demoCategories: WardrobeItem['category'][] = ['top', 'bottom', 'shoes', 'outerwear', 'dress'];
          const demoColors = ['black', 'white', 'navy', 'beige', 'grey', 'brown'];
          const demoSubcats = { top: 't-shirt', bottom: 'jeans', shoes: 'sneakers', outerwear: 'jacket', dress: 'dress', accessory: 'bag' };
          const cat = demoCategories[i % demoCategories.length];
          items.push({
            id: genId(),
            imageUrl: photo.previewUrl,
            category: cat,
            subcategory: demoSubcats[cat],
            color: demoColors[i % demoColors.length],
            pattern: 'plain',
            fit: 'regular',
            wearCount: 0,
            lastWorn: null,
            estimatedValue: 0,
            tags: ['casual'],
          });
          await new Promise(r => setTimeout(r, 400)); // simulate delay
        }
      } catch (err) {
        console.error('Error analysing photo:', err);
        // Keep going with a placeholder
        items.push({
          id: genId(),
          imageUrl: photo.previewUrl,
          category: 'top',
          subcategory: 'item',
          color: 'unknown',
          pattern: 'plain',
          fit: 'regular',
          wearCount: 0,
          lastWorn: null,
          estimatedValue: 0,
          tags: [],
        });
      }
    }

    setDetectedItems(items);
    completeOnboarding(name, items);
    setStep('done');
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--bg)' }}
    >
      {/* Header */}
      <div className="px-6 pt-14 pb-6">
        <div className="flex items-center gap-2 mb-1">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--accent)' }}
          >
            <Shirt size={16} color="white" />
          </div>
          <span className="font-semibold tracking-wide text-lg" style={{ color: 'var(--text-primary)' }}>
            anera
          </span>
        </div>
      </div>

      {/* Steps */}
      <div className="flex-1 px-6">
        {step === 'welcome' && (
          <div className="flex flex-col justify-center min-h-[70vh]">
            <div className="mb-10">
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--accent)' }}>
                Your personal AI stylist
              </p>
              <h1 className="text-4xl font-light mb-4" style={{ color: 'var(--text-primary)', lineHeight: '1.15', letterSpacing: '-0.5px' }}>
                Meet Anera,<br />your wardrobe<br />intelligence.
              </h1>
              <p className="text-base" style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                Upload your outfits. Anera learns your style, curates daily looks, and tells you exactly what to wear — or buy.
              </p>
            </div>
            <button
              onClick={() => setStep('name')}
              className="w-full py-4 rounded-2xl font-medium text-white text-base flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)' }}
            >
              Get started <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === 'name' && (
          <div className="flex flex-col justify-center min-h-[70vh]">
            <h2 className="text-3xl font-light mb-2" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
              What should I call you?
            </h2>
            <p className="mb-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Just your first name is fine.
            </p>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
              className="w-full px-4 py-4 rounded-2xl text-lg outline-none mb-6"
              style={{
                background: 'var(--surface)',
                border: '1.5px solid var(--border)',
                color: 'var(--text-primary)',
              }}
              onKeyDown={e => e.key === 'Enter' && name.trim() && setStep('upload')}
            />
            <button
              onClick={() => setStep('upload')}
              disabled={!name.trim()}
              className="w-full py-4 rounded-2xl font-medium text-white text-base flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
            >
              Continue <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === 'upload' && (
          <div>
            <h2 className="text-3xl font-light mb-2 mt-2" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
              Upload your outfits,<br />{name}.
            </h2>
            <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Photos of individual clothing items or full OOTDs work great. The more you add, the better I get.
            </p>

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer mb-5"
              style={{
                border: '1.5px dashed var(--border)',
                background: 'var(--surface)',
                padding: '32px 20px',
              }}
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: 'var(--accent-light)' }}
              >
                <Upload size={22} style={{ color: 'var(--accent)' }} />
              </div>
              <div className="text-center">
                <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                  Tap to upload photos
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  or drag & drop — JPEG, PNG, HEIC
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => handleFilePick(e.target.files)}
              />
            </div>

            {/* Photo grid */}
            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-6">
                {photos.map((photo, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                    <img src={photo.previewUrl} className="w-full h-full object-cover" alt="" />
                    <button
                      onClick={() => removePhoto(i)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.55)' }}
                    >
                      <X size={12} color="white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {photos.length > 0 && (
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                {photos.length} photo{photos.length > 1 ? 's' : ''} selected
              </p>
            )}

            <button
              onClick={processPhotos}
              disabled={photos.length === 0}
              className="w-full py-4 rounded-2xl font-medium text-white text-base flex items-center justify-center gap-2 disabled:opacity-40 mb-3"
              style={{ background: 'var(--accent)' }}
            >
              Build my wardrobe <ArrowRight size={18} />
            </button>
            <button
              onClick={() => {
                // Skip — go straight in with empty wardrobe
                completeOnboarding(name || 'You', []);
                navigate('/wardrobe');
              }}
              className="w-full py-3 text-sm text-center"
              style={{ color: 'var(--text-secondary)' }}
            >
              Skip for now, I'll add items manually
            </button>
          </div>
        )}

        {step === 'processing' && (
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
              style={{ background: 'var(--accent-light)' }}
            >
              <Loader2 size={32} style={{ color: 'var(--accent)' }} className="animate-spin" />
            </div>
            <h2 className="text-2xl font-light mb-3" style={{ color: 'var(--text-primary)' }}>
              Building your wardrobe…
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {progressMsg || 'Detecting clothing items and colours…'}
            </p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
              style={{ background: 'var(--accent-light)' }}
            >
              <CheckCircle size={32} style={{ color: 'var(--accent)' }} />
            </div>
            <h2 className="text-3xl font-light mb-3" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
              We've detected<br />
              <span style={{ color: 'var(--accent)' }}>{detectedItems.length} items</span>
            </h2>
            <p className="text-sm mb-10" style={{ color: 'var(--text-secondary)' }}>
              Your wardrobe is ready. Let's start styling.
            </p>
            <button
              onClick={() => navigate('/wardrobe')}
              className="px-8 py-4 rounded-2xl font-medium text-white text-base flex items-center gap-2"
              style={{ background: 'var(--accent)' }}
            >
              View my wardrobe <ArrowRight size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
