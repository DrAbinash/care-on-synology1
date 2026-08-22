import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="w-full min-w-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 sm:pb-5 border-b border-card-border bg-gradient-to-r from-primary/5 via-transparent to-transparent">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-indigo-500 to-fuchsia-500 bg-clip-text text-transparent break-words">
          {title}
        </h1>
        {subtitle && <p className="text-sm sm:text-base text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {actions && (
        <div
          className="w-full sm:w-auto min-w-0 flex flex-wrap items-center gap-2 sm:justify-end [&>div]:contents"
          data-testid="page-header-actions"
        >
          {actions}
        </div>
      )}
    </div>
  );
}
