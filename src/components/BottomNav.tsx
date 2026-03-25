import { NavLink } from 'react-router-dom';
import {
  LayoutGrid, Sparkles, MessageCircle, ShoppingBag, BarChart2, Trash2, Users
} from 'lucide-react';

const navItems = [
  { to: '/wardrobe',  icon: LayoutGrid,    label: 'Wardrobe' },
  { to: '/outfits',   icon: Sparkles,      label: 'Outfits' },
  { to: '/ask',       icon: MessageCircle, label: 'Ask' },
  { to: '/social',    icon: Users,         label: 'Community' },
  { to: '/purchase',  icon: ShoppingBag,   label: 'Buy?' },
  { to: '/insights',  icon: BarChart2,     label: 'Insights' },
  { to: '/declutter', icon: Trash2,        label: 'Declutter' },
];

export default function BottomNav() {
  return (
    <nav
      style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2 py-1 safe-area-bottom"
    >
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all duration-150 min-w-0 flex-1 ${
              isActive
                ? 'text-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <div
                className={`p-1.5 rounded-xl transition-all duration-150 ${
                  isActive ? 'bg-[var(--accent-light)]' : ''
                }`}
              >
                <Icon size={18} strokeWidth={isActive ? 2.5 : 1.8} />
              </div>
              <span className="text-[10px] font-medium tracking-wide">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
