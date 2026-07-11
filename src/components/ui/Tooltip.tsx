import React from 'react';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

const Tooltip: React.FC<TooltipProps> = ({ content, children, side = 'right' }) => {
  const sideClasses: Record<string, string> = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
  };

  return (
    <div className="relative group select-none" style={{ zIndex: 1 }}>
      {children}
      <div 
        className={`pointer-events-none absolute opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${sideClasses[side]}`}
        style={{ zIndex: 9999 }}
      >
        <div className="bg-black/90 text-white text-xs px-2 py-1 rounded-md whitespace-nowrap shadow-lg border border-white/20 backdrop-blur-sm">
          {content}
        </div>
      </div>
    </div>
  );
};

export default Tooltip;


