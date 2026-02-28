import React from "react";

interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
  color?: "green" | "red" | "yellow" | "blue" | "purple" | "default";
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "glow" | "gradient";
}

const colorMap = {
  green: {
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    glow: "shadow-[0_0_30px_-10px_rgba(16,185,129,0.3)]",
  },
  red: {
    text: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    glow: "shadow-[0_0_30px_-10px_rgba(239,68,68,0.3)]",
  },
  yellow: {
    text: "text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
    glow: "shadow-[0_0_30px_-10px_rgba(234,179,8,0.3)]",
  },
  blue: {
    text: "text-brand-400",
    bg: "bg-brand-500/10",
    border: "border-brand-500/20",
    glow: "shadow-[0_0_30px_-10px_rgba(51,139,255,0.3)]",
  },
  purple: {
    text: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    glow: "shadow-[0_0_30px_-10px_rgba(168,85,247,0.3)]",
  },
  default: {
    text: "text-white",
    bg: "",
    border: "",
    glow: "",
  },
};

const sizeMap = {
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

const valueSizeMap = {
  sm: "text-xl",
  md: "text-2xl",
  lg: "text-3xl",
};

export function StatCard({
  label,
  value,
  subValue,
  color = "default",
  trend,
  trendValue,
  icon,
  size = "md",
  variant = "default",
}: StatCardProps) {
  const colors = colorMap[color];
  const baseClass = variant === "glow" 
    ? `card-glow ${colors.glow}` 
    : variant === "gradient" 
    ? "card-gradient-border" 
    : "card";

  return (
    <div 
      className={`${baseClass} ${sizeMap[size]} group relative overflow-hidden transition-all duration-300`}
    >
      {/* Decorative gradient orb */}
      {color !== "default" && (
        <div 
          className={`absolute -right-8 -top-8 h-24 w-24 rounded-full ${colors.bg} blur-2xl transition-all duration-500 group-hover:scale-150 group-hover:opacity-75`}
        />
      )}
      
      <div className="relative z-10">
        <div className="flex items-start justify-between">
          <p className="stat-label">{label}</p>
          {icon && (
            <div className={`rounded-lg ${colors.bg} p-2 ${colors.text}`}>
              {icon}
            </div>
          )}
        </div>
        
        <div className="mt-3 flex items-baseline gap-3">
          <p className={`${valueSizeMap[size]} font-bold tracking-tight ${colors.text}`}>
            {value}
          </p>
          
          {trend && trendValue && (
            <span
              className={`flex items-center gap-1 text-sm font-semibold ${
                trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-gray-400"
              }`}
            >
              {trend === "up" && (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17l5-5 5 5M7 11l5-5 5 5" />
                </svg>
              )}
              {trend === "down" && (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5-5-5M17 7l-5 5-5-5" />
                </svg>
              )}
              {trendValue}
            </span>
          )}
        </div>
        
        {subValue && (
          <p className="mt-2 text-sm text-gray-500">{subValue}</p>
        )}
      </div>
    </div>
  );
}
