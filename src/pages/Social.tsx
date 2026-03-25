import { useState, useEffect, useRef } from 'react';
import { Heart, MessageCircle, Plus, X, Loader2, Send, Video, Image } from 'lucide-react';
import { supabase } from '../supabase';
import type { OotdPost, PostComment } from '../supabase';
import AuthModal from './AuthModal';

// Social handle configs
const HANDLES = [
  { key: 'instagram_handle', label: '📸', baseUrl: 'https://instagram.com/' },
  { key: 'tiktok_handle',   label: '🎵', baseUrl: 'https://tiktok.com/@' },
  { key: 'facebook_handle', label: '👤', baseUrl: 'https://facebook.com/' },
] as const;

export default function Social() {
  const [session, setSession] = useState<any>(null);
  const [posts, setPosts] = useState<OotdPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [showNewPost, setShowNewPost] = useState(false);
  const [openComments, setOpenComments] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    fetchPosts();
    return () => subscription.unsubscribe();
  }, []);

  const fetchPosts = async () => {
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;

    const { data } = await supabase
      .from('ootd_posts')
      .select(`*, profiles(id, username, display_name, avatar_url, instagram_handle, tiktok_handle, facebook_handle)`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!data) { setLoading(false); return; }

    const postsWithMeta = await Promise.all(data.map(async post => {
      const { count: likesCount } = await supabase
        .from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', post.id);
      const { count: commentsCount } = await supabase
        .from('post_comments').select('*', { count: 'exact', head: true }).eq('post_id', post.id);
      let userHasLiked = false;
      if (userId) {
        const { data: likeData } = await supabase
          .from('post_likes').select('id').eq('post_id', post.id).eq('user_id', userId).maybeSingle();
        userHasLiked = !!likeData;
      }
      return { ...post, likes_count: likesCount ?? 0, comments_count: commentsCount ?? 0, user_has_liked: userHasLiked };
    }));

    setPosts(postsWithMeta);
    setLoading(false);
  };

  const toggleLike = async (post: OotdPost) => {
    if (!session) { setShowAuth(true); return; }
    const userId = session.user.id;
    if (post.user_has_liked) {
      await supabase.from('post_likes').delete().eq('post_id', post.id).eq('user_id', userId);
      setPosts(prev => prev.map(p => p.id === post.id
        ? { ...p, likes_count: (p.likes_count ?? 1) - 1, user_has_liked: false } : p));
    } else {
      await supabase.from('post_likes').insert({ post_id: post.id, user_id: userId });
      setPosts(prev => prev.map(p => p.id === post.id
        ? { ...p, likes_count: (p.likes_count ?? 0) + 1, user_has_liked: true } : p));
    }
  };

  const sharePost = (post: OotdPost) => {
    if (navigator.share) {
      navigator.share({ url: post.image_url, title: post.caption ?? 'My OOTD on Anera' }).catch(() => {});
    }
  };

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>Community</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>OOTDs from the Anera community</p>
        </div>
        {session ? (
          <button onClick={() => setShowNewPost(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'var(--accent)', color: 'white' }}>
            <Plus size={18} />
          </button>
        ) : (
          <button onClick={() => setShowAuth(true)}
            className="px-4 py-2 rounded-full text-xs font-medium text-white"
            style={{ background: 'var(--accent)' }}>
            Sign in
          </button>
        )}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-6">
          <div className="text-5xl mb-4">👗</div>
          <p className="font-semibold text-base mb-1" style={{ color: 'var(--text-primary)' }}>No OOTDs yet</p>
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>Be the first to share your outfit of the day!</p>
          <button onClick={() => session ? setShowNewPost(true) : setShowAuth(true)}
            className="px-6 py-3 rounded-2xl text-sm font-medium text-white"
            style={{ background: 'var(--accent)' }}>
            Post your OOTD
          </button>
        </div>
      ) : (
        <div>
          {posts.map(post => (
            <PostCard key={post.id} post={post}
              onLike={() => toggleLike(post)}
              onComment={() => setOpenComments(post.id)}
              onShare={() => sharePost(post)}
            />
          ))}
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onSuccess={() => { setShowAuth(false); fetchPosts(); }} />}
      {showNewPost && <NewPostModal userId={session?.user.id} onClose={() => setShowNewPost(false)} onPosted={() => { setShowNewPost(false); fetchPosts(); }} />}
      {openComments && (
        <CommentsModal postId={openComments} currentUserId={session?.user.id}
          onClose={() => { setOpenComments(null); fetchPosts(); }}
          onAuthRequired={() => setShowAuth(true)} />
      )}
    </div>
  );
}

