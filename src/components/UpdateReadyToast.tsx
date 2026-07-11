import React, { useEffect, useState } from 'react';

interface UpdateReadyToastProps {
  message: string;
  version?: string;
  onClose?: () => void;
  onClick?: () => void;
  duration?: number;
}

const UpdateReadyToast: React.FC<UpdateReadyToastProps> = ({ 
  message, 
  version,
  onClose, 
  onClick,
  duration = 10000 
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setIsVisible(true), 100);
    const timer = setTimeout(() => { 
      if (onClose) handleClose(); 
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      if (onClose) onClose();
    }, 300);
  };

  const handleClick = () => {
    if (onClick) {
      onClick();
      handleClose();
    }
  };

  return (
    <div
      className={`
        z-[10000] max-w-sm w-full
        p-4 rounded-2xl border-2 shadow-2xl
        transition-all duration-300 transform cursor-pointer
        ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
        text-purple-200 border-purple-400/60
        hover:border-purple-400 hover:shadow-[0_0_30px_rgba(168,85,247,0.4)]
      `}
      style={{
        background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2) 0%, rgba(0, 0, 0, 0.6) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.6)'
      }}
      onClick={handleClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 8px 32px 0 rgba(168, 85, 247, 0.4)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 8px 32px 0 rgba(0, 0, 0, 0.6)';
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 mr-3">
          <p className="text-sm font-medium">{message}</p>
          {version && (
            <p className="text-xs text-purple-300/70 mt-1">Versión {version}</p>
          )}
          <p className="text-xs text-purple-300/60 mt-1 italic">Haz clic para instalar</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleClose();
          }}
          className="text-white/70 hover:text-white transition-colors duration-200 flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default UpdateReadyToast;

