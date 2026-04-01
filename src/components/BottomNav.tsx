import { NavLink } from 'react-router-dom';
import {
  LayoutGrid, Sparkles, ShoppingBag, BarChart2, Users
} from 'lucide-react';

const navItems = [
  { to: '/wardrobe',  icon: LayoutGrid,  label: 'Wardrobe',   color: '#C4956A', bg: 'rgba(196,149,106,0.15)', main: false },
  { to: '/social',    icon: Users,       label: 'Community',  color: '#A3B18A', bg: 'rgba(163,177,138,0.15)', main: false },
  { to: '/outfits',   icon: Sparkles,    label: 'Outfits',    color: '#D4A896', bg: 'rgba(212,168,150,0.15)', main: true  },
  { to: '/purchase',  icon: ShoppingBag, label: 'Buy?',       color: '#B8A080', bg: 'rgba(184,160,128,0.15)', main: false },
  { to: '/insights',  icon: BarChart2,   label: 'Insights',   color: '#A8B5C4', bg: 'rgba(168,181,196,0.15)', main: false },
];

const INACTIVE_COLOR = 'rgba(43,35,34,0.30)';

/* Dome radius — the convex bump that rises above the bar to house the Outfits icon */
const DOME_R = 28;
const DOME_CURVE = 8; // cubic ease-in width on each side

/**
 * SVG path for the nav bar background with a convex dome bump in the centre.
 * The dome arcs UPWARD (negative y) so the top border line wraps over the icon.
 * viewBox: 0 -DOME_R  400  (60 + DOME_R)
 */
function domePath(vw: number, r: number, curve: number) {
  const topY = 0;         // flat top edge of the bar
  const cx = vw / 2;      // horizontal centre
  const left = cx - r - curve;
  const right = cx + r + curve;
  // Path: left edge → approach dome → cubic up into arc → arc apex at -r → cubic back down → right edge → bottom
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

/** Normalised 0-1 version of the dome path for clipPath */
function normaliseDomePath(vw: number, totalH: number, r: number, curve: number) {
  const topY = r;  // in normalised space, 0 is the top of viewBox, so flat bar top is at r
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
  const totalH = 60 + DOME_R; // viewBox height
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom" style={{ marginTop: `-${DOME_R}px` }}>
      {/* SVG dome shape — acts as background */}
      <svg
        viewBox={`0 ${-DOME_R} 400 ${totalH}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ filter: 'drop-shadow(0 -1px 2px rgba(0,0,0,0.06))' }}
      >
        <path
          d={domePath(400, DOME_R, DOME_CURVE)}
          fill="rgba(255,255,255,0.85)"
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

      {/* Nav items — padded top to account for dome space */}
      <nav
        className="relative flex items-end justify-around px-2"
        style={{ paddingTop: `${DOME_R}px`, paddingBottom: '6px' }}
      >
        {navItems.map(({ to, icon: Icon, label, color, bg, main }) => (
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
                      ? { background: main ? color : bg, color: main ? '#fff' : color }
                      : { color: INACTIVE_COLOR, background: main ? 'rgba(212,168,150,0.12)' : undefined }
                  }
                >
                  <Icon
                    size={main ? 26 : 18}
                    strokeWidth={isActive ? 2.4 : 1.7}
                    color={isActive ? (main ? '#fff' : color) : undefined}
                  />
                </div>
                <span
                  className={`${main ? 'text-[11px]' : 'text-[10px]'} font-semibold tracking-wider uppercase transition-colors duration-200`}
                  style={{ color: isActive ? color : INACTIVE_COLOR }}
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
