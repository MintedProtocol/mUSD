import React from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  description?: string;
  badge?: string;
  badgeColor?: "brand" | "emerald" | "warning" | "purple";
  action?: React.ReactNode;
}

const badgeColors = {
  brand: "bg-brand-500/20 text-brand-400 border-brand-500/30",
  emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  warning: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

export function PageHeader({ title, subtitle, description, badge, badgeColor = "brand", action }: PageHeaderProps) {
  const helperText = subtitle ?? description;
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {title}
          </h1>
          {badge && (
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${badgeColors[badgeColor]}`}>
              {badge}
            </span>
          )}
        </div>
        {helperText && (
          <p className="text-base text-gray-400">{helperText}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
