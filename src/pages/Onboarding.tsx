import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X, CheckCircle, ArrowRight, Loader2, Shirt, Mail, Lock, User } from 'lucide-react';
import { detectClothingItems } from '../api';
import { hasClaudeKey } from '../apiHelper';
import type { RawDetection } from '../api';
import { completeOnboarding, fileToBase64, genId } from '../store';
import type { WardrobeItem, DetectedItem } from '../types';
import { cropImage } from '../utils/cropImage';
import MultiItemReview from '../components/MultiItemReview';
import { supabase, isSupabaseConfigured } from '../supabase';

type Step = 'welcome' | 'signin' | 'signup' | 'forgot' | 'name' | 'upload' | 'processing' | 'review' | 'done';

interface UploadedPhoto {
  file: File;
  previewUrl: string;
  base64?: string;
}

// Design tokens
const BROWN = '#7B5B4C';
const BROWN_DEEP = '#634A3C';
const BROWN_LIGHT = '#EDE4DD';
const CARD_SHADOW = '0 4px 20px rgba(0,0,0,0.05)';

const inputStyle: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1.5px solid rgba(43,43,43,0.08)',
  color: '#2B2B2B',
  boxShadow: CARD_SHADOW,
};

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

  // Auth state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [resetSent, setResetSent] = useState(false);

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

  // ── Auth handlers ───────────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    if (!isSupabaseConfigured) return;
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) { setAuthError(error.message); setAuthLoading(false); }
  };

  const handleSignIn = async () => {
    setAuthError('');
    if (!email || !password) { setAuthError('Please fill in all fields.'); return; }
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setAuthError(error.message); setAuthLoading(false); return; }
    setAuthLoading(false);
    // Existing user — go straight to wardrobe
    completeOnboarding(name || 'You', []);
    navigate('/wardrobe');
  };

  const handleSignUp = async () => {
    setAuthError('');
    if (!email || !password) { setAuthError('Please fill in all fields.'); return; }
    if (password.length < 6) { setAuthError('Password must be at least 6 characters.'); return; }
    setAuthLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { setAuthError(error.message); setAuthLoading(false); return; }
    if (data.user) {
      await supabase.from('profiles').insert({
        id: data.user.id,
        username: email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '_'),
        display_name: email.split('@')[0],
      }).catch(() => {});
    }
    setAuthLoading(false);
    // New user — continue to name step
    setStep('name');
  };

  const handleForgotPassword = async () => {
    setAuthError('');
    if (!email) { setAuthError('Please enter your email address.'); return; }
    setAuthLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/onboarding`,
    });
    if (error) { setAuthError(error.message); setAuthLoading(false); return; }
    setAuthLoading(false);
    setResetSent(true);
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

  // ── Google Sign In button (reusable) ────────────────────────────────────────
  const GoogleButton = ({ label = 'Continue with Google' }: { label?: string }) => (
    <button
      onClick={handleGoogleSignIn}
      disabled={authLoading}
      className="w-full py-3.5 rounded-2xl font-medium flex items-center justify-center gap-3 transition-all"
      style={{ background: '#FFFFFF', border: '1.5px solid rgba(43,43,43,0.08)', color: '#2B2B2B', boxShadow: CARD_SHADOW }}
    >
      {authLoading ? <Loader2 size={18} className="animate-spin" /> : (
        <>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {label}
        </>
      )}
    </button>
  );

  const Divider = ({ text = 'or' }: { text?: string }) => (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px" style={{ background: 'rgba(43,43,43,0.08)' }} />
      <span className="text-xs" style={{ color: 'rgba(43,43,43,0.35)' }}>{text}</span>
      <div className="flex-1 h-px" style={{ background: 'rgba(43,43,43,0.08)' }} />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F5F0EB' }}>

      {/* Header */}
      <div className="px-6 pt-14 pb-6">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-2xl flex items-center justify-center" style={{ background: BROWN, boxShadow: CARD_SHADOW }}>
            <Shirt size={16} color="#FFFFFF" />
          </div>
          <span className="text-lg" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
            anera
          </span>
        </div>
      </div>

      {/* Steps */}
      <div className="flex-1 px-6">

        {/* ── Welcome — Sign In or Create Account ── */}
        {step === 'welcome' && (
          <div className="flex flex-col justify-center min-h-[70vh]">
            <div className="mb-10">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: BROWN_DEEP }}>
                Your personal stylist for conscious fashion
              </p>
              <h1 className="text-4xl mb-4" style={{ color: '#2B2B2B', fontWeight: 700, lineHeight: '1.15', letterSpacing: '-0.5px' }}>
                Meet Anera,<br />your wardrobe<br />intelligence.
              </h1>
              <p className="text-base" style={{ color: 'rgba(43,43,43,0.5)', lineHeight: '1.6' }}>
                Upload your outfits. Anera learns your style, curates daily looks, and tells you exactly what to wear — or buy.
              </p>
            </div>

            <div className="space-y-3">
              {/* Create account — primary */}
              <button
                onClick={() => { setAuthError(''); setStep('signup'); }}
                className="w-full py-4 rounded-full font-semibold text-base flex items-center justify-center gap-2 transition-all"
                style={{ background: BROWN, color: '#FFFFFF', boxShadow: CARD_SHADOW }}
              >
                Create account <ArrowRight size={18} />
              </button>

              {/* Sign in — secondary */}
              <button
                onClick={() => { setAuthError(''); setStep('signin'); }}
                className="w-full py-4 rounded-full font-semibold text-base flex items-center justify-center gap-2 transition-all"
                style={{ background: '#FFFFFF', color: '#2B2B2B', border: '1.5px solid rgba(43,43,43,0.1)', boxShadow: CARD_SHADOW }}
              >
                I already have an account
              </button>
            </div>
          </div>
        )}

        {/* ── Sign In ── */}
        {step === 'signin' && (
          <div className="flex flex-col justify-center min-h-[70vh]">
            <h2 className="text-3xl mb-2" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
              Welcome back
            </h2>
            <p className="mb-8 text-sm" style={{ color: 'rgba(43,43,43,0.5)' }}>
              Sign in to access your wardrobe.
            </p>

            {/* Google */}
            {isSupabaseConfigured && (
              <>
                <GoogleButton label="Sign in with Google" />
                <Divider />
              </>
            )}

            {/* Email/Password */}
            <div className="space-y-3 mb-6">
              <div className="relative">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(43,43,43,0.3)' }} />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="Email address"
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm outline-none transition-all"
                  style={inputStyle}
                  onFocus={e => e.currentTarget.style.borderColor = BROWN}
                  onBlur={e => e.currentTarget.style.borderColor = 'rgba(43,43,43,0.08)'}
                />
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(43,43,43,0.3)' }} />
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm outline-none transition-all"
                  style={inputStyle}
                  onFocus={e => e.currentTarget.style.borderColor = BROWN}
                  onBlur={e => e.currentTarget.style.borderColor = 'rgba(43,43,43,0.08)'}
                  onKeyDown={e => e.key === 'Enter' && handleSignIn()}
                />
              </div>
            </div>

            {authError && (
              <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                {authError}
              </div>
            )}

            <button
              onClick={handleSignIn}
              disabled={authLoading}
              className="w-full py-4 rounded-full font-semibold text-base flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              style={{ background: BROWN, color: '#FFFFFF', boxShadow: CARD_SHADOW }}
            >
              {authLoading ? <Loader2 size={18} className="animate-spin" /> : 'Sign in'}
            </button>

            <button
              onClick={() => { setAuthError(''); setResetSent(false); setStep('forgot'); }}
              className="w-full text-sm font-medium text-center mt-4"
              style={{ color: BROWN }}
            >
              Forgot my password?
            </button>

            <p className="text-center text-sm mt-4" style={{ color: 'rgba(43,43,43,0.5)' }}>
              Don't have an account?{' '}
              <button onClick={() => { setAuthError(''); setStep('signup'); }}
                className="font-semibold" style={{ color: BROWN }}>
                Create one
              </button>
            </p>

            <button
              onClick={() => setStep('welcome')}
              className="w-full py-3 text-sm font-medium text-center mt-2"
              style={{ color: 'rgba(43,43,43,0.35)' }}
            >
              Back
            </button>
          </div>
        )}

        {/* ── Sign Up ── */}
        {step === 'signup' && (
          <div className="flex flex-col justify-center min-h-[70vh]">
            <h2 className="text-3xl mb-2" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
              Create your account
            </h2>
            <p className="mb-8 text-sm" style={{ color: 'rgba(43,43,43,0.5)' }}>
              Join Anera and start building your smart wardrobe.
            </p>

            {/* Google */}
            {isSupabaseConfigured && (
              <>
                <GoogleButton label="Sign up with Google" />
                <Divider text="or sign up with email" />
              </>
            )}

            {/* Email/Password */}
            <div className="space-y-3 mb-6">
              <div className="relative">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(43,43,43,0.3)' }} />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="Email address"
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm outline-none transition-all"
                  style={inputStyle}
                  onFocus={e => e.currentTarget.style.borderColor = BROWN}
                  onBlur={e => e.currentTarget.style.borderColor = 'rgba(43,43,43,0.08)'}
                />
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(43,43,43,0.3)' }} />
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Password (min. 6 characters)"
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm outline-none transition-all"
                  style={inputStyle}
                  onFocus={e => e.currentTarget.style.borderColor = BROWN}
                  onBlur={e => e.currentTarget.style.borderColor = 'rgba(43,43,43,0.08)'}
                  onKeyDown={e => e.key === 'Enter' && handleSignUp()}
                />
              </div>
            </div>

            {authError && (
              <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                {authError}
              </div>
            )}

            <button
              onClick={handleSignUp}
              disabled={authLoading}
              className="w-full py-4 rounded-full font-semibold text-base flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              style={{ background: BROWN, color: '#FFFFFF', boxShadow: CARD_SHADOW }}
            >
              {authLoading ? <Loader2 size={18} className="animate-spin" /> : <>Create account <ArrowRight size={18} /></>}
            </button>

            <p className="text-center text-sm mt-4" style={{ color: 'rgba(43,43,43,0.5)' }}>
              Already have an account?{' '}
              <button onClick={() => { setAuthError(''); setStep('signin'); }}
                className="font-semibold" style={{ color: BROWN }}>
                Sign in
              </button>
            </p>

            <button
              onClick={() => setStep('welcome')}
              className="w-full py-3 text-sm font-medium text-center mt-2"
              style={{ color: 'rgba(43,43,43,0.35)' }}
            >
              Back
            </button>
          </div>
        )}

        {/* ── Forgot Password ── */}
        {step === 'forgot' && (
          <div className="flex flex-col justify-center min-h-[70vh]">
            <h2 className="text-3xl mb-2" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
              Reset password
            </h2>
            <p className="mb-8 text-sm" style={{ color: 'rgba(43,43,43,0.5)' }}>
              {resetSent
                ? 'Check your inbox for a password reset link.'
                : 'Enter your email and we\'ll send you a link to reset your password.'}
            </p>

            {!resetSent ? (
              <>
                <div className="space-y-3 mb-6">
                  <div className="relative">
                    <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(43,43,43,0.3)' }} />
                    <input
                      type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="Email address"
                      autoFocus
                      className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm outline-none transition-all"
                      style={inputStyle}
                      onFocus={e => e.currentTarget.style.borderColor = BROWN}
                      onBlur={e => e.currentTarget.style.borderColor = 'rgba(43,43,43,0.08)'}
                      onKeyDown={e => e.key === 'Enter' && handleForgotPassword()}
                    />
                  </div>
                </div>

                {authError && (
                  <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                    {authError}
                  </div>
                )}

                <button
                  onClick={handleForgotPassword}
                  disabled={authLoading}
                  className="w-full py-4 rounded-full font-semibold text-base flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: BROWN, color: '#FFFFFF', boxShadow: CARD_SHADOW }}
                >
                  {authLoading ? <Loader2 size={18} className="animate-spin" /> : 'Send reset link'}
                </button>
              </>
            ) : (
              <div className="rounded-2xl px-5 py-5 mb-6" style={{ background: '#FFFFFF', boxShadow: CARD_SHADOW }}>
                <div className="flex items-center gap-3 mb-2">
                  <CheckCircle size={20} style={{ color: '#16A34A' }} />
                  <span className="font-semibold text-sm" style={{ color: '#2B2B2B' }}>Email sent</span>
                </div>
                <p className="text-sm" style={{ color: 'rgba(43,43,43,0.5)', lineHeight: '1.6' }}>
                  We've sent a password reset link to <strong style={{ color: '#2B2B2B' }}>{email}</strong>. It may take a minute to arrive — check your spam folder if needed.
                </p>
              </div>
            )}

            <button
              onClick={() => { setAuthError(''); setStep('signin'); }}
              className="w-full py-3 text-sm font-medium text-center mt-2"
              style={{ color: 'rgba(43,43,43,0.35)' }}
            >
              Back to sign in
            </button>
          </div>
        )}

        {/* ── Name ── */}
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
            <div className="relative mb-6">
              <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(43,43,43,0.3)' }} />
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Sarah"
                autoFocus
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-base outline-none transition-all"
                style={inputStyle}
                onFocus={e => e.currentTarget.style.borderColor = BROWN}
                onBlur={e => e.currentTarget.style.borderColor = 'rgba(43,43,43,0.08)'}
                onKeyDown={e => e.key === 'Enter' && name.trim() && setStep('upload')}
              />
            </div>
            <button
              onClick={() => setStep('upload')}
              disabled={!name.trim()}
              className="w-full py-4 rounded-full font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              style={{ background: BROWN, color: '#FFFFFF', boxShadow: CARD_SHADOW }}
            >
              Continue <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* ── Upload ── */}
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
                (e.currentTarget as HTMLElement).style.borderColor = BROWN;
                (e.currentTarget as HTMLElement).style.background = BROWN_LIGHT;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(43,43,43,0.12)';
                (e.currentTarget as HTMLElement).style.background = '#FFFFFF';
              }}
              className="w-full rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer mb-5 transition-all"
              style={{ border: `1.5px dashed rgba(43,43,43,0.12)`, background: '#FFFFFF', padding: '40px 20px', boxShadow: CARD_SHADOW }}
            >
              <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: BROWN_LIGHT }}>
                <Upload size={22} style={{ color: BROWN_DEEP }} />
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
              style={{ background: BROWN, color: '#FFFFFF', boxShadow: CARD_SHADOW }}
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

        {/* ── Processing ── */}
        {step === 'processing' && (
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: BROWN_LIGHT, boxShadow: CARD_SHADOW }}>
              <Loader2 size={32} style={{ color: BROWN_DEEP }} className="animate-spin" />
            </div>
            <h2 className="text-2xl mb-3" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
              Scanning your wardrobe...
            </h2>
            <p className="text-sm" style={{ color: 'rgba(43,43,43,0.5)' }}>
              {progressMsg || 'Detecting clothing items...'}
            </p>
          </div>
        )}

        {/* ── Done ── */}
        {step === 'done' && (
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: BROWN_LIGHT, boxShadow: CARD_SHADOW }}>
              <CheckCircle size={32} style={{ color: BROWN_DEEP }} />
            </div>
            <h2 className="text-3xl mb-3" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
              Wardrobe ready!<br />
              <span style={{ color: BROWN_DEEP }}>{savedCount} item{savedCount !== 1 ? 's' : ''}</span> added
            </h2>
            <p className="text-sm mb-10" style={{ color: 'rgba(43,43,43,0.5)' }}>
              Let's start styling, {name}.
            </p>
            <button
              onClick={() => navigate('/wardrobe')}
              className="px-8 py-4 rounded-full font-semibold text-base flex items-center gap-2 transition-all"
              style={{ background: BROWN, color: '#FFFFFF', boxShadow: CARD_SHADOW }}
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
