import { useState } from 'react';
import { X, Loader2, Shirt, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { supabase } from '../supabase';

interface AuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

// ── Brand list ─────────────────────────────────────────────────────────────
const BRANDS = [
  // Luxury
  'Gucci','Louis Vuitton','Prada','Chanel','Dior','Hermès','Versace','Balenciaga',
  'Valentino','Burberry','Givenchy','Bottega Veneta','Saint Laurent','Celine','Loewe',
  // Contemporary
  'Zara','H&M','ASOS','Mango','& Other Stories','COS','Massimo Dutti','Arket',
  'Uniqlo','Monki','Weekday','Pull&Bear','Stradivarius',
  // Premium
  'Reiss','Ted Baker','Ralph Lauren','Tommy Hilfiger','Calvin Klein','Lacoste',
  'Hugo Boss','Michael Kors','Kate Spade','Coach','Tory Burch','Sandro','Maje',
  // Streetwear
  'Nike','Adidas','New Balance','Jordan','Off-White','Stone Island','Carhartt',
  'Supreme','Stüssy','Palace','A-COLD-WALL*','Fear of God',
  // Sustainable/Indie
  'Reformation','Everlane','Patagonia','Veja','Sézane','Ganni','Rotate','Stine Goya',
];

const HOW_HEARD = [
  'Instagram','TikTok','Facebook','Friend / family','Google search',
  'YouTube','Pinterest','Word of mouth','Other',
];

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
};

type Mode = 'choose' | 'signin' | 'signup' | 'profile';

interface SignupData {
  email: string;
  password: string;
  username: string;
  instagram: string;
  tiktok: string;
  facebook: string;
}

interface ProfileData {
  firstName: string;
  lastName: string;
  city: string;
  occupation: string;
  age: string;
  gender: 'menswear' | 'womenswear' | 'both' | '';
  howHeard: string;
  brands: string[];
}

