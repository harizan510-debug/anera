import { NavLink } from 'react-router-dom';
import {
  LayoutGrid, Sparkles, ShoppingBag, BarChart2, Users
} from 'lucide-react';

const navItems = [
  { to: '/wardrobe',  icon: LayoutGrid,  label: 'Wardrobe' },
  { to: '/outfits',   icon: Sparkles,    label: 'Outfits' },
  { to: '/social',    icon: Users,       label: 'Community' },
  { to: '/purchase',  icon: ShoppingBag, label: 'Buy?' },
  { to: '/insights',  icon: BarChart2,   label: 'Insights' },
];

const ACTIVE_COLOR = '#C8B6FF';
const ACTIVE_BG = 'rgba(200,182,255,0.18)';
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
      {navItems.map(({ to, icon: Icon, label }) => (
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
                    ? { background: ACTIVE_BG, color: ACTIVE_COLOR }
                    : { color: INACTIVE_COLOR }
                }
              >
                <Icon
                  size={18}
                  strokeWidth={isActive ? 2.4 : 1.7}
                  color={isActive ? ACTIVE_COLOR : undefined}
                />
              </div>
              <span
                className="text-[10px] font-semibold tracking-wider uppercase transition-colors duration-200"
                style={{ color: isActive ? ACTIVE_COLOR : INACTIVE_COLOR }}
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
