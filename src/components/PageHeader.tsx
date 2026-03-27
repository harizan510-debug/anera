interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-5 pt-4">
      <div>
        <h1 className="text-2xl" style={{ color: '#2B2B2B', fontWeight: 700, letterSpacing: '-0.5px' }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="mt-0.5">{action}</div>}
    </div>
  );
}
