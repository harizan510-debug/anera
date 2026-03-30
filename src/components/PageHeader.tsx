interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6 pt-5">
      <div>
        <h1
          className="text-2xl"
          style={{ color: '#1A1A1A', fontWeight: 700, letterSpacing: '-0.5px' }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="text-sm mt-1"
            style={{ color: 'rgba(43,43,43,0.5)' }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="mt-0.5">{action}</div>}
    </div>
  );
}
