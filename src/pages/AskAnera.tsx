import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Shirt, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../store';
import { chatWithAnera } from '../api';
import { hasClaudeKey } from '../apiHelper';
import type { ChatMessage } from '../types';

// Warm brown accent palette
const WARM = '#8B7355';
const WARM_BG = 'rgba(139,115,85,0.12)';

const QUICK_PROMPTS = [
  'Style my wardrobe for today',
  'What should I wear to a dinner?',
  'Help me pack for a weekend trip',
  'What goes with my black blazer?',
];

export default function AskAnera() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '0',
      role: 'assistant',
      content: `Hi${user.name ? `, ${user.name}` : ''}! I'm Anera, your personal stylist. Ask me anything about your wardrobe — what to wear, how to style an item, what to pack for a trip, or whether to make a purchase.`,
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput('');

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const hasApiKey = hasClaudeKey();

      let replyText: string;
      if (hasApiKey) {
        replyText = await chatWithAnera(trimmed, user.wardrobeItems, history);
      } else {
        await new Promise(r => setTimeout(r, 800));
        replyText = `Great question! Based on your wardrobe of ${user.wardrobeItems.length} items, I'd suggest mixing your basics creatively. To get personalised AI advice, add your Anthropic API key to the .env file. For now, try the Outfit Generator for auto-styling!`;
      }

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: replyText,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I ran into an issue. Please check your API key and try again.',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errMsg]);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 'calc(100dvh - 80px)', background: '#F5F0EB' }}>
      {/* Header */}
      <div
        className="px-4 pt-4 pb-3 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(139,115,85,0.12)', background: '#EDE4DD' }}
      >
        <div className="flex items-center gap-3">
          {/* Back button */}
          <button
            onClick={() => navigate(-1)}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90"
            style={{ background: WARM_BG }}
          >
            <ArrowLeft size={16} color={WARM} strokeWidth={2.5} />
          </button>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: WARM }}
          >
            <Shirt size={15} color="white" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
              Ask Anera
            </h1>
            <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              Your personal AI stylist
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Quick prompts — only show at start */}
        {messages.length === 1 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {QUICK_PROMPTS.map(prompt => (
              <button
                key={prompt}
                onClick={() => send(prompt)}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95"
                style={{
                  background: WARM_BG,
                  color: WARM,
                  border: `1px solid rgba(139,115,85,0.2)`,
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center mr-2 flex-shrink-0 mt-auto"
                style={{ background: WARM }}
              >
                <Shirt size={11} color="white" />
              </div>
            )}
            <div
              className="max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed"
              style={
                msg.role === 'user'
                  ? { background: WARM, color: '#FFFFFF', borderBottomRightRadius: '6px' }
                  : { background: '#FFFFFF', color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', borderBottomLeftRadius: '6px' }
              }
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center mr-2 flex-shrink-0"
              style={{ background: WARM }}
            >
              <Shirt size={11} color="white" />
            </div>
            <div
              className="px-4 py-3 rounded-2xl"
              style={{ background: '#FFFFFF', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
            >
              <div className="flex gap-1 items-center">
                <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: WARM, animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: WARM, animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: WARM, animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="flex-shrink-0 px-4 py-3 flex gap-3 items-end"
        style={{ borderTop: '1px solid rgba(139,115,85,0.12)', background: '#EDE4DD' }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask anything about your style…"
          rows={1}
          className="flex-1 resize-none outline-none text-sm px-4 py-3 rounded-2xl"
          style={{
            background: '#FFFFFF',
            border: '1.5px solid rgba(139,115,85,0.2)',
            color: 'var(--text-primary)',
            maxHeight: '120px',
            borderRadius: '20px',
          }}
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-40"
          style={{ background: WARM }}
        >
          {loading ? <Loader2 size={17} color="white" className="animate-spin" /> : <Send size={17} color="white" />}
        </button>
      </div>
    </div>
  );
}
