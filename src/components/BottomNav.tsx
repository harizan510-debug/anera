import { NavLink } from 'react-router-dom';
import {
  LayoutGrid, Sparkles, ShoppingBag, BarChart2, Users
} from 'lucide-react';

const navItems = [
  {
    to: '/wardrobe',
    icon: LayoutGrid,
    label: 'Wardrobe',
    color: '#7C3AED',
    bg: '#EDE9FE',
  },
  {
    to: '/outfits',
    icon: Sparkles,
    label: 'Outfits',
    color: '#DB2777',
    bg: '#FCE7F3',
  },
  {
    to: '/social',
    icon: Users,
    label: 'Community',
    color: '#059669',
    bg: '#D1FAE5',
  },
  {
    to: '/purchase',
    icon: ShoppingBag,
    label: 'Buy?',
    color: '#EA580C',
    bg: '#FFEDD5',
  },
  {
    to: '/insights',
    icon: BarChart2,
    label: 'Insights',
    color: '#0891B2',
    bg: '#CFFAFE',
  },
];

export default function BottomNav() {
  return (
    <nav
      style={{ borderTop: '1px solid rgba(43,43,43,0.06)', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2 py-1 safe-area-bottom"
    >
      {navItems.map(({ to, icon: Icon, label, color, bg }) => (
        <NavLink
          key={to}
          to={to}
          className="flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-xl transition-all duration-150 min-w-0 flex-1"
        >
          {({ isActive }) => (
            <>
              <div
                className="p-1.5 rounded-xl transition-all duration-150"
                style={
                  isActive
                    ? { background: bg, color }
                    : { color: 'rgba(43,43,43,0.35)' }
                }
              >
                <Icon
                  size={18}
                  strokeWidth={isActive ? 2.5 : 1.8}
                  color={isActive ? color : undefined}
                />
              </div>
              <span
                className="text-[10px] font-semibold tracking-wider uppercase transition-colors duration-150"
                style={{ color: isActive ? color : 'rgba(43,43,43,0.35)' }}
              >
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
