import { useState } from "react";

interface SlippageInputProps {
  /** Current slippage in basis points (e.g. 50 = 0.5%) */
  value: number;
  /** Called when user changes slippage */
  onChange: (bps: number) => void;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Compact mode — hides preset buttons */
  compact?: boolean;
}

const PRESETS = [
  { label: "0.1%", bps: 10 },
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "2%", bps: 200 },
];

/**
 * H-08 FIX: Reusable slippage tolerance input for all swap-related components.
 * Provides preset buttons (0.1%, 0.5%, 1%, 2%) and a custom input field.
 * Returns value in basis points for direct use in contract calls.
 */
export function SlippageInput({
  value,
  onChange,
  disabled = false,
  compact = false,
}: SlippageInputProps) {
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");

  const isPreset = PRESETS.some((p) => p.bps === value);

  const handlePreset = (bps: number) => {
    if (disabled) return;
    setCustomMode(false);
    onChange(bps);
  };

  const handleCustom = (raw: string) => {
    setCustomValue(raw);
    const pct = parseFloat(raw);
    if (!isNaN(pct) && pct >= 0 && pct <= 50) {
      onChange(Math.round(pct * 100));
    }
  };

  const displayPct = (value / 100).toFixed(2);
  const isHighSlippage = value > 200; // > 2%

  return (
    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-400">Slippage Tolerance</span>
        <span
          className={`text-sm font-medium ${
            isHighSlippage ? "text-yellow-400" : "text-white"
          }`}
        >
          {displayPct}%
        </span>
      </div>

      {!compact && (
        <div className="flex gap-1.5 mb-2">
          {PRESETS.map((p) => (
            <button
              key={p.bps}
              onClick={() => handlePreset(p.bps)}
              disabled={disabled}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-all
                ${
                  value === p.bps && !customMode
                    ? "bg-blue-600 text-white ring-1 ring-blue-400"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
              `}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => {
              if (!disabled) {
                setCustomMode(true);
                setCustomValue(displayPct);
              }
            }}
            disabled={disabled}
            className={`flex-1 py-1.5 rounded text-xs font-medium transition-all
              ${
                customMode || (!isPreset && value > 0)
                  ? "bg-blue-600 text-white ring-1 ring-blue-400"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }
              ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
            `}
          >
            Custom
          </button>
        </div>
      )}

      {(customMode || compact) && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            min="0"
            max="50"
            value={customMode ? customValue : displayPct}
            onChange={(e) => handleCustom(e.target.value)}
            disabled={disabled}
            placeholder="0.50"
            className={`flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5
              text-sm text-white focus:border-blue-500 focus:outline-none
              ${disabled ? "opacity-50" : ""}
            `}
          />
          <span className="text-sm text-gray-400">%</span>
        </div>
      )}

      {isHighSlippage && (
        <p className="text-xs text-yellow-400 mt-1.5">
          ⚠ High slippage may result in unfavorable trade execution
        </p>
      )}
    </div>
  );
}

export default SlippageInput;
