import { useEffect, useRef, type SyntheticEvent } from 'react';
import type { UpscalePreset, ColorFilters, EnhancementStats } from '../hooks/useVideoEnhancement';
import './EnhancementPanel.css';

interface Props {
  preset: UpscalePreset;
  onPresetChange: (preset: UpscalePreset) => void;
  filters: ColorFilters;
  onFiltersChange: (filters: Partial<ColorFilters>) => void;
  stats: EnhancementStats;
  isActive: boolean;
  panelOpen: boolean;
  onPanelToggle: () => void;
}

const PRESETS: { value: UpscalePreset; label: string; desc: string }[] = [
  { value: 'off', label: 'Kapalı', desc: 'Orijinal kalite' },
  { value: 'light', label: 'Standart', desc: 'Hızlı iyileştirme' },
  { value: 'balanced', label: 'Yüksek', desc: 'Dengeli kalite' },
  { value: 'maximum', label: 'Ultra', desc: 'En iyi kalite' },
];

const PERF_LABELS: Record<string, { text: string; className: string }> = {
  excellent: { text: 'Cihazınız bu mod için uygun', className: 've-perf-excellent' },
  good: { text: 'Cihazınız bu modu kaldırıyor', className: 've-perf-good' },
  poor: { text: 'Cihazınız bu mod için yeterli olmayabilir', className: 've-perf-poor' },
};

function stopPlayerEvent(event: SyntheticEvent): void {
  event.stopPropagation();
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="ve-slider">
      <div className="ve-slider-header">
        <span>{label}</span>
        <span className="ve-slider-value">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={stopPlayerEvent}
        onMouseDown={stopPlayerEvent}
        onTouchStart={stopPlayerEvent}
        onInput={(e) => onChange(parseFloat(e.currentTarget.value))}
        onChange={(e) => onChange(parseFloat(e.currentTarget.value))}
      />
    </div>
  );
}

export function EnhancementPanel({
  preset,
  onPresetChange,
  filters,
  onFiltersChange,
  stats,
  isActive,
  panelOpen,
  onPanelToggle,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelOpen) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onPanelToggle();
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
    };
  }, [onPanelToggle, panelOpen]);

  // Scale-to-fit: the panel must never scroll. When its content is taller than
  // the available viewport budget (small non-fullscreen windows), shrink the
  // whole panel so every option stays visible — no scrollbar, no clipping.
  useEffect(() => {
    if (!panelOpen) return;

    const panel = menuRef.current?.querySelector<HTMLDivElement>('.ve-panel');
    if (!panel) return;

    const fitPanel = () => {
      const maxHeight = parseFloat(getComputedStyle(panel).maxHeight);
      const scale =
        maxHeight > 0 && panel.scrollHeight > maxHeight * 1.2
          ? maxHeight / panel.scrollHeight
          : 1;
      panel.style.transformOrigin = 'bottom right';
      panel.style.transform = scale < 1 ? `scale(${scale})` : '';
      panel.style.overflowY = 'auto';
      panel.classList.toggle('ve-panel-fit', scale < 1);
    };

    fitPanel();
    window.addEventListener('resize', fitPanel);
    return () => {
      window.removeEventListener('resize', fitPanel);
      panel.style.transform = '';
      panel.style.overflowY = 'auto';
    };
  }, [panelOpen, isActive, stats]);

  return (
    <div className="ve-menu" ref={menuRef}>
      <button
        className={`ve-toggle-btn vds-button ${isActive ? 'active' : ''}`}
        onPointerDown={stopPlayerEvent}
        onClick={(e) => {
          stopPlayerEvent(e);
          onPanelToggle();
        }}
        title="Video Kalite Artırma"
        aria-label="Video kalite ayarlarini ac"
      >
        <svg className="vds-icon" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z" />
        </svg>
      </button>

      {panelOpen && (
        <div
          className="ve-panel"
          role="menu"
          onPointerDown={stopPlayerEvent}
          onMouseDown={stopPlayerEvent}
          onTouchStart={stopPlayerEvent}
          onClick={stopPlayerEvent}
          onDoubleClick={stopPlayerEvent}
        >
          <div className="ve-panel-header">
            <span>Video Kalitesi</span>
            <button
              className="ve-close-btn"
              aria-label="Paneli kapat"
              onClick={(e) => {
                stopPlayerEvent(e);
                onPanelToggle();
              }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>

          <div className="ve-section">
            <div className="ve-presets">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  className={`ve-preset-btn ${preset === p.value ? 'selected' : ''}`}
                  onClick={(e) => {
                    stopPlayerEvent(e);
                    onPresetChange(p.value);
                  }}
                >
                  <span className="ve-preset-label">{p.label}</span>
                  <span className="ve-preset-desc">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {isActive && stats.outputLabel && (
            <div className="ve-info-row">
              <div className="ve-output-badge">{stats.outputLabel}</div>
              {stats.fps > 0 && <span className="ve-fps">{stats.fps} FPS</span>}
            </div>
          )}

          {isActive && stats.performance && (
            <div className={`ve-perf ${PERF_LABELS[stats.performance].className}`}>
              {PERF_LABELS[stats.performance].text}
            </div>
          )}

          <div className="ve-section">
            <div className="ve-section-title">Renk Ayarları</div>
            <Slider
              label="Parlaklık"
              value={filters.brightness}
              min={0.5}
              max={1.5}
              step={0.05}
              onChange={(v) => onFiltersChange({ brightness: v })}
            />
            <Slider
              label="Kontrast"
              value={filters.contrast}
              min={0.5}
              max={1.5}
              step={0.05}
              onChange={(v) => onFiltersChange({ contrast: v })}
            />
            <Slider
              label="Doygunluk"
              value={filters.saturate}
              min={0.5}
              max={2}
              step={0.05}
              onChange={(v) => onFiltersChange({ saturate: v })}
            />
            <button
              className="ve-reset-btn"
              onClick={(e) => {
                stopPlayerEvent(e);
                onFiltersChange({ brightness: 1, contrast: 1, saturate: 1 });
              }}
            >
              Sıfırla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
