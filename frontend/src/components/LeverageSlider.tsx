import { useState, useEffect, useMemo } from 'react';

interface LeverageSliderProps {
  value: number; // leverage × 10  (e.g. 20 = 2.0x)
  onChange: (value: number) => void;
  maxLeverage?: number; // Max allowed × 10 (default 41 ≈ 4.1x)
  disabled?: boolean;
}

/** Generate evenly-spaced preset buttons for the current max */
function buildPresets(max: number): { value: number; label: string; description: string }[] {
  // Always start at 10 (1.0x) and end at max
  if (max <= 10) return [{ value: 10, label: '1x', description: 'No leverage' }];

  const steps = Math.min(5, Math.floor((max - 10) / 5) + 1);
  const interval = Math.round((max - 10) / (steps - 1));
  const presets: { value: number; label: string; description: string }[] = [];

  for (let i = 0; i < steps; i++) {
    const v = i === steps - 1 ? max : 10 + interval * i;
    const lev = v / 10;
    const desc =
      lev <= 1 ? 'No leverage' :
      lev <= 1.5 ? 'Conservative' :
      lev <= 2.5 ? 'Moderate' :
      lev <= 3.5 ? 'Aggressive' : 'Maximum';
    presets.push({ value: v, label: `${lev.toFixed(1)}x`, description: desc });
  }

  return presets;
}

export function LeverageSlider({ 
  value, 
  onChange, 
  maxLeverage = 41,
  disabled = false 
}: LeverageSliderProps) {
  const [sliderValue, setSliderValue] = useState(value);

  useEffect(() => {
    setSliderValue(value);
  }, [value]);

  const presets = useMemo(() => buildPresets(maxLeverage), [maxLeverage]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value);
    setSliderValue(newValue);
    onChange(newValue);
  };

  const handlePresetClick = (presetValue: number) => {
    if (presetValue <= maxLeverage && !disabled) {
      setSliderValue(presetValue);
      onChange(presetValue);
    }
  };

  const displayLeverage = (sliderValue / 10).toFixed(1);
  const pct = maxLeverage > 10 ? (sliderValue - 10) / (maxLeverage - 10) : 0;
  const riskLevel = pct <= 0.33 ? 'low' : pct <= 0.66 ? 'medium' : 'high';
  const riskColor = riskLevel === 'low' ? 'text-green-400' : riskLevel === 'medium' ? 'text-yellow-400' : 'text-red-400';
  const riskBgColor = riskLevel === 'low' ? 'bg-green-500' : riskLevel === 'medium' ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-white">Leverage</h3>
        <div className="flex items-center gap-2">
          <span className="text-3xl font-bold text-white">{displayLeverage}x</span>
          <span className={`text-sm ${riskColor} capitalize`}>({riskLevel} risk)</span>
        </div>
      </div>

      {/* Slider */}
      <div className="mb-6">
        <input
          type="range"
          min="10"
          max={maxLeverage}
          step="1"
          value={sliderValue}
          onChange={handleSliderChange}
          disabled={disabled}
          className={`w-full h-2 rounded-lg appearance-none cursor-pointer
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            bg-gradient-to-r from-green-500 via-yellow-500 to-red-500`}
          style={{
            background: `linear-gradient(to right, 
              #22c55e 0%, 
              #22c55e 33%, 
              #eab308 66%, 
              #ef4444 100%)`
          }}
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          {presets.map((p) => (
            <span key={p.value}>{p.label}</span>
          ))}
        </div>
      </div>

      {/* Preset Buttons */}
      <div className={`grid gap-2 mb-4`} style={{ gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))` }}>
        {presets.map((preset) => (
          <button
            key={preset.value}
            onClick={() => handlePresetClick(preset.value)}
            disabled={disabled || preset.value > maxLeverage}
            className={`py-2 px-3 rounded-lg text-sm font-medium transition-all
              ${sliderValue === preset.value
                ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                : preset.value > maxLeverage
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Risk Warning */}
      <div className={`p-3 rounded-lg ${
        riskLevel === 'low' ? 'bg-green-900/30 border border-green-800' :
        riskLevel === 'medium' ? 'bg-yellow-900/30 border border-yellow-800' :
        'bg-red-900/30 border border-red-800'
      }`}>
        <div className="flex items-start gap-2">
          <span className={`text-lg ${riskColor}`}>
            {riskLevel === 'low' ? '✓' : riskLevel === 'medium' ? '⚠' : '⚠'}
          </span>
          <div className="text-sm">
            <p className={riskColor}>
              {riskLevel === 'low' && 'Low liquidation risk. Safe for volatile markets.'}
              {riskLevel === 'medium' && 'Moderate risk. Monitor your position regularly.'}
              {riskLevel === 'high' && 'High liquidation risk! Small price moves can trigger liquidation.'}
            </p>
            {sliderValue > 10 && pct > 0.5 && (
              <p className="text-gray-400 mt-1">
                Liquidation at ~{Math.round((1 - 1/((sliderValue/10) * 0.8)) * 100)}% price drop
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default LeverageSlider;
