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
            style={{ background: '#7B5B4C', boxShadow: '0 2px 8px rgba(123,91,76,0.4)' }}
          >
            <Shirt size={17} color="#FFFFFF" strokeWidth={2.2} />
          </div>
        )}
        <div>
          <h1
            className="text-2xl"
            style={{ color: '#2B2322', fontWeight: 700, letterSpacing: '-0.5px' }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className="text-sm mt-0.5"
              style={{ color: 'rgba(43,35,34,0.5)' }}
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
