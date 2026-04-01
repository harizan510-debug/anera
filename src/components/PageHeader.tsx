import { Shirt } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  leftIcon?: React.ReactNode;   // optional override for the default Shirt icon
}

export default function PageHeader({ title, subtitle, action, leftIcon }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6 pt-5">
      <div className="flex items-center gap-3">
        {/* Left icon — custom or default Anera logo */}
        {leftIcon || (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: '#C8B6FF', boxShadow: '0 2px 8px rgba(200,182,255,0.4)' }}
          >
            <Shirt size={17} color="#7C3AED" strokeWidth={2.2} />
          </div>
        )}
        <div>
          <h1
            className="text-2xl"
            style={{ color: '#1A1A1A', fontWeight: 700, letterSpacing: '-0.5px' }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className="text-sm mt-0.5"
              style={{ color: 'rgba(43,43,43,0.5)' }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && <div className="mt-0.5">{action}</div>}
    </div>
  );
}
