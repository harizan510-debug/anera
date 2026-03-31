import { NavLink } from 'react-router-dom';
import {
  LayoutGrid, Sparkles, ShoppingBag, BarChart2, Users
} from 'lucide-react';

const navItems = [
  { to: '/wardrobe',  icon: LayoutGrid,  label: 'Wardrobe',   color: '#C8B6FF', bg: 'rgba(200,182,255,0.18)', main: false },
  { to: '/social',    icon: Users,       label: 'Community',  color: '#6EE7B7', bg: 'rgba(110,231,183,0.15)', main: false },
  { to: '/outfits',   icon: Sparkles,    label: 'Outfits',    color: '#F9A8D4', bg: 'rgba(249,168,212,0.15)', main: true  },
  { to: '/purchase',  icon: ShoppingBag, label: 'Buy?',       color: '#FCD34D', bg: 'rgba(252,211,77,0.15)', main: false },
  { to: '/insights',  icon: BarChart2,   label: 'Insights',   color: '#93C5FD', bg: 'rgba(147,197,253,0.15)', main: false },
];

const INACTIVE_COLOR = 'rgba(43,43,43,0.32)';

/* Semi-circle notch radius — matches the elevated icon bubble */
const NOTCH_R = 30;
const NOTCH_CURVE = 6; // extra smooth ease-in on each side

/**
 * SVG path for the top edge of the nav bar with a centred semi-circle notch.
 * Viewbox width is 400 (arbitrary, will stretch via preserveAspectRatio="none").
 * The notch sits at x=200 (centre).
 */
function notchPath(vw: number, r: number, curve: number) {
  const cy = 0;           // top of the bar
  const cx = vw / 2;      // horizontal centre
  const left = cx - r - curve;
  const right = cx + r + curve;
  // Start top-left, line to notch approach, cubic ease into the arc,
  // semi-circle arc downward, cubic ease out, line to top-right,
  // then down and across the bottom to close.
  return [
    `M 0,${cy}`,
    `L ${left},${cy}`,
    `C ${left + curve},${cy} ${cx - r},${r} ${cx},${r}`,
    `C ${cx + r},${r} ${right - curve},${cy} ${right},${cy}`,
    `L ${vw},${cy}`,
    `L ${vw},60`,
    `L 0,60`,
    'Z',
  ].join(' ');
}

export default function BottomNav() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom">
      {/* SVG notch shape — acts as background + border */}
      <svg
        viewBox={`0 -1 400 62`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ filter: 'drop-shadow(0 -1px 0 rgba(0,0,0,0.04))' }}
      >
        <path
          d={notchPath(400, NOTCH_R, NOTCH_CURVE)}
          fill="rgba(255,255,255,0.72)"
        />
      </svg>

      {/* Frost / blur layer behind everything */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          // Use same SVG notch as a clip so the blur follows the cutout shape
          clipPath: `url(#navClip)`,
        }}
      />
      <svg width="0" height="0" className="absolute">
        <defs>
          <clipPath id="navClip" clipPathUnits="objectBoundingBox">
            {/* Normalised 0-1 version of the notch */}
            <path d={normaliseNotchPath(400, 61, NOTCH_R, NOTCH_CURVE)} />
          </clipPath>
        </defs>
      </svg>

      <nav className="relative flex items-center justify-around px-2 py-1.5">
        {navItems.map(({ to, icon: Icon, label, color, bg, main }) => (
          <NavLink
            key={to}
            to={to}
            className="flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-2xl transition-all duration-200 min-w-0 flex-1"
          >
            {({ isActive }) => (
              <>
                <div
                  className={`${main ? 'p-2.5 -mt-5 rounded-full shadow-lg' : 'p-1.5 rounded-2xl'} transition-all duration-200`}
                  style={
                    isActive
                      ? { background: main ? color : bg, color: main ? '#fff' : color }
                      : { color: INACTIVE_COLOR, background: main ? 'rgba(249,168,212,0.12)' : undefined }
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

/** Convert the notch path to normalised 0-1 coordinates for clipPath */
function normaliseNotchPath(vw: number, vh: number, r: number, curve: number) {
  const cy = 0;
  const cx = vw / 2;
  const left = cx - r - curve;
  const right = cx + r + curve;

  const n = (x: number, y: number) => `${(x / vw).toFixed(4)},${((y + 1) / (vh + 1)).toFixed(4)}`;

  return [
    `M ${n(0, cy)}`,
    `L ${n(left, cy)}`,
    `C ${n(left + curve, cy)} ${n(cx - r, r)} ${n(cx, r)}`,
    `C ${n(cx + r, r)} ${n(right - curve, cy)} ${n(right, cy)}`,
    `L ${n(vw, cy)}`,
    `L ${n(vw, 60)}`,
    `L ${n(0, 60)}`,
    'Z',
  ].join(' ');
}
