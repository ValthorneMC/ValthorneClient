import React, { useEffect, useState } from 'react';

type LoaderVariant = 'text' | 'orbital' | 'simple';

interface LoaderProps {
  text?: string;
  variant?: LoaderVariant;
  showReloadAfter?: number;
}

const Loader: React.FC<LoaderProps> = ({
  text = "Cargando...",
  variant = 'text',
  showReloadAfter = 30
}) => {
  if (variant === 'simple') {
    return (
      <div className="flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (variant === 'orbital') {
    const [showReload, setShowReload] = useState(false);

    useEffect(() => {
      const timer = setTimeout(() => setShowReload(true), showReloadAfter * 1000);
      return () => clearTimeout(timer);
    }, [showReloadAfter]);

    const handleReload = () => {
      try {
        window.location.reload();
      } catch {
        window.location.reload();
      }
    };

    return (
      <div className="flex flex-col items-center justify-center space-y-8">
        <div className="loader">
          <div className="dot"></div>
          <div className="shadow shadow1"></div>
          <div className="shadow shadow2"></div>
          <div className="shadow shadow3"></div>
        </div>

        {showReload && (
          <div className="text-center animate-fade-in">
            <p className="text-white/80 text-sm mb-2">¿Llevas mucho tiempo aquí?</p>
            <button onClick={handleReload} className="text-blue-400 hover:text-blue-300 underline text-sm transition-colors duration-200">
              Recarga el launcher
            </button>
          </div>
        )}
      </div>
    );
  }

  const letters = Array.from(text);
  return (
    <div className="loader-wrapper">
      {letters.map((ch, idx) => (
        <span key={`${ch}-${idx}`} className="loader-letter">
          {ch === ' ' ? '\u00A0' : ch}
        </span>
      ))}
    </div>
  );
};

export default Loader;
