import { useState, useEffect } from 'react';
import {
  X, UserPlus, Settings, HelpCircle, Star,
  Share2, LogOut, ChevronRight, Mail, Phone,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../supabase';
import { loadUser } from '../store';

interface ProfileDrawerProps {
  open: boolean;
  onClose: () => void;
}

interface ProfileInfo {
  displayName: string;
  username: string;
  email: string;
  phone: string;
  avatarUrl: string | null;
  followers: number;
  following: number;
}

export default function ProfileDrawer({ open, onClose }: ProfileDrawerProps) {
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    loadProfile();
  }, [open]);

  const loadProfile = async () => {
    setLoading(true);
    const localUser = loadUser();

    // Try to get Supabase session for richer data
    if (isSupabaseConfigured) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const userId = session.user.id;
          const { data: prof } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

          // Count followers / following
          const { count: followersCount } = await supabase
            .from('follows')
            .select('*', { count: 'exact', head: true })
            .eq('following_id', userId);
          const { count: followingCount } = await supabase
            .from('follows')
            .select('*', { count: 'exact', head: true })
            .eq('follower_id', userId);

          setProfile({
            displayName: prof?.display_name || localUser.name || 'User',
            username: prof?.username || localUser.name?.toLowerCase().replace(/\s+/g, '') || 'user',
            email: session.user.email || '',
            phone: session.user.phone || '',
            avatarUrl: prof?.avatar_url || null,
            followers: followersCount ?? 0,
            following: followingCount ?? 0,
          });
          setLoading(false);
          return;
        }
      } catch {
        // Fall through to local-only
      }
    }

    // Fallback: local user only
    setProfile({
      displayName: localUser.name || 'User',
      username: localUser.name?.toLowerCase().replace(/\s+/g, '_') || 'user',
      email: '',
      phone: '',
      avatarUrl: null,
      followers: 0,
      following: 0,
    });
    setLoading(false);
  };

  const handleLogout = async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem('anera_user');
    window.location.href = '/onboarding';
  };

  const handleShare = async () => {
    const url = window.location.origin;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Anera', text: 'Check out my wardrobe on Anera!', url });
      } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
      alert('Profile link copied!');
    }
  };

  if (!open) return null;

  const initials = profile?.displayName
    ? profile.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <div
      className="fixed inset-0 z-[100] flex"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Drawer panel — slides in from left */}
      <div
        className="w-[82%] max-w-sm h-full flex flex-col animate-slideIn"
        style={{ background: '#F5F0EB' }}
      >
        {/* Close button */}
        <div className="flex justify-end p-4">
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.05)' }}
          >
            <X size={16} color="#666" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : profile && (
          <>
            {/* Profile header */}
            <div className="px-6 pb-5">
              <div className="flex items-center gap-4">
                {/* Avatar with progress ring */}
                <div className="relative">
                  <svg width="68" height="68" viewBox="0 0 68 68">
                    {/* Background track */}
                    <circle cx="34" cy="34" r="30" fill="none" stroke="#E5E7EB" strokeWidth="3" />
                    {/* Progress arc */}
                    <circle
                      cx="34" cy="34" r="30" fill="none"
                      stroke="#5C3D2E" strokeWidth="3" strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 30}`}
                      strokeDashoffset={`${2 * Math.PI * 30 * 0.85}`}
                      transform="rotate(-90 34 34)"
                    />
                  </svg>
                  <div
                    className="absolute inset-0 m-auto w-[52px] h-[52px] rounded-full flex items-center justify-center text-lg font-bold"
                    style={{
                      background: profile.avatarUrl ? `url(${profile.avatarUrl}) center/cover` : '#7B5B4C',
                      color: profile.avatarUrl ? 'transparent' : '#4A3125',
                    }}
                  >
                    {!profile.avatarUrl && initials}
                  </div>
                  <span
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: '#5C3D2E', color: 'white' }}
                  >
                    15%
                  </span>
                </div>

                {/* Name + handle */}
                <div>
                  <h2 className="text-lg font-bold" style={{ color: '#1A1A1A' }}>
                    {profile.displayName}
                  </h2>
                  <p className="text-sm" style={{ color: 'rgba(43,43,43,0.5)' }}>
                    @{profile.username}
                  </p>
                  <div className="flex gap-4 mt-1.5">
                    <span className="text-sm" style={{ color: '#1A1A1A' }}>
                      <strong>{profile.following}</strong>{' '}
                      <span style={{ color: 'rgba(43,43,43,0.5)' }}>Following</span>
                    </span>
                    <span className="text-sm" style={{ color: '#1A1A1A' }}>
                      <strong>{profile.followers}</strong>{' '}
                      <span style={{ color: 'rgba(43,43,43,0.5)' }}>Followers</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="mx-6 h-px" style={{ background: 'rgba(0,0,0,0.06)' }} />

            {/* Menu items */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <MenuItem icon={UserPlus} label="Invite friends" onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: 'Join Anera', text: 'Join me on Anera — the AI wardrobe stylist!', url: window.location.origin });
                } else {
                  navigator.clipboard.writeText(window.location.origin);
                  alert('Invite link copied!');
                }
              }} />
              <MenuItem icon={Settings} label="Privacy & settings" expandable onClick={() => {}}>
                <div className="px-12 pb-3 space-y-2">
                  {profile.email && (
                    <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(43,43,43,0.6)' }}>
                      <Mail size={14} />
                      <span>{profile.email}</span>
                    </div>
                  )}
                  {profile.phone && (
                    <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(43,43,43,0.6)' }}>
                      <Phone size={14} />
                      <span>{profile.phone}</span>
                    </div>
                  )}
                  {!profile.email && !profile.phone && (
                    <p className="text-xs" style={{ color: 'rgba(43,43,43,0.4)' }}>
                      No account linked yet. Sign up in Community to link your email.
                    </p>
                  )}
                </div>
              </MenuItem>
              <MenuItem icon={HelpCircle} label="Help" onClick={() => {
                window.open('mailto:support@anera.app', '_blank');
              }} />
              <MenuItem icon={Star} label="Rate Anera" onClick={() => {
                alert('Thank you for your support! Rating will be available on app stores soon.');
              }} />
            </div>

            {/* Bottom actions */}
            <div className="px-2 pb-6 space-y-1" style={{ borderTop: '1px solid rgba(0,0,0,0.04)' }}>
              <div className="pt-2" />
              <MenuItem icon={Share2} label="Share profile" onClick={handleShare} />
              <MenuItem icon={LogOut} label="Logout" onClick={handleLogout} danger />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Reusable menu row ── */
function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  expandable,
  children,
}: {
  icon: React.ComponentType<any>;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  expandable?: boolean;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = danger ? '#DC2626' : '#2B2B2B';

  return (
    <>
      <button
        onClick={() => {
          if (expandable) setExpanded(v => !v);
          else onClick?.();
        }}
        className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl hover:bg-black/[0.03] transition-colors"
      >
        <Icon size={20} color={color} strokeWidth={1.7} />
        <span className="flex-1 text-left text-[15px] font-medium" style={{ color }}>
          {label}
        </span>
        {expandable && (
          <ChevronRight
            size={16}
            color="rgba(43,43,43,0.3)"
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </button>
      {expandable && expanded && children}
    </>
  );
}
