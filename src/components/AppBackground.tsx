import React from 'react';

interface AppBackgroundProps {
  /** Reemplaza el degradado base (por ejemplo, un vídeo de instancia) */
  children?: React.ReactNode;
  /** Opacidad de la bruma de acento. La home la usa algo más marcada. */
  mistOpacity?: 'subtle' | 'strong';
  /** Oscurecimiento sobre el fondo, para que el contenido mantenga contraste */
  overlayClassName?: string;
}

/**
 * Fondo compartido por todas las vistas del launcher.
 *
 * Home, instancia y ajustes usaban cada una su propio degradado (la home iba en
 * marrón/morado mientras el resto era negro), así que el fondo saltaba al navegar.
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
