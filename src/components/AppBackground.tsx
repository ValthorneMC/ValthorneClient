import React from 'react';

interface AppBackgroundProps {
  /** Replaces the base gradient (for example, an instance video) */
  children?: React.ReactNode;
  /** Accent mist opacity. The home screen uses a slightly stronger one. */
  mistOpacity?: 'subtle' | 'strong';
  /** Oscurecimiento sobre el fondo, para que el contenido mantenga contraste */
  overlayClassName?: string;
}

/**
 * Background shared by every launcher view.
 *
 * Home, instance and settings each had their own gradient (home was brown/purple
 * while the rest were black), so the background jumped while navigating.
 */
const AppBackground: React.FC<AppBackgroundProps> = ({
  children,
  mistOpacity = 'subtle',
  overlayClassName = 'bg-black/60',
}) => (
  <>
    <div className="absolute inset-0 z-0">
      {children ?? (
        <div
          className="w-full h-full"
          style={{
            background: 'linear-gradient(135deg, #000000 0%, #0a0a0a 50%, #000000 100%)',
          }}
        />
      )}
    </div>

    {/* Bruma sutil de Valthorne: dorado y morado */}
    <div
      className={`absolute inset-0 z-[5] pointer-events-none ${
        mistOpacity === 'strong' ? 'opacity-20' : 'opacity-10'
      }`}
    >
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#d4af37] rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#7c4dbd] rounded-full blur-3xl" />
    </div>

    <div className={`absolute inset-0 z-10 pointer-events-none ${overlayClassName}`} />
  </>
);

export default AppBackground;
