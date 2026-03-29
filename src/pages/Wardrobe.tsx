import { useState, useRef, useCallback } from 'react';
import { Plus, Search, X, Trash2, Check, Sparkles, Link2, Camera, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { hasClaudeKey } from '../apiHelper';
import { useUser, addWardrobeItem, updateWardrobeItem, deleteWardrobeItem, genId } from '../store';
import type { WardrobeItem, DetectedItem } from '../types';
import type { RawDetection } from '../api';
import { detectItemFromUrl } from '../api';
import { cropImage } from '../utils/cropImage';
import { processClothingImage } from '../pipeline/clothingPipeline';
import MultiItemReview from '../components/MultiItemReview';
import PageHeader from '../components/PageHeader';

/**
 * Compress a File (image) down to maxDim before converting to base64.
 * Uses createImageBitmap → canvas which is much more memory-efficient than
 * FileReader → data URL → Image → canvas (avoids holding the full-res bitmap + base64 simultaneously).
 */
async function compressFileToBase64(file: File, maxDim: number): Promise<string> {
  // Use createImageBitmap — browser-native, doesn't create a data URI in memory
  const bitmap = await createImageBitmap(file);
  let w = bitmap.width;
  let h = bitmap.height;
  console.log(`[compress] Original: ${w}×${h}`);

  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create canvas for compression');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close(); // Free the bitmap memory immediately

  const dataUri = canvas.toDataURL('image/jpeg', 0.80);
  canvas.width = 0;
  canvas.height = 0;
  console.log(`[compress] Compressed to ${w}×${h} (${Math.round(dataUri.length / 1024)}KB)`);
  return dataUri;
}

const CATEGORIES: WardrobeItem['category'][] = ['top', 'bottom', 'footwear', 'outerwear', 'dress', 'bag', 'jewellery', 'belt', 'hat'];

const categoryLabel: Record<WardrobeItem['category'], string> = {
  top: 'Tops', bottom: 'Bottoms', footwear: 'Footwear', outerwear: 'Outerwear',
  dress: 'Dresses', bag: 'Bags', jewellery: 'Jewellery', belt: 'Belts', hat: 'Hats',
};

const CATEGORY_COLORS: Record<WardrobeItem['category'], string> = {
  top: '#F2F2F4', bottom: '#F2F2F4', footwear: '#F2F2F4', outerwear: '#F2F2F4',
  dress: '#F2F2F4', bag: '#F2F2F4', jewellery: '#F2F2F4', belt: '#F2F2F4', hat: '#F2F2F4',
};

// ── Basics ──────────────────────────────────────────────────────────────────

type ClothingShape =
  | 'tee' | 'striped-tee' | 'turtleneck' | 'shirt'
  | 'jeans' | 'trousers' | 'midi-skirt'
  | 'midi-dress' | 'shirt-dress' | 'slip-dress'
  | 'sneaker' | 'ankle-boot' | 'loafer' | 'heel' | 'flat'
  | 'jacket' | 'coat' | 'blazer'
  | 'tote' | 'leather-tote' | 'crossbody'
  | 'hoop' | 'necklace' | 'stud'
  | 'belt' | 'hat';

interface BasicItem {
  subcategory: string;
  color: string;
  category: WardrobeItem['category'];
  pattern: string;
  fit: string;
  tags: string[];
  swatchColor: string; // CSS colour for the fill
  svgShape: ClothingShape;
  imageUrl?: string; // Optional real product image URL (takes priority over SVG)
}

/**
 * Generates a clean white-background SVG illustration for a clothing item.
 * The fill colour is taken from the item's swatchColor so it always matches.
 */
function makeClothingSVG(shape: ClothingShape, fill: string): string {
  // Use a darker stroke for very light items so outlines stay visible
  const lightFills = new Set(['#F0F0F0','#F5F5F0','#FAFAFA','#EFEFEF','#F5F5F5','white','#FFFFFF','#E8C9A8','#E0CDB8']);
  const sk = lightFills.has(fill) ? 'rgba(0,0,0,0.20)' : 'rgba(0,0,0,0.10)';
  const fd = 'rgba(0,0,0,0.07)'; // fold / detail lines

  let inner: string;
  switch (shape) {
    case 'tee':
      inner = `
        <path d="M72,52 Q100,70 128,52 L158,42 L175,66 L175,82 L148,86 L148,215 L52,215 L52,86 L25,82 L25,66 L42,42Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M72,52 Q100,72 128,52" fill="none" stroke="${fd}" stroke-width="1"/>`;
      break;
    case 'striped-tee': {
      // Navy base with white stripes using clipPath
      inner = `
        <defs>
          <clipPath id="teeClip">
            <path d="M72,52 Q100,70 128,52 L158,42 L175,66 L175,82 L148,86 L148,215 L52,215 L52,86 L25,82 L25,66 L42,42Z"/>
          </clipPath>
        </defs>
        <path d="M72,52 Q100,70 128,52 L158,42 L175,66 L175,82 L148,86 L148,215 L52,215 L52,86 L25,82 L25,66 L42,42Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <g clip-path="url(#teeClip)">
          <rect x="0" y="86"  width="200" height="10" fill="rgba(255,255,255,0.25)"/>
          <rect x="0" y="106" width="200" height="10" fill="rgba(255,255,255,0.25)"/>
          <rect x="0" y="126" width="200" height="10" fill="rgba(255,255,255,0.25)"/>
          <rect x="0" y="146" width="200" height="10" fill="rgba(255,255,255,0.25)"/>
          <rect x="0" y="166" width="200" height="10" fill="rgba(255,255,255,0.25)"/>
          <rect x="0" y="186" width="200" height="10" fill="rgba(255,255,255,0.25)"/>
        </g>`;
      break;
    }
    case 'turtleneck':
      inner = `
        <rect x="82" y="18" width="36" height="42" rx="18" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M82,44 L72,52 L42,42 L25,66 L25,82 L52,86 L52,215 L148,215 L148,86 L175,82 L175,66 L158,42 L128,52 L118,44Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <line x1="82" y1="44" x2="118" y2="44" stroke="${fd}" stroke-width="1"/>`;
      break;
    case 'shirt':
      inner = `
        <path d="M74,50 L62,36 L40,42 L24,72 L52,82 L52,215 L148,215 L148,82 L176,72 L160,36 L138,50 Q118,58 100,56 Q82,58 74,50Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M74,50 Q88,60 100,56 Q112,60 128,50" fill="none" stroke="${sk}" stroke-width="1.2"/>
        <line x1="100" y1="56" x2="100" y2="215" stroke="${fd}" stroke-width="1"/>
        <circle cx="100" cy="90"  r="2.5" fill="${fd}"/>
        <circle cx="100" cy="114" r="2.5" fill="${fd}"/>
        <circle cx="100" cy="138" r="2.5" fill="${fd}"/>`;
      break;
    case 'jeans':
      inner = `
        <rect x="46" y="20" width="108" height="20" rx="3" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M46,38 L46,250 L92,250 Q100,188 100,136 Q100,188 108,250 L154,250 L154,38Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M100,38 Q100,100 100,136" fill="none" stroke="${fd}" stroke-width="1"/>
        <path d="M56,45 Q72,56 88,44" fill="none" stroke="${fd}" stroke-width="1"/>
        <rect x="60"  y="19" width="7" height="14" rx="2" fill="none" stroke="${fd}" stroke-width="1"/>
        <rect x="93"  y="19" width="7" height="14" rx="2" fill="none" stroke="${fd}" stroke-width="1"/>
        <rect x="133" y="19" width="7" height="14" rx="2" fill="none" stroke="${fd}" stroke-width="1"/>`;
      break;
    case 'trousers':
      inner = `
        <rect x="46" y="20" width="108" height="20" rx="3" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M46,38 L46,250 L92,250 Q100,188 100,136 Q100,188 108,250 L154,250 L154,38Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M100,38 Q100,100 100,136" fill="none" stroke="${fd}" stroke-width="1"/>
        <line x1="56" y1="40" x2="100" y2="48" stroke="${fd}" stroke-width="1"/>
        <line x1="144" y1="40" x2="100" y2="48" stroke="${fd}" stroke-width="1"/>`;
      break;
    case 'midi-skirt':
      inner = `
        <rect x="62" y="20" width="76" height="18" rx="3" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M62,36 L28,250 L172,250 L138,36Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <line x1="100" y1="38" x2="100" y2="250" stroke="${fd}" stroke-width="1"/>`;
      break;
    case 'midi-dress':
      inner = `
        <path d="M72,52 Q100,70 128,52 L150,44 L164,72 L140,80 L140,124 L60,124 L60,80 L36,72 L50,44Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M72,52 Q100,72 128,52" fill="none" stroke="${fd}" stroke-width="1"/>
        <path d="M60,124 L30,255 L170,255 L140,124Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <line x1="60" y1="124" x2="140" y2="124" stroke="${fd}" stroke-width="1"/>`;
      break;
    case 'shirt-dress':
      inner = `
        <path d="M74,50 L62,36 L40,44 L26,74 L56,82 L56,255 L144,255 L144,82 L174,74 L160,36 L138,50 Q118,58 100,56 Q82,58 74,50Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M74,50 Q88,60 100,56 Q112,60 128,50" fill="none" stroke="${sk}" stroke-width="1.2"/>
        <line x1="100" y1="56" x2="100" y2="148" stroke="${fd}" stroke-width="1"/>
        <circle cx="100" cy="88"  r="2.5" fill="${fd}"/>
        <circle cx="100" cy="112" r="2.5" fill="${fd}"/>
        <circle cx="100" cy="136" r="2.5" fill="${fd}"/>
        <rect x="56" y="148" width="88" height="12" rx="2" fill="${fill}" stroke="${fd}" stroke-width="1"/>`;
      break;
    case 'slip-dress':
      inner = `
        <path d="M76,22 L68,82" stroke="${fill}" stroke-width="8" stroke-linecap="round"/>
        <path d="M124,22 L132,82" stroke="${fill}" stroke-width="8" stroke-linecap="round"/>
        <path d="M60,80 Q100,62 140,80 L144,255 L56,255Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M60,80 Q100,64 140,80" fill="none" stroke="${sk}" stroke-width="1.5"/>
        <line x1="76" y1="22"  x2="68" y2="82"  stroke="${sk}" stroke-width="1"/>
        <line x1="124" y1="22" x2="132" y2="82" stroke="${sk}" stroke-width="1"/>`;
      break;
    case 'sneaker':
      inner = `
        <path d="M18,200 Q22,216 60,218 L172,218 Q196,215 196,200 L190,180 Q162,192 100,188 Q50,184 18,200Z"
              fill="rgba(0,0,0,0.12)" stroke="${sk}" stroke-width="0.5"/>
        <path d="M18,200 L26,148 Q38,108 80,96 L132,94 Q178,98 192,142 L196,200 Q162,192 100,188 Q50,184 18,200Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M68,98 Q100,90 132,94" fill="none" stroke="rgba(0,0,0,0.10)" stroke-width="8" stroke-linecap="round"/>
        <line x1="72" y1="100" x2="132" y2="98"  stroke="rgba(255,255,255,0.55)" stroke-width="2.5" stroke-dasharray="8,6"/>
        <line x1="72" y1="110" x2="132" y2="108" stroke="rgba(255,255,255,0.55)" stroke-width="2.5" stroke-dasharray="8,6"/>
        <path d="M26,148 Q22,175 18,200" fill="none" stroke="${fd}" stroke-width="1.5"/>`;
      break;
    case 'ankle-boot':
      inner = `
        <path d="M26,226 L154,226 Q160,232 160,236 L26,236 Q20,232 20,226Z"
              fill="rgba(0,0,0,0.20)" stroke="${sk}" stroke-width="0.5"/>
        <rect x="152" y="188" width="28" height="40" rx="4" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M26,88 L26,226 L152,226 L152,188 L148,128 Q148,90 130,78 L80,74 Q50,74 32,82Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M26,88 Q90,70 152,90" fill="none" stroke="${fd}" stroke-width="1.5"/>
        <line x1="140" y1="90" x2="142" y2="222" stroke="${fd}" stroke-width="1" stroke-dasharray="4,4"/>`;
      break;
    case 'loafer':
      inner = `
        <path d="M16,216 Q20,230 65,232 L174,232 Q198,228 198,216 L192,198 Q160,210 100,206 Q50,202 16,216Z"
              fill="rgba(0,0,0,0.18)" stroke="${sk}" stroke-width="0.5"/>
        <path d="M16,216 L22,172 Q34,138 72,124 L132,122 Q174,126 192,164 L192,198 Q160,210 100,206 Q50,202 16,216Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M24,172 Q100,152 190,166" fill="none" stroke="${fd}" stroke-width="1.2"/>
        <rect x="84" y="122" width="32" height="14" rx="6" fill="${fill}" stroke="${sk}" stroke-width="1.2"/>
        <line x1="100" y1="122" x2="100" y2="112" stroke="${fill}" stroke-width="5" stroke-linecap="round"/>`;
      break;
    case 'heel':
      inner = `
        <path d="M160,182 Q166,212 168,246 L172,246 Q170,212 164,182Z"
              fill="${fill}" stroke="${sk}" stroke-width="1"/>
        <path d="M20,222 L158,222 Q162,228 162,232 L20,232 Q14,228 14,222Z"
              fill="rgba(0,0,0,0.18)" stroke="${sk}" stroke-width="0.5"/>
        <path d="M20,222 L24,188 Q36,156 80,140 Q126,132 150,144 Q166,156 164,182 L160,222Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M24,188 Q52,178 82,178 Q112,172 150,168" fill="none" stroke="${fd}" stroke-width="1.5"/>`;
      break;
    case 'flat':
      inner = `
        <path d="M14,218 Q18,232 68,234 L172,234 Q196,230 196,218 L190,205 Q158,216 100,212 Q50,208 14,218Z"
              fill="rgba(0,0,0,0.16)" stroke="${sk}" stroke-width="0.5"/>
        <path d="M14,218 L20,186 Q32,154 72,142 L132,140 Q178,144 190,170 L190,205 Q158,216 100,212 Q50,208 14,218Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M22,186 Q100,164 188,175" fill="none" stroke="${fd}" stroke-width="1.5"/>
        <path d="M84,148 Q100,144 116,148 Q100,156 84,148Z" fill="${fill}" stroke="${sk}" stroke-width="1"/>
        <circle cx="100" cy="151" r="4" fill="${fill}" stroke="${sk}" stroke-width="1"/>`;
      break;
    case 'jacket':
      inner = `
        <path d="M44,42 L44,230 L156,230 L156,42 L130,30 L118,62 L100,68 L82,62 L70,30Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M70,30 L82,62 L100,68 L62,118 L44,98 L44,42Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M130,30 L118,62 L100,68 L138,118 L156,98 L156,42Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <line x1="100" y1="68" x2="100" y2="230" stroke="${fd}" stroke-width="2" stroke-dasharray="4,3"/>
        <path d="M44,42 L16,58 L18,148 L44,152 L44,42Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M156,42 L184,58 L182,148 L156,152 L156,42Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <rect x="116" y="86" width="26" height="16" rx="2" fill="none" stroke="${fd}" stroke-width="1"/>`;
      break;
    case 'coat':
      inner = `
        <path d="M42,44 L42,268 L158,268 L158,44 L132,30 L120,58 L100,64 L80,58 L68,30Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M68,30 L80,58 L100,64 L58,112 L42,90 L42,44Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M132,30 L120,58 L100,64 L142,112 L158,90 L158,44Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M100,64 L92,80 L100,74 L108,80Z" fill="${fd}"/>
        <rect x="42" y="148" width="116" height="14" rx="3" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <rect x="86" y="144" width="28" height="22" rx="3" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <circle cx="104" cy="90"  r="3.5" fill="none" stroke="${fd}" stroke-width="1.5"/>
        <circle cx="104" cy="115" r="3.5" fill="none" stroke="${fd}" stroke-width="1.5"/>
        <circle cx="104" cy="200" r="3.5" fill="none" stroke="${fd}" stroke-width="1.5"/>
        <circle cx="104" cy="225" r="3.5" fill="none" stroke="${fd}" stroke-width="1.5"/>
        <rect x="44" y="190" width="28" height="20" rx="3" fill="none" stroke="${fd}" stroke-width="1"/>
        <rect x="128" y="190" width="28" height="20" rx="3" fill="none" stroke="${fd}" stroke-width="1"/>
        <path d="M42,44 L14,60 L16,170 L42,174 L42,44Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M158,44 L186,60 L184,170 L158,174 L158,44Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>`;
      break;
    case 'blazer':
      inner = `
        <path d="M44,44 L44,232 L156,232 L156,44 L130,30 L118,58 L100,64 L82,58 L70,30Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M70,30 L82,58 L100,64 L58,114 L44,92 L44,44Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M130,30 L118,58 L100,64 L142,114 L156,92 L156,44Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M100,64 L92,80 L100,74 L108,80Z" fill="${fd}"/>
        <circle cx="104" cy="132" r="4.5" fill="none" stroke="${fd}" stroke-width="1.5"/>
        <circle cx="104" cy="156" r="4.5" fill="none" stroke="${fd}" stroke-width="1.5"/>
        <rect x="48" y="162" width="26" height="16" rx="2" fill="none" stroke="${fd}" stroke-width="1"/>
        <rect x="126" y="162" width="26" height="16" rx="2" fill="none" stroke="${fd}" stroke-width="1"/>
        <path d="M44,44 L16,60 L18,156 L44,160 L44,44Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M156,44 L184,60 L182,156 L156,160 L156,44Z" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>`;
      break;
    case 'tote':
      inner = `
        <path d="M64,38 Q64,14 100,10 Q136,14 136,38" fill="none" stroke="${fill}" stroke-width="7" stroke-linecap="round"/>
        <path d="M64,38 Q64,14 100,10 Q136,14 136,38" fill="none" stroke="${sk}" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M28,42 L28,238 Q28,248 38,248 L162,248 Q172,248 172,238 L172,42Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <rect x="28" y="36" width="144" height="20" rx="4" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <line x1="100" y1="56" x2="100" y2="248" stroke="${fd}" stroke-width="1"/>`;
      break;
    case 'leather-tote':
      inner = `
        <path d="M64,38 Q64,14 100,10 Q136,14 136,38" fill="none" stroke="${fill}" stroke-width="7" stroke-linecap="round"/>
        <path d="M64,38 Q64,14 100,10 Q136,14 136,38" fill="none" stroke="${sk}" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M28,42 L28,238 Q28,248 38,248 L162,248 Q172,248 172,238 L172,42Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <rect x="28" y="36" width="144" height="20" rx="4" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <line x1="100" y1="56" x2="100" y2="248" stroke="${fd}" stroke-width="1"/>
        <rect x="60" y="120" width="80" height="62" rx="5" fill="none" stroke="${fd}" stroke-width="1.5"/>
        <line x1="60" y1="120" x2="140" y2="120" stroke="${fd}" stroke-width="1.5"/>`;
      break;
    case 'crossbody':
      inner = `
        <path d="M40,36 Q22,80 30,135" stroke="${fill}" stroke-width="7" stroke-linecap="round" fill="none"/>
        <path d="M40,36 Q22,80 30,135" stroke="${sk}" stroke-width="1.2" stroke-linecap="round" fill="none"/>
        <rect x="44" y="82" width="118" height="128" rx="12" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M44,82 L44,150 Q44,160 103,160 Q162,160 162,150 L162,82Z"
              fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <rect x="86" y="152" width="28" height="14" rx="7" fill="rgba(180,150,100,0.85)" stroke="${sk}" stroke-width="1"/>
        <line x1="56" y1="180" x2="150" y2="180" stroke="${fd}" stroke-width="1"/>`;
      break;
    case 'hoop':
      inner = `
        <circle cx="68"  cy="134" r="44" fill="none" stroke="${fill}" stroke-width="11"/>
        <circle cx="140" cy="134" r="44" fill="none" stroke="${fill}" stroke-width="11"/>
        <path d="M68,90  Q68,76  78,70"  fill="none" stroke="${fill}" stroke-width="6" stroke-linecap="round"/>
        <path d="M140,90 Q140,76 150,70" fill="none" stroke="${fill}" stroke-width="6" stroke-linecap="round"/>`;
      break;
    case 'necklace':
      inner = `
        <path d="M28,60 Q28,202 100,224 Q172,202 172,60"
              fill="none" stroke="${fill}" stroke-width="4.5" stroke-dasharray="6,4"/>
        <circle cx="28"  cy="60"  r="6"  fill="${fill}"/>
        <circle cx="172" cy="60"  r="6"  fill="${fill}"/>
        <circle cx="100" cy="222" r="12" fill="${fill}" stroke="${sk}" stroke-width="1"/>
        <circle cx="100" cy="222" r="6"  fill="rgba(255,255,255,0.35)"/>`;
      break;
    case 'stud':
      inner = `
        <circle cx="68"  cy="134" r="18" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <circle cx="68"  cy="134" r="9"  fill="rgba(255,255,255,0.35)"/>
        <circle cx="132" cy="134" r="18" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <circle cx="132" cy="134" r="9"  fill="rgba(255,255,255,0.35)"/>
        <line x1="68"  y1="116" x2="68"  y2="100" stroke="${fill}" stroke-width="5" stroke-linecap="round"/>
        <line x1="132" y1="116" x2="132" y2="100" stroke="${fill}" stroke-width="5" stroke-linecap="round"/>`;
      break;
    case 'belt':
      inner = `
        <rect x="20" y="115" width="160" height="30" rx="6" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <rect x="82" y="108" width="36" height="44" rx="4" fill="none" stroke="${sk}" stroke-width="3"/>
        <circle cx="100" cy="130" r="4" fill="${sk}"/>`;
      break;
    case 'hat':
      inner = `
        <ellipse cx="100" cy="170" rx="80" ry="16" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>
        <path d="M50,170 Q50,90 100,80 Q150,90 150,170" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>`;
      break;
    default:
      inner = `<circle cx="100" cy="130" r="60" fill="${fill}" stroke="${sk}" stroke-width="1.5"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260" width="200" height="260"><rect width="200" height="260" fill="white"/>${inner}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// AI-generated product images via Replicate Flux — local files in public/basics/
const BASICS: BasicItem[] = [
  // Tops
  { category: 'top', subcategory: 'classic tee',        color: 'white',      pattern: 'plain',   fit: 'regular',   tags: ['casual', 'minimal'],       swatchColor: '#F0F0F0', svgShape: 'tee',         imageUrl: '/basics/white-classic-tee.png' },
  { category: 'top', subcategory: 'sweater',             color: 'white',      pattern: 'plain',   fit: 'regular',   tags: ['casual', 'cosy'],           swatchColor: '#F5F5F0', svgShape: 'tee',         imageUrl: '/basics/white-sweater.png' },
  { category: 'top', subcategory: 'turtleneck sweater',  color: 'black',      pattern: 'plain',   fit: 'fitted',    tags: ['minimal', 'classic'],       swatchColor: '#2D2D2D', svgShape: 'turtleneck',  imageUrl: '/basics/black-turtleneck.png' },
  { category: 'top', subcategory: 'crewneck sweater',    color: 'grey',       pattern: 'plain',   fit: 'regular',   tags: ['casual', 'minimal'],        swatchColor: '#ADADAD', svgShape: 'tee',         imageUrl: '/basics/grey-crewneck.png' },
  { category: 'top', subcategory: 'striped tee',         color: 'navy',       pattern: 'striped', fit: 'regular',   tags: ['casual', 'classic'],        swatchColor: '#1B3060', svgShape: 'striped-tee', imageUrl: '/basics/navy-striped-tee.png' },
  { category: 'top', subcategory: 'button-down shirt',   color: 'white',      pattern: 'plain',   fit: 'regular',   tags: ['smart', 'versatile'],       swatchColor: '#FAFAFA', svgShape: 'shirt',       imageUrl: '/basics/white-button-down.png' },
  { category: 'top', subcategory: 'linen shirt',         color: 'beige',      pattern: 'plain',   fit: 'relaxed',   tags: ['casual', 'summer'],         swatchColor: '#D4C5A9', svgShape: 'shirt',       imageUrl: '/basics/beige-linen-shirt.png' },
  // Bottoms
  { category: 'bottom', subcategory: 'wide-leg jeans',   color: 'light blue', pattern: 'plain',   fit: 'relaxed',   tags: ['casual', 'trendy'],         swatchColor: '#8BB8D8', svgShape: 'jeans',       imageUrl: '/basics/lightblue-wideleg-jeans.png' },
  { category: 'bottom', subcategory: 'skinny jeans',     color: 'black',      pattern: 'plain',   fit: 'slim',      tags: ['casual', 'versatile'],      swatchColor: '#2A2A2A', svgShape: 'jeans',       imageUrl: '/basics/black-skinny-jeans.png' },
  { category: 'bottom', subcategory: 'straight jeans',   color: 'dark blue',  pattern: 'plain',   fit: 'regular',   tags: ['casual', 'classic'],        swatchColor: '#2C4A6E', svgShape: 'jeans',       imageUrl: '/basics/darkblue-straight-jeans.png' },
  { category: 'bottom', subcategory: 'tailored trousers',color: 'black',      pattern: 'plain',   fit: 'slim',      tags: ['smart', 'work'],            swatchColor: '#1A1A1A', svgShape: 'trousers',    imageUrl: '/basics/black-tailored-trousers.png' },
  { category: 'bottom', subcategory: 'chinos',           color: 'beige',      pattern: 'plain',   fit: 'regular',   tags: ['smart-casual', 'versatile'],swatchColor: '#C8B896', svgShape: 'trousers',    imageUrl: '/basics/beige-chinos.png' },
  { category: 'bottom', subcategory: 'mini skirt',        color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['casual', 'trendy'],         swatchColor: '#1A1A1A', svgShape: 'midi-skirt',  imageUrl: '/basics/black-mini-skirt.png' },
  { category: 'bottom', subcategory: 'midi skirt',        color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['elegant', 'versatile'],     swatchColor: '#1A1A1A', svgShape: 'midi-skirt',  imageUrl: '/basics/black-midi-skirt.png' },
  { category: 'bottom', subcategory: 'maxi skirt',        color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['elegant', 'flowing'],       swatchColor: '#1A1A1A', svgShape: 'midi-skirt',  imageUrl: '/basics/black-maxi-skirt.png' },
  { category: 'bottom', subcategory: 'mini skirt',        color: 'beige',      pattern: 'plain',   fit: 'regular',   tags: ['casual', 'summer'],         swatchColor: '#D4C5A9', svgShape: 'midi-skirt',  imageUrl: '/basics/beige-mini-skirt.png' },
  { category: 'bottom', subcategory: 'midi skirt',        color: 'beige',      pattern: 'plain',   fit: 'regular',   tags: ['elegant', 'versatile'],     swatchColor: '#D4C5A9', svgShape: 'midi-skirt',  imageUrl: '/basics/beige-midi-skirt.png' },
  { category: 'bottom', subcategory: 'maxi skirt',        color: 'beige',      pattern: 'plain',   fit: 'regular',   tags: ['elegant', 'flowing'],       swatchColor: '#D4C5A9', svgShape: 'midi-skirt',  imageUrl: '/basics/beige-maxi-skirt.png' },
  { category: 'bottom', subcategory: 'mini skirt',        color: 'navy',       pattern: 'plain',   fit: 'regular',   tags: ['casual', 'classic'],        swatchColor: '#1B3060', svgShape: 'midi-skirt',  imageUrl: '/basics/blue-mini-skirt.png' },
  { category: 'bottom', subcategory: 'midi skirt',        color: 'navy',       pattern: 'plain',   fit: 'regular',   tags: ['elegant', 'versatile'],     swatchColor: '#1B3060', svgShape: 'midi-skirt',  imageUrl: '/basics/blue-midi-skirt.png' },
  { category: 'bottom', subcategory: 'maxi skirt',        color: 'navy',       pattern: 'plain',   fit: 'regular',   tags: ['elegant', 'flowing'],       swatchColor: '#1B3060', svgShape: 'midi-skirt',  imageUrl: '/basics/blue-maxi-skirt.png' },
  // Footwear
  { category: 'footwear', subcategory: 'sneakers',       color: 'white',      pattern: 'plain',   fit: 'regular',   tags: ['casual', 'sporty'],         swatchColor: '#EFEFEF', svgShape: 'sneaker',     imageUrl: '/basics/white-sneakers.png' },
  { category: 'footwear', subcategory: 'ankle boots',    color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['versatile', 'classic'],     swatchColor: '#1A1A1A', svgShape: 'ankle-boot',  imageUrl: '/basics/black-ankle-boots.png' },
  { category: 'footwear', subcategory: 'loafers',        color: 'tan',        pattern: 'plain',   fit: 'regular',   tags: ['smart-casual', 'classic'],  swatchColor: '#C4A882', svgShape: 'loafer',      imageUrl: '/basics/tan-loafers.png' },
  { category: 'footwear', subcategory: 'heels',          color: 'nude',       pattern: 'plain',   fit: 'regular',   tags: ['elegant', 'versatile'],     swatchColor: '#E8C9A8', svgShape: 'heel',        imageUrl: '/basics/nude-heels.png' },
  { category: 'footwear', subcategory: 'ballet flats',   color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['minimal', 'classic'],       swatchColor: '#2A2A2A', svgShape: 'flat',        imageUrl: '/basics/black-ballet-flats.png' },
  // Outerwear
  { category: 'outerwear', subcategory: 'leather jacket',color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['edgy', 'cool'],             swatchColor: '#1A1A1A', svgShape: 'jacket',      imageUrl: '/basics/black-leather-jacket.png' },
  { category: 'outerwear', subcategory: 'trench coat',   color: 'camel',      pattern: 'plain',   fit: 'oversized', tags: ['classic', 'elegant'],       swatchColor: '#C4A86A', svgShape: 'coat',        imageUrl: '/basics/camel-trench-coat.png' },
  { category: 'outerwear', subcategory: 'blazer',        color: 'navy',       pattern: 'plain',   fit: 'regular',   tags: ['smart', 'work'],            swatchColor: '#1B3060', svgShape: 'blazer',      imageUrl: '/basics/navy-blazer.png' },
  { category: 'outerwear', subcategory: 'wool coat',     color: 'grey',       pattern: 'plain',   fit: 'oversized', tags: ['classic', 'winter'],        swatchColor: '#8A8A8A', svgShape: 'coat',        imageUrl: '/basics/grey-wool-coat.png' },
  // Dresses
  { category: 'dress', subcategory: 'midi dress',        color: 'black',      pattern: 'plain',   fit: 'fitted',    tags: ['elegant', 'versatile'],     swatchColor: '#1A1A1A', svgShape: 'midi-dress',  imageUrl: '/basics/black-midi-dress.png' },
  { category: 'dress', subcategory: 'shirt dress',       color: 'white',      pattern: 'plain',   fit: 'regular',   tags: ['casual', 'effortless'],     swatchColor: '#F5F5F0', svgShape: 'shirt-dress', imageUrl: '/basics/white-shirt-dress.png' },
  { category: 'dress', subcategory: 'slip dress',        color: 'beige',      pattern: 'plain',   fit: 'regular',   tags: ['minimal', 'elegant'],       swatchColor: '#E0CDB8', svgShape: 'slip-dress',  imageUrl: '/basics/beige-slip-dress.png' },
  // Bags
  { category: 'bag', subcategory: 'tote bag',            color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['practical', 'everyday'],    swatchColor: '#1A1A1A', svgShape: 'tote',        imageUrl: '/basics/black-tote-bag.png' },
  { category: 'bag', subcategory: 'leather tote',        color: 'tan',        pattern: 'plain',   fit: 'regular',   tags: ['classic', 'work'],          swatchColor: '#C4A882', svgShape: 'leather-tote',imageUrl: '/basics/tan-leather-tote.png' },
  { category: 'bag', subcategory: 'crossbody bag',       color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['casual', 'practical'],      swatchColor: '#2A2A2A', svgShape: 'crossbody',   imageUrl: '/basics/black-crossbody-bag.png' },
  // Jewellery
  { category: 'jewellery', subcategory: 'hoop earrings', color: 'gold',       pattern: 'plain',   fit: 'regular',   tags: ['classic', 'versatile'],     swatchColor: '#D4AF37', svgShape: 'hoop',        imageUrl: '/basics/gold-hoop-earrings.png' },
  { category: 'jewellery', subcategory: 'chain necklace',color: 'silver',     pattern: 'plain',   fit: 'regular',   tags: ['minimal', 'classic'],       swatchColor: '#C0C0C0', svgShape: 'necklace',    imageUrl: '/basics/silver-chain-necklace.png' },
  { category: 'jewellery', subcategory: 'stud earrings', color: 'gold',       pattern: 'plain',   fit: 'regular',   tags: ['minimal', 'everyday'],      swatchColor: '#D4AF37', svgShape: 'stud',        imageUrl: '/basics/gold-stud-earrings.png' },
  // Belts
  { category: 'belt', subcategory: 'leather belt',       color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['classic', 'versatile'],     swatchColor: '#1A1A1A', svgShape: 'belt',     imageUrl: '/basics/black-leather-belt.png' },
  { category: 'belt', subcategory: 'leather belt',       color: 'brown',      pattern: 'plain',   fit: 'regular',   tags: ['classic', 'smart-casual'],  swatchColor: '#6B3A2A', svgShape: 'belt',     imageUrl: '/basics/brown-leather-belt.png' },
  { category: 'belt', subcategory: 'woven belt',         color: 'tan',        pattern: 'woven',   fit: 'regular',   tags: ['casual', 'summer'],         swatchColor: '#C4A882', svgShape: 'belt',     imageUrl: '/basics/tan-woven-belt.png' },
  { category: 'belt', subcategory: 'chain belt',         color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['elegant', 'trendy'],        swatchColor: '#2A2A2A', svgShape: 'belt',     imageUrl: '/basics/black-chain-belt.png' },
  // Hats
  { category: 'hat', subcategory: 'fedora',              color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['classic', 'smart'],         swatchColor: '#1A1A1A', svgShape: 'hat',      imageUrl: '/basics/black-fedora.png' },
  { category: 'hat', subcategory: 'straw hat',           color: 'beige',      pattern: 'plain',   fit: 'regular',   tags: ['casual', 'summer'],         swatchColor: '#D4C5A9', svgShape: 'hat',      imageUrl: '/basics/beige-straw-hat.png' },
  { category: 'hat', subcategory: 'baseball cap',        color: 'black',      pattern: 'plain',   fit: 'regular',   tags: ['casual', 'sporty'],         swatchColor: '#1A1A1A', svgShape: 'hat',      imageUrl: '/basics/black-baseball-cap.png' },
  { category: 'hat', subcategory: 'beanie',              color: 'grey',       pattern: 'plain',   fit: 'regular',   tags: ['casual', 'winter'],         swatchColor: '#8A8A8A', svgShape: 'hat',      imageUrl: '/basics/grey-beanie.png' },
];

// Grouped by category for rendering
const BASICS_BY_CATEGORY: { category: WardrobeItem['category']; label: string; items: BasicItem[] }[] = [
  { category: 'top',       label: 'Tops',      items: BASICS.filter(b => b.category === 'top') },
  { category: 'bottom',    label: 'Bottoms',   items: BASICS.filter(b => b.category === 'bottom') },
  { category: 'footwear',  label: 'Footwear',  items: BASICS.filter(b => b.category === 'footwear') },
  { category: 'outerwear', label: 'Outerwear', items: BASICS.filter(b => b.category === 'outerwear') },
  { category: 'dress',     label: 'Dresses',   items: BASICS.filter(b => b.category === 'dress') },
  { category: 'bag',       label: 'Bags',      items: BASICS.filter(b => b.category === 'bag') },
  { category: 'jewellery', label: 'Jewellery', items: BASICS.filter(b => b.category === 'jewellery') },
  { category: 'belt',      label: 'Belts',     items: BASICS.filter(b => b.category === 'belt') },
  { category: 'hat',       label: 'Hats',      items: BASICS.filter(b => b.category === 'hat') },
];

// ── Demo detections used when no API key is configured ──────────────────────
// Demo detections used when no API key is configured
const DEMO_DETECTIONS: RawDetection[] = [
  { category: 'top', categoryConfidence: 0.92, subcategory: 'blazer', subcategoryConfidence: 0.88, color: 'navy', colorConfidence: 0.95, brand: 'Zara', brandConfidence: 0.55, pattern: 'plain', fit: 'regular', tags: ['formal', 'work'], boundingBox: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } },
  { category: 'bottom', categoryConfidence: 0.90, subcategory: 'trousers', subcategoryConfidence: 0.85, color: 'charcoal', colorConfidence: 0.88, brand: '', brandConfidence: 0.3, pattern: 'plain', fit: 'slim', tags: ['formal'], boundingBox: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } },
  { category: 'footwear', categoryConfidence: 0.96, subcategory: 'sneakers', subcategoryConfidence: 0.91, color: 'white', colorConfidence: 0.98, brand: 'Nike', brandConfidence: 0.91, pattern: 'plain', fit: 'regular', tags: ['casual', 'sporty'], boundingBox: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } },
  { category: 'dress', categoryConfidence: 0.94, subcategory: 'midi dress', subcategoryConfidence: 0.87, color: 'black', colorConfidence: 0.96, brand: '', brandConfidence: 0.3, pattern: 'plain', fit: 'fitted', tags: ['elegant', 'evening'], boundingBox: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } },
  { category: 'outerwear', categoryConfidence: 0.89, subcategory: 'trench coat', subcategoryConfidence: 0.84, color: 'camel', colorConfidence: 0.91, brand: 'Burberry', brandConfidence: 0.78, pattern: 'plain', fit: 'oversized', tags: ['classic', 'winter'], boundingBox: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } },
];

interface EditModal {
  item: WardrobeItem;
}

export default function Wardrobe() {
  const { user, refresh } = useUser();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | WardrobeItem['category']>('all');
  const [editModal, setEditModal] = useState<EditModal | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [addProgress, setAddProgress] = useState('');
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const items = user.wardrobeItems;

  const filtered = items.filter(item => {
    const matchCategory = activeCategory === 'all' || item.category === activeCategory;
    const q = search.toLowerCase();
    const matchSearch = !q || item.color.includes(q) || item.subcategory.includes(q) || item.category.includes(q) || item.tags.some(t => t.includes(q));
    return matchCategory && matchSearch;
  });

  const counts: Record<string, number> = { all: items.length };
  for (const c of CATEGORIES) counts[c] = items.filter(i => i.category === c).length;

  const handleAddPhotos = async (files: FileList) => {
    if (files.length === 0) return;
    setAddLoading(true);
    const hasApiKey = hasClaudeKey();
    const allDetected: DetectedItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      const originalImageUrl = URL.createObjectURL(file);
      setAddProgress(`Analysing photo ${i + 1} of ${files.length}… (this may take 1-2 min on first use)`);

      try {
        if (hasApiKey) {
          console.log(`[Wardrobe] Photo ${i + 1}: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB, ${file.type})`);
          // Compress BEFORE base64 conversion to avoid holding huge strings in memory
          const base64 = await compressFileToBase64(file, 800);
          console.log(`[Wardrobe] Photo ${i + 1}: compressed to ${Math.round(base64.length / 1024)}KB base64`);
          // Show progress updates during long pipeline runs
          const progressTimer = setInterval(() => {
            setAddProgress(p => {
              if (p.includes('Segmenting')) return p;
              return `Segmenting clothing items… (AI model warming up, please wait)`;
            });
          }, 8000);
          const result = await processClothingImage(base64, file.type || 'image/jpeg', originalImageUrl);
          clearInterval(progressTimer);
          allDetected.push(...result.items);
          console.log(`[Wardrobe] Photo ${i + 1}: path=${result.pipelinePath}, items=${result.items.length}, confidence=${result.segmentationQuality?.segmentation_confidence?.toFixed(2) ?? 'n/a'}`, result.timing);
        } else {
          // Demo fallback when no API keys are set
          await new Promise(r => setTimeout(r, 600));
          const raw = DEMO_DETECTIONS[i % DEMO_DETECTIONS.length];
          let croppedImageUrl = originalImageUrl;
          try {
            croppedImageUrl = await cropImage(originalImageUrl, raw.boundingBox);
          } catch {
            // fallback: use full photo
          }
          allDetected.push({
            tempId: genId(),
            croppedImageUrl,
            originalImageUrl,
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
        console.error('Detection failed:', err);
        allDetected.push({
          tempId: genId(),
          croppedImageUrl: originalImageUrl,
          originalImageUrl,
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

    setAddLoading(false);
    setAddProgress('');
    if (allDetected.length > 0) {
      setDetectedItems(allDetected);
      setShowReview(true);
    }
  };

  const handleReviewConfirm = (confirmed: WardrobeItem[]) => {
    for (const item of confirmed) addWardrobeItem(item);
    refresh();
    setShowReview(false);
    setDetectedItems([]);
  };

  const handleReviewCancel = () => {
    setShowReview(false);
    setDetectedItems([]);
  };

  const handleAddFromLink = async () => {
    if (!linkUrl || linkUrl.length < 10) return;
    setLinkLoading(true);
    setAddProgress('Reading product page…');
    try {
      const result = await detectItemFromUrl(linkUrl);
      const detected: DetectedItem = {
        tempId: genId(),
        croppedImageUrl: result.imageUrl || '',
        originalImageUrl: result.imageUrl || '',
        category: result.category,
        categoryConfidence: result.categoryConfidence,
        subcategory: result.subcategory,
        subcategoryConfidence: result.subcategoryConfidence,
        color: result.color,
        colorConfidence: result.colorConfidence,
        brand: result.brand,
        brandConfidence: result.brandConfidence,
        pattern: result.pattern,
        fit: result.fit,
        tags: result.tags,
        boundingBox: { x: 0, y: 0, width: 1, height: 1 },
      };
      setDetectedItems([detected]);
      setShowReview(true);
      setShowLinkInput(false);
      setLinkUrl('');
    } catch (err) {
      console.error('URL detection failed:', err);
      setAddProgress('Failed to read link. Try again or use a photo.');
      setTimeout(() => setAddProgress(''), 3000);
    }
    setLinkLoading(false);
  };

  /** True if a wardrobe item with this subcategory + color already exists */
  const isBasicAdded = (b: BasicItem) =>
    items.some(
      i =>
        i.subcategory.toLowerCase() === b.subcategory.toLowerCase() &&
        i.color.toLowerCase() === b.color.toLowerCase(),
    );

  const addBasic = (b: BasicItem) => {
    if (isBasicAdded(b)) return;
    addWardrobeItem({
      id: genId(),
      imageUrl: b.imageUrl || makeClothingSVG(b.svgShape, b.swatchColor),
      category: b.category,
      subcategory: b.subcategory,
      color: b.color,
      pattern: b.pattern,
      fit: b.fit,
      brand: '',
      wearCount: 0,
      lastWorn: null,
      estimatedValue: 0,
      tags: b.tags,
    });
    refresh();
  };

  const removeBasic = (b: BasicItem) => {
    const existing = items.find(
      i =>
        i.subcategory.toLowerCase() === b.subcategory.toLowerCase() &&
        i.color.toLowerCase() === b.color.toLowerCase(),
    );
    if (existing) {
      deleteWardrobeItem(existing.id);
      refresh();
    }
  };

  const saveEdit = () => {
    if (!editModal) return;
    updateWardrobeItem(editModal.item);
    refresh();
    setEditModal(null);
  };

  const handleDelete = (id: string) => {
    deleteWardrobeItem(id);
    refresh();
    setEditModal(null);
  };

  const summary = () => {
    const tops = items.filter(i => i.category === 'top').length;
    const bottoms = items.filter(i => i.category === 'bottom').length;
    const footwear = items.filter(i => i.category === 'footwear').length;
    const parts = [];
    if (tops) parts.push(`${tops} top${tops > 1 ? 's' : ''}`);
    if (bottoms) parts.push(`${bottoms} bottom${bottoms > 1 ? 's' : ''}`);
    if (footwear) parts.push(`${footwear} pair${footwear > 1 ? 's' : ''} of footwear`);
    return parts.length ? parts.join(', ') : `${items.length} items`;
  };

  return (
    <div className="px-4 pt-4 pb-4">
      <PageHeader
        title="Wardrobe"
        subtitle={items.length > 0 ? `You own ${summary()}` : 'No items yet — add your first piece'}
        action={
          <div className="relative">
            <button
              onClick={() => setShowAddMenu(v => !v)}
              disabled={addLoading || linkLoading}
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              {(addLoading || linkLoading)
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Plus size={18} />}
            </button>
            {showAddMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
                <div
                  className="absolute right-0 top-11 z-50 rounded-xl shadow-lg overflow-hidden"
                  style={{ background: 'var(--surface)', border: '1px solid rgba(43,43,43,0.1)', minWidth: '170px' }}
                >
                  <button
                    onClick={() => { setShowAddMenu(false); fileInputRef.current?.click(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-gray-50 transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <Camera size={16} style={{ color: 'var(--accent)' }} />
                    Add from photo
                  </button>
                  <div style={{ borderTop: '1px solid rgba(43,43,43,0.06)' }} />
                  <button
                    onClick={() => { setShowAddMenu(false); setShowLinkInput(true); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-gray-50 transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <Link2 size={16} style={{ color: 'var(--accent)' }} />
                    Add from link
                  </button>
                </div>
              </>
            )}
          </div>
        }
      />

      {/* Loading progress */}
      {(addLoading || linkLoading) && addProgress && (
        <div className="mb-3 px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2"
          style={{ background: 'var(--accent-light)', color: 'var(--accent-dark)' }}>
          <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
          {addProgress}
        </div>
      )}

      {/* Link input panel */}
      {showLinkInput && (
        <div className="mb-4 rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid rgba(43,43,43,0.12)' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(43,43,43,0.45)' }}>
              Add from product link
            </p>
            <button onClick={() => { setShowLinkInput(false); setLinkUrl(''); }}>
              <X size={16} style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>
          <p className="text-xs mb-3" style={{ color: 'rgba(43,43,43,0.5)' }}>
            Paste a product URL — Anera will auto-detect the item details, colour, brand, and image.
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              placeholder="https://www.zara.com/…"
              className="flex-1 px-4 py-3 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', border: '1px solid rgba(43,43,43,0.12)', color: 'var(--text-primary)' }}
              onKeyDown={e => { if (e.key === 'Enter' && !linkLoading) handleAddFromLink(); }}
              autoFocus
            />
            <button
              onClick={handleAddFromLink}
              disabled={linkLoading || !linkUrl || linkUrl.length < 10}
              className="px-5 py-3 rounded-xl font-semibold text-sm text-white flex items-center gap-2 flex-shrink-0"
              style={{ background: (!linkUrl || linkUrl.length < 10) ? 'rgba(43,43,43,0.2)' : 'var(--accent)' }}
            >
              {linkLoading
                ? <><Loader2 size={14} className="animate-spin" />Reading…</>
                : <>Detect</>
              }
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(43,43,43,0.35)' }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by colour, type, tag…"
          className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none"
          style={{ background: 'var(--surface)', border: '1px solid rgba(43,43,43,0.12)', color: 'var(--text-primary)' }}
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 no-scrollbar">
        {(['all', ...CATEGORIES] as const).map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
            style={{
              background: activeCategory === cat ? 'var(--accent)' : 'transparent',
              color: activeCategory === cat ? 'white' : 'var(--text-secondary)',
              border: `1px solid ${activeCategory === cat ? 'var(--accent)' : 'rgba(43,43,43,0.12)'}`,
            }}
          >
            {cat === 'all' ? 'All' : categoryLabel[cat]} {counts[cat] > 0 && `(${counts[cat]})`}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div
          className="rounded-2xl flex flex-col items-center justify-center py-16 text-center"
          style={{ border: '1.5px dashed rgba(43,43,43,0.12)', background: 'var(--surface)' }}
        >
          <div className="text-4xl mb-3">👗</div>
          <p className="font-bold text-sm mb-1" style={{ color: '#2B2B2B', letterSpacing: '-0.5px' }}>
            {search ? 'No items match your search' : 'Your wardrobe is empty'}
          </p>
          <p className="text-xs" style={{ color: 'rgba(43,43,43,0.5)' }}>
            {search ? 'Try a different keyword' : 'Tap + to add your first item'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {filtered.map(item => (
            <div
              key={item.id}
              className="relative rounded-2xl overflow-hidden cursor-pointer active:scale-95 transition-transform"
              style={{ background: CATEGORY_COLORS[item.category] || 'var(--accent-light)', border: '1px solid rgba(43,43,43,0.06)' }}
            >
              {/* Delete button — top-right corner */}
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full flex items-center justify-center bg-black/40 hover:bg-red-500 transition-colors"
                aria-label="Remove item"
              >
                <X size={13} color="white" strokeWidth={2.5} />
              </button>
              <div
                onClick={() => setEditModal({ item: { ...item } })}
              >
                <div className="aspect-square w-full rounded-xl overflow-hidden" style={{ background: '#F2F2F4' }}>
                  {item.imageUrl ? (
                    <img src={item.imageUrl} className="w-full h-full object-contain p-2" alt={item.subcategory} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl opacity-40">👕</div>
                  )}
                </div>
                <div className="px-2 py-2">
                  <p className="text-xs font-semibold capitalize truncate" style={{ color: '#2B2B2B' }}>
                    {item.color} {item.subcategory}
                  </p>
                  <p className="text-[10px]" style={{ color: 'rgba(43,43,43,0.5)' }}>
                    worn {item.wearCount}×
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Basics you may already own ───────────────────────────────────── */}
      <div className="mt-8 mb-2">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={15} style={{ color: 'var(--accent)' }} />
          <h2 className="text-sm font-bold" style={{ color: '#2B2B2B', letterSpacing: '-0.5px' }}>
            Basics you may already own
          </h2>
        </div>
        <p className="text-xs mb-4" style={{ color: 'rgba(43,43,43,0.5)' }}>
          Tap + to add common pieces without uploading a photo. Tap × to remove.
        </p>

        <div className="space-y-5">
          {BASICS_BY_CATEGORY.map(({ category, label, items: basics }) => (
            <div key={category}>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2.5" style={{ color: 'rgba(43,43,43,0.45)' }}>
                {label}
              </p>
              <ScrollRow>
                {basics.map(b => (
                  <BasicCard
                    key={`${b.color}-${b.subcategory}`}
                    basic={b}
                    added={isBasicAdded(b)}
                    onAdd={() => addBasic(b)}
                    onRemove={() => removeBasic(b)}
                  />
                ))}
              </ScrollRow>
            </div>
          ))}
        </div>
      </div>

      {/* Hidden file input — allows multiple photos */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => { if (e.target.files && e.target.files.length > 0) handleAddPhotos(e.target.files); }}
      />

      {/* Multi-item review overlay */}
      {showReview && (
        <MultiItemReview
          items={detectedItems}
          onConfirm={handleReviewConfirm}
          onCancel={handleReviewCancel}
        />
      )}

      {/* Edit existing item modal */}
      {editModal && (
        <div
          className="fixed inset-0 z-50 flex items-end pb-16"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={e => { if (e.target === e.currentTarget) setEditModal(null); }}
        >
          <div
            className="w-full rounded-t-3xl pt-6 px-6 pb-6 shadow-sm"
            style={{ background: 'var(--surface)', maxHeight: 'calc(90vh - 4rem)', overflowY: 'auto' }}
          >
            <div className="flex items-start gap-4 mb-5">
              <div className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0">
                {editModal.item.imageUrl ? (
                  <img src={editModal.item.imageUrl} className="w-full h-full object-contain p-2" alt="" style={{ background: '#F2F2F4' }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl" style={{ background: '#F2F2F4' }}>👕</div>
                )}
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(43,43,43,0.45)' }}>
                  Edit Item
                </p>
                <h3 className="font-bold capitalize" style={{ color: '#2B2B2B', letterSpacing: '-0.5px' }}>
                  {editModal.item.color} {editModal.item.subcategory}
                </h3>
              </div>
              <button onClick={() => setEditModal(null)}>
                <X size={20} style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>

            <div className="space-y-3" style={{ borderTop: '1px solid rgba(43,43,43,0.06)', paddingTop: '16px' }}>
              <FieldRow label="Subcategory">
                <input
                  value={editModal.item.subcategory}
                  onChange={e => setEditModal(m => m && ({ ...m, item: { ...m.item, subcategory: e.target.value } }))}
                  className="field-input"
                  style={fieldStyle}
                />
              </FieldRow>
              <FieldRow label="Category">
                <select
                  value={editModal.item.category}
                  onChange={e => setEditModal(m => m && ({ ...m, item: { ...m.item, category: e.target.value as WardrobeItem['category'] } }))}
                  style={fieldStyle}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none appearance-none"
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel[c]}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Colour">
                <input
                  value={editModal.item.color}
                  onChange={e => setEditModal(m => m && ({ ...m, item: { ...m.item, color: e.target.value } }))}
                  style={fieldStyle}
                  className="field-input"
                />
              </FieldRow>
              <FieldRow label="Fit">
                <input
                  value={editModal.item.fit}
                  onChange={e => setEditModal(m => m && ({ ...m, item: { ...m.item, fit: e.target.value } }))}
                  style={fieldStyle}
                  className="field-input"
                />
              </FieldRow>
              <FieldRow label="Est. value (£)">
                <input
                  type="number"
                  value={editModal.item.estimatedValue || ''}
                  onChange={e => setEditModal(m => m && ({ ...m, item: { ...m.item, estimatedValue: parseFloat(e.target.value) || 0 } }))}
                  style={fieldStyle}
                  className="field-input"
                  placeholder="0"
                />
              </FieldRow>
            </div>

            <div className="flex gap-3 mt-6" style={{ borderTop: '1px solid rgba(43,43,43,0.06)', paddingTop: '16px' }}>
              <button
                onClick={() => handleDelete(editModal.item.id)}
                className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: '#FEE2E2', color: '#DC2626' }}
              >
                <Trash2 size={18} />
              </button>
              <button
                onClick={saveEdit}
                className="flex-1 py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2"
                style={{ background: 'var(--accent)' }}
              >
                <Check size={18} /> Save changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg)',
  border: '1px solid rgba(43,43,43,0.12)',
  borderRadius: '12px',
  padding: '10px 12px',
  fontSize: '14px',
  color: 'var(--text-primary)',
  outline: 'none',
};

// ── ScrollRow — horizontal scroll with left/right arrow buttons ──────────────
function ScrollRow({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  const scroll = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.7;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  }, []);

  return (
    <div className="relative group">
      {/* Left arrow */}
      {canLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full flex items-center justify-center bg-white/90 shadow-md border border-black/5 active:scale-90 transition-transform"
          style={{ marginTop: -6 }}
        >
          <ChevronLeft size={16} color="#2B2B2B" strokeWidth={2.5} />
        </button>
      )}

      {/* Scrollable row */}
      <div
        ref={scrollRef}
        onScroll={checkScroll}
        onLoad={checkScroll}
        className="flex gap-3 overflow-x-auto pb-3 basics-scroll"
      >
        {children}
      </div>

      {/* Right arrow */}
      {canRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full flex items-center justify-center bg-white/90 shadow-md border border-black/5 active:scale-90 transition-transform"
          style={{ marginTop: -6 }}
        >
          <ChevronRight size={16} color="#2B2B2B" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

// ── BasicCard ────────────────────────────────────────────────────────────────
// Small visual card with an SVG clothing illustration, item label,
// a + button to add, and a × button in the corner to remove after adding.

function BasicCard({
  basic,
  added,
  onAdd,
  onRemove,
}: {
  basic: BasicItem;
  added: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const svgSrc = makeClothingSVG(basic.svgShape, basic.swatchColor);
  const imgSrc = basic.imageUrl || svgSrc;

  return (
    <div className="flex-shrink-0 w-[80px]">
      {/* Illustration area */}
      <div
        className="relative w-[80px] h-[100px] rounded-2xl overflow-hidden mb-1.5 active:scale-95 transition-transform"
        style={{ background: 'white', cursor: added ? 'default' : 'pointer', border: '1px solid rgba(43,43,43,0.06)' }}
        onClick={added ? undefined : onAdd}
      >
        <img
          src={imgSrc}
          className="w-full h-full object-contain p-1"
          alt={`${basic.color} ${basic.subcategory}`}
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).src = svgSrc; }}
        />

        {/* Dim overlay + ✓ badge when added */}
        {added && (
          <div
            className="absolute inset-0 flex items-end p-1.5"
            style={{ background: 'rgba(0,0,0,0.22)' }}
          >
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: 'var(--accent)' }}
            >
              <Check size={10} color="white" />
            </div>
          </div>
        )}

        {/* × remove button — top-right corner, only when added */}
        {added && (
          <button
            onClick={e => { e.stopPropagation(); onRemove(); }}
            className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.52)' }}
            aria-label="Remove"
          >
            <X size={9} color="white" />
          </button>
        )}

        {/* + button — bottom-right corner, only when not added */}
        {!added && (
          <div
            className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-white font-bold pointer-events-none"
            style={{ background: 'var(--accent)', fontSize: '14px', lineHeight: 1 }}
          >
            +
          </div>
        )}
      </div>

      {/* Label */}
      <p
        className="text-[10px] text-center capitalize leading-tight px-0.5 font-medium"
        style={{ color: '#2B2B2B' }}
      >
        {basic.color} {basic.subcategory}
      </p>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase mb-1.5" style={{ color: 'rgba(43,43,43,0.45)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