export default function AuthModal({ onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<Mode>('choose');
  const [profileStep, setProfileStep] = useState(0); // 0-2
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [signup, setSignup] = useState<SignupData>({
    email: '', password: '', username: '', instagram: '', tiktok: '', facebook: '',
  });

  const [profile, setProfile] = useState<ProfileData>({
    firstName: '', lastName: '', city: '', occupation: '',
    age: '', gender: '', howHeard: '', brands: [],
  });

  const stripAt = (v: string) => v.replace(/^@/, '').trim();
  const set = (field: keyof SignupData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSignup(p => ({ ...p, [field]: e.target.value }));
  const setP = (field: keyof ProfileData, value: any) =>
    setProfile(p => ({ ...p, [field]: value }));

  // ── Google OAuth ──────────────────────────────────────────────────────────
  const handleGoogle = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) { setError(error.message); setLoading(false); }
    // Page will redirect — profile questionnaire shown on return via separate check
  };

  // ── Email Sign-In ─────────────────────────────────────────────────────────
  const handleSignIn = async () => {
    setError('');
    if (!signup.email || !signup.password) { setError('Please fill in all fields.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: signup.email, password: signup.password });
    if (error) { setError(error.message); setLoading(false); return; }
    setLoading(false);
    onSuccess();
  };

  // ── Email Sign-Up (step 1) ────────────────────────────────────────────────
  const handleSignUp = async () => {
    setError('');
    if (!signup.email || !signup.password || !signup.username.trim()) {
      setError('Please fill in all required fields.'); return;
    }
    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email: signup.email, password: signup.password });
    if (signUpError) { setError(signUpError.message); setLoading(false); return; }
    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,
        username: signup.username.toLowerCase().replace(/\s+/g, '_'),
        display_name: signup.username,
        instagram_handle: stripAt(signup.instagram) || null,
        tiktok_handle: stripAt(signup.tiktok) || null,
        facebook_handle: stripAt(signup.facebook) || null,
      });
      if (profileError && profileError.code !== '23505') {
        setError(profileError.message); setLoading(false); return;
      }
      setUserId(data.user.id);
    }
    setLoading(false);
    setMode('profile');
    setProfileStep(0);
  };

  // ── Save profile (after signup) ───────────────────────────────────────────
  const saveProfile = async () => {
    if (profile.brands.length < 3) { setError('Please choose at least 3 brands.'); return; }
    setError('');
    setLoading(true);
    const uid = userId ?? (await supabase.auth.getUser()).data.user?.id;
    if (uid) {
      await supabase.from('profiles').update({
        first_name: profile.firstName || null,
        last_name: profile.lastName || null,
        city: profile.city || null,
        occupation: profile.occupation || null,
        age: profile.age ? parseInt(profile.age) : null,
        gender: profile.gender || null,
        how_heard: profile.howHeard || null,
        brand_preferences: profile.brands,
        display_name: `${profile.firstName} ${profile.lastName}`.trim() || undefined,
        profile_complete: true,
      }).eq('id', uid);
    }
    setLoading(false);
    onSuccess();
  };

  const toggleBrand = (brand: string) => {
    setP('brands', profile.brands.includes(brand)
      ? profile.brands.filter(b => b !== brand)
      : [...profile.brands, brand]);
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full rounded-t-3xl px-6 py-8"
        style={{ background: 'var(--surface)', maxHeight: '93vh', overflowY: 'auto' }}>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            {(mode === 'signin' || mode === 'signup') && (
              <button onClick={() => { setMode('choose'); setError(''); }} className="mr-1">
                <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
              </button>
            )}
            {mode === 'profile' && profileStep > 0 && (
              <button onClick={() => setProfileStep(s => s - 1)} className="mr-1">
                <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
              </button>
            )}
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <Shirt size={14} color="white" />
            </div>
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              {mode === 'choose' ? 'Join Anera' :
               mode === 'signin' ? 'Sign in' :
               mode === 'signup' ? 'Create account' :
               `Tell us about you (${profileStep + 1}/3)`}
            </span>
          </div>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-secondary)' }} /></button>
        </div>

        {/* Progress bar for profile steps */}
        {mode === 'profile' && (
          <div className="flex gap-1.5 mb-6">
            {[0,1,2].map(i => (
              <div key={i} className="flex-1 h-1 rounded-full transition-all"
                style={{ background: i <= profileStep ? 'var(--accent)' : 'var(--border)' }} />
            ))}
          </div>
        )}

        {/* ── Choose mode ── */}
        {mode === 'choose' && (
          <div className="space-y-3">
            <button onClick={handleGoogle} disabled={loading}
              className="w-full py-4 rounded-2xl font-medium flex items-center justify-center gap-3 border"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : (
                <>
                  <svg width="18" height="18" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                  Continue with Google
                </>
              )}
            </button>

            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>or</span>
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            </div>

            <button onClick={() => setMode('signup')}
              className="w-full py-4 rounded-2xl font-medium text-white"
              style={{ background: 'var(--accent)' }}>
              Sign up with email
            </button>
            <button onClick={() => setMode('signin')}
              className="w-full py-3 rounded-2xl font-medium text-sm"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              Sign in
            </button>
          </div>
        )}

        {/* ── Sign In ── */}
        {mode === 'signin' && (
          <div className="space-y-3">
            <Field label="Email">
              <input type="email" value={signup.email} onChange={set('email')}
                placeholder="you@example.com" style={inputStyle}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none" />
            </Field>
            <Field label="Password">
              <input type="password" value={signup.password} onChange={set('password')}
                placeholder="••••••••" style={inputStyle}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                onKeyDown={e => e.key === 'Enter' && handleSignIn()} />
            </Field>
            {error && <ErrorBox msg={error} />}
            <button onClick={handleSignIn} disabled={loading}
              className="w-full py-4 rounded-2xl font-medium text-white flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)' }}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : 'Sign in'}
            </button>
            <p className="text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              No account?{' '}
              <button onClick={() => { setMode('signup'); setError(''); }}
                className="font-medium" style={{ color: 'var(--accent)' }}>Sign up</button>
            </p>
          </div>
        )}

        {/* ── Sign Up ── */}
        {mode === 'signup' && (
          <div className="space-y-3">
            <Field label="Username *">
              <input value={signup.username} onChange={set('username')}
                placeholder="e.g. stylequeen" style={inputStyle}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none" />
            </Field>
            <Field label="Email *">
              <input type="email" value={signup.email} onChange={set('email')}
                placeholder="you@example.com" style={inputStyle}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none" />
            </Field>
            <Field label="Password *">
              <input type="password" value={signup.password} onChange={set('password')}
                placeholder="Min. 6 characters" style={inputStyle}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none" />
            </Field>

            <p className="text-xs font-medium pt-1" style={{ color: 'var(--text-secondary)' }}>
              Social handles <span className="font-normal">(optional)</span>
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: '📸 Instagram', field: 'instagram' as const },
                { label: '🎵 TikTok', field: 'tiktok' as const },
                { label: '👤 Facebook', field: 'facebook' as const },
              ].map(({ label, field }) => (
                <Field key={field} label={label}>
                  <input value={signup[field]} onChange={set(field)}
                    placeholder="@handle" style={inputStyle}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" />
                </Field>
              ))}
            </div>

            {error && <ErrorBox msg={error} />}
            <button onClick={handleSignUp} disabled={loading}
              className="w-full py-4 rounded-2xl font-medium text-white flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)' }}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
            </button>
          </div>
        )}

        {/* ── Profile Questions ── */}
        {mode === 'profile' && profileStep === 0 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-light mb-1" style={{ color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>
                What's your name?
              </h2>
              <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
                Help us personalise your experience.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <input value={profile.firstName} onChange={e => setP('firstName', e.target.value)}
                  placeholder="Amara" style={inputStyle}
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none" />
              </Field>
              <Field label="Last name">
                <input value={profile.lastName} onChange={e => setP('lastName', e.target.value)}
                  placeholder="Johnson" style={inputStyle}
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Age">
                <input type="number" min="13" max="99" value={profile.age}
                  onChange={e => setP('age', e.target.value)}
                  placeholder="e.g. 28" style={inputStyle}
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none" />
              </Field>
              <Field label="What do you wear?">
                <select value={profile.gender} onChange={e => setP('gender', e.target.value)}
                  style={{ ...inputStyle, width: '100%', padding: '12px', borderRadius: '12px', fontSize: '14px', outline: 'none' }}>
                  <option value="">Select…</option>
                  <option value="womenswear">Womenswear</option>
                  <option value="menswear">Menswear</option>
                  <option value="both">Both</option>
                </select>
              </Field>
            </div>
            <Field label="What do you do for work?">
              <input value={profile.occupation} onChange={e => setP('occupation', e.target.value)}
                placeholder="e.g. Marketing Manager, Student, Designer…" style={inputStyle}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none" />
            </Field>

            {/* City with disclaimer */}
            <div>
              <Field label="Your city">
                <input value={profile.city} onChange={e => setP('city', e.target.value)}
                  placeholder="e.g. London, New York, Lagos…" style={inputStyle}
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none" />
              </Field>
              <div className="mt-2 px-3 py-2 rounded-xl flex gap-2 items-start"
                style={{ background: 'var(--accent-light)' }}>
                <span className="text-sm flex-shrink-0">☂️</span>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--accent-dark)' }}>
                  <strong>Why we ask:</strong> Anera uses your city only to fetch live weather and suggest weather-appropriate outfits. If rain is forecast, we'll remind you to grab an umbrella. Your location is never shared or stored beyond your profile.
                </p>
              </div>
            </div>

            {error && <ErrorBox msg={error} />}
            <button onClick={() => { setError(''); setProfileStep(1); }}
              className="w-full py-4 rounded-2xl font-medium text-white flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)' }}>
              Next <ArrowRight size={16} />
            </button>
          </div>
        )}

        {mode === 'profile' && profileStep === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-light mb-1" style={{ color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>
                How did you find us?
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {HOW_HEARD.map(opt => (
                <button key={opt} onClick={() => setP('howHeard', opt)}
                  className="px-4 py-2.5 rounded-full text-sm font-medium transition-all"
                  style={{
                    background: profile.howHeard === opt ? 'var(--accent)' : 'var(--bg)',
                    color: profile.howHeard === opt ? 'white' : 'var(--text-secondary)',
                    border: `1px solid ${profile.howHeard === opt ? 'var(--accent)' : 'var(--border)'}`,
                  }}>
                  {opt}
                </button>
              ))}
            </div>
            {error && <ErrorBox msg={error} />}
            <button onClick={() => { setError(''); setProfileStep(2); }}
              className="w-full py-4 rounded-2xl font-medium text-white flex items-center justify-center gap-2 mt-4"
              style={{ background: 'var(--accent)' }}>
              Next <ArrowRight size={16} />
            </button>
          </div>
        )}

        {mode === 'profile' && profileStep === 2 && (
          <div>
            <div className="mb-4">
              <h2 className="text-xl font-light mb-1" style={{ color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>
                Which brands are you into?
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Choose <strong>3 or more</strong> that you own or love — helps Anera understand your style.
                {profile.brands.length > 0 && (
                  <span style={{ color: 'var(--accent)' }}> {profile.brands.length} selected</span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 mb-6">
              {BRANDS.map(brand => {
                const selected = profile.brands.includes(brand);
                return (
                  <button key={brand} onClick={() => toggleBrand(brand)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1"
                    style={{
                      background: selected ? 'var(--accent)' : 'var(--bg)',
                      color: selected ? 'white' : 'var(--text-secondary)',
                      border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                    }}>
                    {selected && <Check size={11} />}
                    {brand}
                  </button>
                );
              })}
            </div>
            {error && <ErrorBox msg={error} />}
            <button onClick={saveProfile} disabled={loading || profile.brands.length < 3}
              className="w-full py-4 rounded-2xl font-medium text-white flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: 'var(--accent)' }}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : <>Let's go! 🎉</>}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#FEE2E2', color: '#DC2626' }}>{msg}</div>
  );
}
