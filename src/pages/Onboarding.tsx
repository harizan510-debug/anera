import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X, CheckCircle, ArrowRight, Loader2, Shirt } from 'lucide-react';
import { detectClothingItems } from '../api';
import { hasClaudeKey } from '../apiHelper';
import type { RawDetection } from '../api';
import { completeOnboarding, fileToBase64, genId } from '../store';
import type { WardrobeItem, DetectedItem } from '../types';
import { cropImage } from '../utils/cropImage';
import MultiItemReview from '../components/MultiItemReview';

type Step = 'welcome' | 'name' | 'upload' | 'processing' | 'review' | 'done';

interface UploadedPhoto {
  file: File;
  previewUrl: string;
  base64?: string;
}

// Design tokens
const CARAMEL = '#C4956A';
const CARAMEL_DEEP = '#A67B52';
const CARAMEL_LIGHT = '#F0E6DA';
const CARD_SHADOW = '0 4px 20px rgba(0,0,0,0.05)';

// Demo detections for when no API key is configured
const DEMO_DETECTIONS: RawDetection[] = [
  { category: 'top', categoryConfidence: 0.92, subcategory: 'blazer', subcategoryConfidence: 0.88, color: 'navy', colorConfidence: 0.95, brand: 'Zara', brandConfidence: 0.55, pattern: 'plain', fit: 'regular', tags: ['formal', 'work'], boundingBox: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } },
  { category: 'bottom', categoryConfidence: 0.90, subcategory: 'jeans', subcategoryConfidence: 0.85, color: 'blue', colorConfidence: 0.91, brand: '', brandConfidence: 0.3, pattern: 'plain', fit: 'slim', tags: ['casual'], boundingBox: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } },
  { category: 'footwear', categoryConfidence: 0.96, subcategory: 'sneakers', subcategoryConfidence: 0.91, color: 'white', colorConfidence: 0.98, brand: 'Nike', brandConfidence: 0.91, pattern: 'plain', fit: 'regular', tags: ['casual', 'sporty'], boundingBox: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } },
  { category: 'dress', categoryConfidence: 0.94, subcategory: 'midi dress', subcategoryConfidence: 0.87, color: 'black', colorConfidence: 0.96, brand: '', brandConfidence: 0.3, pattern: 'plain', fit: 'fitted', tags: ['elegant'], boundingBox: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } },
  { category: 'outerwear', categoryConfidence: 0.89, subcategory: 'trench coat', subcategoryConfidence: 0.84, color: 'camel', colorConfidence: 0.91, brand: 'Burberry', brandConfidence: 0.78, pattern: 'plain', fit: 'oversized', tags: ['classic'], boundingBox: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [progressMsg, setProgressMsg] = useState('');
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([]);
  const [savedCount, setSavedCount] = useState(0);
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
    const allDetected: DetectedItem[] = [];
    const hasApiKey = hasClaudeKey();

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      setProgressMsg(`Detecting items in photo ${i + 1} of ${photos.length}...`);

      try {
        let rawItems: RawDetection[];

        if (hasApiKey && photo.base64) {
          rawItems = await detectClothingItems(photo.base64, photo.file.type || 'image/jpeg');
        } else {
          await new Promise(r => setTimeout(r, 600));
          rawItems = [DEMO_DETECTIONS[i % DEMO_DETECTIONS.length]];
        }

        for (const raw of rawItems) {
          let croppedImageUrl = photo.previewUrl;
          try {
            croppedImageUrl = await cropImage(photo.previewUrl, raw.boundingBox);
          } catch {
            // fallback: use full photo
          }
          allDetected.push({
            tempId: genId(),
            croppedImageUrl,
            originalImageUrl: photo.previewUrl,
            category: raw.category,
            categoryConfidence: raw.categoryConfidence,
            subcategory: raw.subcategory,
            subcategoryConfidence: raw.subcategoryConfidence,
            color: raw.color,
            colorConfidence: raw.colorConfidence,
            brand: raw.brand,
            brandConfidence: raw.brandConfidence,
            pattern: raw.pattern,
            fit: raw.fit,
            tags: raw.tags,
            boundingBox: raw.boundingBox,
          });
        }
      } catch (err) {
        console.error('Detection failed for photo:', i, err);
        allDetected.push({
          tempId: genId(),
          croppedImageUrl: photo.previewUrl,
          originalImageUrl: photo.previewUrl,
          category: 'top',
          categoryConfidence: 0.5,
          subcategory: 'item',
          subcategoryConfidence: 0.5,
          color: 'unknown',
          colorConfidence: 0.5,
          brand: '',
          brandConfidence: 0.3,
          pattern: 'plain',
          fit: 'regular',
          tags: [],
          boundingBox: { x: 0, y: 0, width: 1, height: 1 },
        });
      }
    }

    setDetectedItems(allDetected);
    setStep('review');
  };

  const handleReviewConfirm = (confirmed: WardrobeItem[]) => {
    completeOnboarding(name, confirmed);
    setSavedCount(confirmed.length);
    setStep('done');
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F5F0EB' }}>

      {/* Header */}
      <div className="px-6 pt-14 pb-6">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-2xl flex items-center justify-center" style={{ background: CARAMEL, boxShadow: CARD_SHADOW }}>
            <Shirt size={16} color="#2B2B2B" />
          </div>
          <span className="text-lg" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
            anera
          </span>
        </div>
      </div>

      {/* Steps */}
      <div className="flex-1 px-6">

        {step === 'welcome' && (
          <div className="flex flex-col justify-center min-h-[70vh]">
            <div className="mb-10">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: CARAMEL_DEEP }}>
                Your personal AI stylist
              </p>
              <h1 className="text-4xl mb-4" style={{ color: '#2B2B2B', fontWeight: 700, lineHeight: '1.15', letterSpacing: '-0.5px' }}>
                Meet Anera,<br />your wardrobe<br />intelligence.
              </h1>
              <p className="text-base" style={{ color: 'rgba(43,43,43,0.5)', lineHeight: '1.6' }}>
                Upload your outfits. Anera learns your style, curates daily looks, and tells you exactly what to wear — or buy.
              </p>
            </div>
            <button
              onClick={() => setStep('name')}
              className="w-full py-4 rounded-full font-semibold text-base flex items-center justify-center gap-2 transition-all"
              style={{ background: CARAMEL, color: '#2B2B2B', boxShadow: CARD_SHADOW }}
            >
              Get started <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === 'name' && (
          <div className="flex flex-col justify-center min-h-[70vh]">
            <h2 className="text-3xl mb-2" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
              What should I call you?
            </h2>
            <p className="mb-8 text-sm" style={{ color: 'rgba(43,43,43,0.5)' }}>
              Just your first name is fine.
            </p>
            <label className="block mb-2 font-bold uppercase" style={{ fontSize: '11px', color: 'rgba(43,43,43,0.45)', letterSpacing: '0.05em' }}>
              Your name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Sarah"
              autoFocus
              className="w-full px-4 py-3.5 rounded-2xl text-base outline-none mb-6 transition-all"
              style={{
                background: '#FFFFFF',
                border: '1.5px solid rgba(43,43,43,0.08)',
                color: '#2B2B2B',
                boxShadow: CARD_SHADOW,
              }}
              onFocus={e => e.currentTarget.style.borderColor = CARAMEL}
              onBlur={e => e.currentTarget.style.borderColor = 'rgba(43,43,43,0.08)'}
              onKeyDown={e => e.key === 'Enter' && name.trim() && setStep('upload')}
            />
            <button
              onClick={() => setStep('upload')}
              disabled={!name.trim()}
              className="w-full py-4 rounded-full font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              style={{ background: CARAMEL, color: '#2B2B2B', boxShadow: CARD_SHADOW }}
            >
              Continue <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === 'upload' && (
          <div>
            <h2 className="text-3xl mb-2 mt-2" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
              Upload your outfits,<br />{name}.
            </h2>
            <p className="mb-6 text-sm" style={{ color: 'rgba(43,43,43,0.5)' }}>
              Photos of individual items or full OOTDs work great. Anera can detect multiple garments from a single photo.
            </p>

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = CARAMEL;
                (e.currentTarget as HTMLElement).style.background = CARAMEL_LIGHT;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(43,43,43,0.12)';
                (e.currentTarget as HTMLElement).style.background = '#FFFFFF';
              }}
              className="w-full rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer mb-5 transition-all"
              style={{ border: `1.5px dashed rgba(43,43,43,0.12)`, background: '#FFFFFF', padding: '40px 20px', boxShadow: CARD_SHADOW }}
            >
              <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: CARAMEL_LIGHT }}>
                <Upload size={22} style={{ color: CARAMEL_DEEP }} />
              </div>
              <div className="text-center">
                <p className="font-semibold text-sm" style={{ color: '#2B2B2B' }}>
                  Tap to upload photos
                </p>
                <p className="text-xs mt-1" style={{ color: 'rgba(43,43,43,0.45)' }}>
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
              <div className="grid grid-cols-3 gap-2.5 mb-6">
                {photos.map((photo, i) => (
                  <div key={i} className="relative aspect-square rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
                    <img src={photo.previewUrl} className="w-full h-full object-cover" alt="" />
                    <button
                      onClick={() => removePhoto(i)}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.5)' }}
                    >
                      <X size={12} color="white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {photos.length > 0 && (
              <p className="text-xs font-semibold mb-4" style={{ color: 'rgba(43,43,43,0.45)' }}>
                {photos.length} photo{photos.length > 1 ? 's' : ''} selected
              </p>
            )}

            <button
              onClick={processPhotos}
              disabled={photos.length === 0}
              className="w-full py-4 rounded-full font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-40 mb-3 transition-all"
              style={{ background: CARAMEL, color: '#2B2B2B', boxShadow: CARD_SHADOW }}
            >
              Build my wardrobe <ArrowRight size={18} />
            </button>
            <button
              onClick={() => { completeOnboarding(name || 'You', []); navigate('/wardrobe'); }}
              className="w-full py-3 text-sm font-medium text-center"
              style={{ color: 'rgba(43,43,43,0.45)' }}
            >
              Skip for now, I'll add items manually
            </button>
          </div>
        )}

        {step === 'processing' && (
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: CARAMEL_LIGHT, boxShadow: CARD_SHADOW }}>
              <Loader2 size={32} style={{ color: CARAMEL_DEEP }} className="animate-spin" />
            </div>
            <h2 className="text-2xl mb-3" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
              Scanning your wardrobe...
            </h2>
            <p className="text-sm" style={{ color: 'rgba(43,43,43,0.5)' }}>
              {progressMsg || 'Detecting clothing items...'}
            </p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: CARAMEL_LIGHT, boxShadow: CARD_SHADOW }}>
              <CheckCircle size={32} style={{ color: CARAMEL_DEEP }} />
            </div>
            <h2 className="text-3xl mb-3" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
              Wardrobe ready!<br />
              <span style={{ color: CARAMEL_DEEP }}>{savedCount} item{savedCount !== 1 ? 's' : ''}</span> added
            </h2>
            <p className="text-sm mb-10" style={{ color: 'rgba(43,43,43,0.5)' }}>
              Let's start styling, {name}.
            </p>
            <button
              onClick={() => navigate('/wardrobe')}
              className="px-8 py-4 rounded-full font-semibold text-base flex items-center gap-2 transition-all"
              style={{ background: CARAMEL, color: '#2B2B2B', boxShadow: CARD_SHADOW }}
            >
              View my wardrobe <ArrowRight size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Multi-item review overlay — shown as its own full-screen step */}
      {step === 'review' && (
        <MultiItemReview
          items={detectedItems}
          onConfirm={handleReviewConfirm}
          onCancel={() => {
            // Skip review: save detected items as-is
            const fallback: WardrobeItem[] = detectedItems.map(d => ({
              id: genId(),
              imageUrl: d.croppedImageUrl || d.originalImageUrl,
              category: d.category,
              subcategory: d.subcategory,
              color: d.color,
              pattern: d.pattern,
              fit: d.fit,
              wearCount: 0,
              lastWorn: null,
              estimatedValue: 0,
              tags: d.tags,
            }));
            completeOnboarding(name, fallback);
            navigate('/wardrobe');
          }}
        />
      )}
    </div>
  );
}