// ── Post Card ──────────────────────────────────────────────────────────────
function PostCard({ post, onLike, onComment, onShare }: {
  post: OotdPost; onLike: () => void; onComment: () => void; onShare: () => void;
}) {
  const profile = post.profiles;
  const isVideo = post.media_type === 'video';

  // Social handle links for this post's author
  const socialLinks = HANDLES
    .map(h => ({ ...h, handle: profile?.[h.key] }))
    .filter(h => h.handle);

  return (
    <div className="mb-0.5" style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Author row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-semibold"
          style={{ background: 'var(--accent)' }}>
          {profile?.display_name?.[0]?.toUpperCase() ?? profile?.username?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            {profile?.display_name ?? profile?.username ?? 'Anonymous'}
          </p>
          {post.occasion && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{post.occasion}</p>}
        </div>
        {/* Social handle badges */}
        {socialLinks.length > 0 && (
          <div className="flex gap-1.5">
            {socialLinks.map(({ key, label, baseUrl, handle }) => (
              <a key={key} href={`${baseUrl}${handle}`} target="_blank" rel="noopener noreferrer"
                className="w-7 h-7 rounded-full flex items-center justify-center text-sm"
                style={{ background: 'var(--accent-light)' }}
                title={`@${handle}`}>
                {label}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Media — image or video */}
      <div className="w-full overflow-hidden" style={{ background: '#000', aspectRatio: isVideo ? '9/16' : '1/1', maxHeight: isVideo ? '75vh' : undefined }}>
        {isVideo ? (
          <video
            src={post.image_url}
            controls
            playsInline
            loop
            className="w-full h-full object-contain"
            style={{ display: 'block' }}
          />
        ) : (
          <img src={post.image_url} className="w-full h-full object-cover" alt="OOTD" />
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-4 mb-2">
          <button onClick={onLike} className="flex items-center gap-1.5 transition-transform active:scale-90">
            <Heart size={22} fill={post.user_has_liked ? '#E84393' : 'none'}
              stroke={post.user_has_liked ? '#E84393' : 'var(--text-primary)'} strokeWidth={1.8} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{post.likes_count ?? 0}</span>
          </button>
          <button onClick={onComment} className="flex items-center gap-1.5">
            <MessageCircle size={22} strokeWidth={1.8} style={{ color: 'var(--text-primary)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{post.comments_count ?? 0}</span>
          </button>
          {typeof navigator.share === 'function' && (
            <button onClick={onShare} className="ml-auto px-3 py-1.5 rounded-full text-xs font-medium"
              style={{ background: 'var(--accent-light)', color: 'var(--accent-dark)' }}>
              Share
            </button>
          )}
        </div>
        {post.caption && (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            <span className="font-semibold">{profile?.username ?? 'anon'}</span>{' '}{post.caption}
          </p>
        )}
        {post.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {post.tags.map(tag => <span key={tag} className="text-xs" style={{ color: 'var(--accent)' }}>#{tag}</span>)}
          </div>
        )}
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>{formatTimeAgo(post.created_at)}</p>
      </div>
    </div>
  );
}

// ── New Post Modal ─────────────────────────────────────────────────────────
function NewPostModal({ userId, onClose, onPosted }: {
  userId: string; onClose: () => void; onPosted: () => void;
}) {
  const [media, setMedia] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [caption, setCaption] = useState('');
  const [occasion, setOccasion] = useState('');
  const [tags, setTags] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [acceptType, setAcceptType] = useState('image/*,video/*');

  const pickMedia = (file: File) => {
    const isVid = file.type.startsWith('video/');
    setMedia(file);
    setMediaType(isVid ? 'video' : 'image');
    setPreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    if (!media) { setError('Please pick a photo or video.'); return; }
    setError('');
    setLoading(true);

    const ext = media.name.split('.').pop();
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('ootd-images').upload(path, media);
    if (uploadError) { setError(uploadError.message); setLoading(false); return; }

    const { data: urlData } = supabase.storage.from('ootd-images').getPublicUrl(path);
    const tagList = tags.split(',').map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);

    const { error: insertError } = await supabase.from('ootd_posts').insert({
      user_id: userId,
      image_url: urlData.publicUrl,
      media_type: mediaType,
      caption: caption.trim() || null,
      occasion: occasion.trim() || null,
      tags: tagList,
    });

    if (insertError) { setError(insertError.message); setLoading(false); return; }
    setLoading(false);
    onPosted();
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-primary)',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full rounded-t-3xl px-5 py-6" style={{ background: 'var(--surface)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>New OOTD Post</h2>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-secondary)' }} /></button>
        </div>

        {/* Media type toggle */}
        <div className="flex gap-2 mb-4">
          {(['image', 'video'] as const).map(type => (
            <button key={type} onClick={() => { setAcceptType(type === 'image' ? 'image/*' : 'video/*'); }}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium"
              style={{
                background: mediaType === type ? 'var(--accent)' : 'var(--bg)',
                color: mediaType === type ? 'white' : 'var(--text-secondary)',
                border: `1px solid ${mediaType === type ? 'var(--accent)' : 'var(--border)'}`,
              }}>
              {type === 'image' ? <Image size={15} /> : <Video size={15} />}
              {type === 'image' ? 'Photo' : 'Video'}
            </button>
          ))}
        </div>

        {/* Media picker */}
        <div onClick={() => fileRef.current?.click()}
          className="w-full rounded-2xl overflow-hidden cursor-pointer mb-4 flex items-center justify-center"
          style={{ background: preview ? '#000' : 'var(--bg)', border: preview ? 'none' : '1.5px dashed var(--border)', minHeight: '200px' }}>
          {preview ? (
            mediaType === 'video'
              ? <video src={preview} className="w-full max-h-72 object-contain" controls={false} muted playsInline />
              : <img src={preview} className="w-full max-h-72 object-cover rounded-2xl" alt="Preview" />
          ) : (
            <div className="flex flex-col items-center gap-2 py-10">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-light)' }}>
                {acceptType.startsWith('video') ? <Video size={22} style={{ color: 'var(--accent)' }} /> : <Image size={22} style={{ color: 'var(--accent)' }} />}
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {acceptType.startsWith('video') ? 'Add your OOTD video' : 'Add your OOTD photo'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {acceptType.startsWith('video') ? 'MP4, MOV — up to 50MB' : 'JPEG, PNG, HEIC'}
              </p>
            </div>
          )}
          <input ref={fileRef} type="file" accept={acceptType} className="hidden"
            onChange={e => e.target.files?.[0] && pickMedia(e.target.files[0])} />
        </div>

        <div className="space-y-3 mb-5">
          <textarea value={caption} onChange={e => setCaption(e.target.value)}
            placeholder="Write a caption…" rows={2}
            className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
            style={inputStyle} />
          <input value={occasion} onChange={e => setOccasion(e.target.value)}
            placeholder="Occasion (e.g. Work, Dinner, Weekend)"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none" style={inputStyle} />
          <input value={tags} onChange={e => setTags(e.target.value)}
            placeholder="Tags: minimal, streetwear, boho (comma separated)"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none" style={inputStyle} />
        </div>

        {error && <div className="rounded-xl px-4 py-3 mb-3 text-sm" style={{ background: '#FEE2E2', color: '#DC2626' }}>{error}</div>}

        <button onClick={submit} disabled={loading || !media}
          className="w-full py-4 rounded-2xl font-medium text-white flex items-center justify-center gap-2 disabled:opacity-40"
          style={{ background: 'var(--accent)' }}>
          {loading ? <Loader2 size={18} className="animate-spin" /> : <><Send size={16} /> Post OOTD</>}
        </button>
      </div>
    </div>
  );
}

// ── Comments Modal ─────────────────────────────────────────────────────────
function CommentsModal({ postId, currentUserId, onClose, onAuthRequired }: {
  postId: string; currentUserId?: string; onClose: () => void; onAuthRequired: () => void;
}) {
  const [comments, setComments] = useState<PostComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchComments(); }, []);

  const fetchComments = async () => {
    const { data } = await supabase
      .from('post_comments')
      .select('*, profiles(id, username, display_name, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (data) setComments(data);
  };

  const addComment = async () => {
    if (!currentUserId) { onAuthRequired(); return; }
    if (!newComment.trim()) return;
    setLoading(true);
    await supabase.from('post_comments').insert({ post_id: postId, user_id: currentUserId, content: newComment.trim() });
    setNewComment('');
    await fetchComments();
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full rounded-t-3xl" style={{ background: 'var(--surface)', maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Comments</h2>
          <button onClick={onClose}><X size={18} style={{ color: 'var(--text-secondary)' }} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {comments.length === 0 && (
            <p className="text-center text-sm py-8" style={{ color: 'var(--text-secondary)' }}>No comments yet. Be the first!</p>
          )}
          {comments.map(c => (
            <div key={c.id} className="flex gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                style={{ background: 'var(--accent)' }}>
                {c.profiles?.display_name?.[0]?.toUpperCase() ?? c.profiles?.username?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div>
                <span className="text-xs font-semibold mr-1.5" style={{ color: 'var(--text-primary)' }}>
                  {c.profiles?.display_name ?? c.profiles?.username ?? 'anon'}
                </span>
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{c.content}</span>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{formatTimeAgo(c.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3 px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <input value={newComment} onChange={e => setNewComment(e.target.value)}
            placeholder="Add a comment…"
            className="flex-1 px-4 py-2.5 rounded-full text-sm outline-none"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            onKeyDown={e => e.key === 'Enter' && addComment()} />
          <button onClick={addComment} disabled={!newComment.trim() || loading}
            className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40"
            style={{ background: 'var(--accent)' }}>
            {loading ? <Loader2 size={15} color="white" className="animate-spin" /> : <Send size={15} color="white" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
