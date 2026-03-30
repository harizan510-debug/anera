import { NavLink } from 'react-router-dom';
import {
  LayoutGrid, Sparkles, ShoppingBag, BarChart2, Users
} from 'lucide-react';

const navItems = [
  { to: '/wardrobe',  icon: LayoutGrid,  label: 'Wardrobe',   color: '#C8B6FF', bg: 'rgba(200,182,255,0.18)' },
  { to: '/outfits',   icon: Sparkles,    label: 'Outfits',    color: '#F9A8D4', bg: 'rgba(249,168,212,0.15)' },
  { to: '/social',    icon: Users,       label: 'Community',  color: '#6EE7B7', bg: 'rgba(110,231,183,0.15)' },
  { to: '/purchase',  icon: ShoppingBag, label: 'Buy?',       color: '#FCD34D', bg: 'rgba(252,211,77,0.15)' },
  { to: '/insights',  icon: BarChart2,   label: 'Insights',   color: '#93C5FD', bg: 'rgba(147,197,253,0.15)' },
];

const INACTIVE_COLOR = 'rgba(43,43,43,0.32)';

export default function BottomNav() {
  return (
    <nav
      style={{
        borderTop: '1px solid rgba(0,0,0,0.04)',
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: '20px 20px 0 0',
      }}
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2 py-1.5 safe-area-bottom"
    >
      {navItems.map(({ to, icon: Icon, label, color, bg }) => (
        <NavLink
          key={to}
          to={to}
          className="flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-2xl transition-all duration-200 min-w-0 flex-1"
        >
          {({ isActive }) => (
            <>
              <div
                className="p-1.5 rounded-2xl transition-all duration-200"
                style={
                  isActive
                    ? { background: bg, color }
                    : { color: INACTIVE_COLOR }
                }
              >
                <Icon
                  size={18}
                  strokeWidth={isActive ? 2.4 : 1.7}
                  color={isActive ? color : undefined}
                />
              </div>
              <span
                className="text-[10px] font-semibold tracking-wider uppercase transition-colors duration-200"
                style={{ color: isActive ? color : INACTIVE_COLOR }}
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
