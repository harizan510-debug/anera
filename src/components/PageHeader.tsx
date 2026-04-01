import { Shirt } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  leftIcon?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, action, leftIcon }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6 pt-5">
      <div className="flex items-center gap-3">
        {leftIcon || (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: '#DDE5D3', boxShadow: '0 2px 8px rgba(163,177,138,0.25)' }}
          >
            <Shirt size={17} color="#4A5A38" strokeWidth={2.2} />
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
              style={{ color: '#6F6F6F' }}
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
