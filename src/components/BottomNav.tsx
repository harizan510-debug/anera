import { NavLink } from 'react-router-dom';
import {
  LayoutGrid, Sparkles, ShoppingBag, BarChart2, Users
} from 'lucide-react';

const SAGE = '#A3B18A';
const SAGE_BG = 'rgba(163,177,138,0.15)';

const navItems = [
  { to: '/wardrobe',  icon: LayoutGrid,  label: 'Wardrobe',   main: false },
  { to: '/social',    icon: Users,       label: 'Community',  main: false },
  { to: '/outfits',   icon: Sparkles,    label: 'Outfits',    main: true  },
  { to: '/purchase',  icon: ShoppingBag, label: 'Buy?',       main: false },
  { to: '/insights',  icon: BarChart2,   label: 'Insights',   main: false },
];

const INACTIVE_COLOR = 'rgba(26,26,26,0.32)';
const ACTIVE_COLOR = '#1A1A1A';

/* Dome radius — the convex bump that rises above the bar to house the Outfits icon */
const DOME_R = 28;
const DOME_CURVE = 8;

function domePath(vw: number, r: number, curve: number) {
  const topY = 0;
  const cx = vw / 2;
  const left = cx - r - curve;
  const right = cx + r + curve;
  return [
    `M 0,${topY}`,
    `L ${left},${topY}`,
    `C ${left + curve},${topY} ${cx - r},${-r} ${cx},${-r}`,
    `C ${cx + r},${-r} ${right - curve},${topY} ${right},${topY}`,
    `L ${vw},${topY}`,
    `L ${vw},60`,
    `L 0,60`,
    'Z',
  ].join(' ');
}

function normaliseDomePath(vw: number, totalH: number, r: number, curve: number) {
  const topY = r;
  const cx = vw / 2;
  const left = cx - r - curve;
  const right = cx + r + curve;

  const n = (x: number, y: number) =>
    `${(x / vw).toFixed(4)},${(y / totalH).toFixed(4)}`;

  return [
    `M ${n(0, topY)}`,
    `L ${n(left, topY)}`,
    `C ${n(left + curve, topY)} ${n(cx - r, 0)} ${n(cx, 0)}`,
    `C ${n(cx + r, 0)} ${n(right - curve, topY)} ${n(right, topY)}`,
    `L ${n(vw, topY)}`,
    `L ${n(vw, totalH)}`,
    `L ${n(0, totalH)}`,
    'Z',
  ].join(' ');
}

export default function BottomNav() {
  const totalH = 60 + DOME_R;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom" style={{ marginTop: `-${DOME_R}px` }}>
      {/* SVG dome shape — acts as background */}
      <svg
        viewBox={`0 ${-DOME_R} 400 ${totalH}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ filter: 'drop-shadow(0 -1px 2px rgba(0,0,0,0.04))' }}
      >
        <path
          d={domePath(400, DOME_R, DOME_CURVE)}
          fill="rgba(255,255,255,0.92)"
        />
      </svg>

      {/* Frost / blur layer clipped to dome shape */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          clipPath: 'url(#navDomeClip)',
        }}
      />
      <svg width="0" height="0" className="absolute">
        <defs>
          <clipPath id="navDomeClip" clipPathUnits="objectBoundingBox">
            <path d={normaliseDomePath(400, totalH, DOME_R, DOME_CURVE)} />
          </clipPath>
        </defs>
      </svg>

      {/* Nav items */}
      <nav
        className="relative flex items-end justify-around px-2"
        style={{ paddingTop: `${DOME_R}px`, paddingBottom: '6px' }}
      >
        {navItems.map(({ to, icon: Icon, label, main }) => (
          <NavLink
            key={to}
            to={to}
            className="flex flex-col items-center gap-0.5 px-1 py-1 rounded-2xl transition-all duration-200 min-w-0 flex-1"
          >
            {({ isActive }) => (
              <>
                <div
                  className={`${main ? 'p-2.5 rounded-full shadow-md -mt-7' : 'p-1.5 rounded-2xl'} transition-all duration-200`}
                  style={
                    isActive
                      ? { background: main ? SAGE : SAGE_BG, color: main ? '#fff' : ACTIVE_COLOR }
                      : { color: INACTIVE_COLOR, background: main ? 'rgba(163,177,138,0.10)' : undefined }
                  }
                >
                  <Icon
                    size={main ? 26 : 18}
                    strokeWidth={isActive ? 2.4 : 1.7}
                    color={isActive ? (main ? '#fff' : ACTIVE_COLOR) : undefined}
                  />
                </div>
                <span
                  className={`${main ? 'text-[11px]' : 'text-[10px]'} font-semibold tracking-wider uppercase transition-colors duration-200`}
                  style={{ color: isActive ? ACTIVE_COLOR : INACTIVE_COLOR }}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
