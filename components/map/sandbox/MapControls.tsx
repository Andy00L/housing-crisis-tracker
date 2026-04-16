interface MapControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function MapControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: MapControlsProps) {
  return (
    <div className="absolute top-2 right-2 flex flex-col bg-white/95 rounded-md border border-neutral-200 shadow-sm overflow-hidden text-neutral-700">
      <button
        onClick={onZoomIn}
        className="w-7 h-7 text-lg leading-none hover:bg-neutral-100 border-b border-neutral-200"
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        onClick={onZoomOut}
        className="w-7 h-7 text-lg leading-none hover:bg-neutral-100 border-b border-neutral-200"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        onClick={onReset}
        className="w-7 h-6 text-[10px] hover:bg-neutral-100 tabular-nums"
        aria-label="Reset view"
        title={`Zoom ${zoom.toFixed(1)}×`}
      >
        {zoom.toFixed(1)}×
      </button>
    </div>
  );
}
