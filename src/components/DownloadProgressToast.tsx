import React, { useEffect, useState, useRef } from 'react';

interface DownloadProgressToastProps {
  message: string;
  percentage: number;
  onClose?: () => void;
}

const DownloadProgressToast: React.FC<DownloadProgressToastProps> = ({
  message,
  percentage,
  onClose
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [showProgress, setShowProgress] = useState(true);
  const [previousMessage, setPreviousMessage] = useState(message);
  const [isChanging, setIsChanging] = useState(false);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTimeout(() => setIsVisible(true), 50);
  }, []);

  useEffect(() => {
    if (message !== previousMessage) {
      setIsChanging(true);
      setTimeout(() => {
        setPreviousMessage(message);
        setIsChanging(false);
      }, 300);
    }
  }, [message, previousMessage]);

  useEffect(() => {
    if (percentage >= 100) {
      const timer = setTimeout(() => {
        setShowProgress(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [percentage]);

  const isCompleted = percentage >= 100;

  return (
    <div
      ref={containerRef}
      className={`
        z-[10000] max-w-sm w-full
        rounded-2xl border-2 shadow-2xl
        transition-all duration-500 ease-out transform
        ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
        text-blue-200 border-blue-400/60
        overflow-hidden
      `}
      style={{
        background: isCompleted 
          ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)'
          : 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.6)',
        borderColor: isCompleted ? 'rgba(34, 197, 94, 0.6)' : 'rgba(59, 130, 246, 0.6)',
        height: showProgress ? 'auto' : 'auto',
        transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      <div 
        className="p-4 transition-all duration-500"
        style={{
          paddingBottom: showProgress ? '1rem' : '1rem'
        }}
      >
        <div className="flex items-center justify-between">
          <p 
            ref={messageRef}
            className={`text-sm font-medium flex-1 mr-3 transition-all duration-300 ${
              isChanging ? 'opacity-50 scale-95' : 'opacity-100 scale-100'
            }`}
            style={{
              color: isCompleted ? 'rgb(187, 247, 208)' : 'rgb(191, 219, 254)'
            }}
          >
            {message}
          </p>
          {onClose && (
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white transition-colors duration-200 flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div 
          className={`w-full rounded-full overflow-hidden transition-all duration-500 ease-out ${
            showProgress ? 'mt-3 h-2 opacity-100' : 'mt-0 h-0 opacity-0'
          }`}
          style={{
            background: 'rgba(59, 130, 246, 0.2)',
            boxShadow: showProgress ? 'inset 0 2px 4px rgba(0, 0, 0, 0.3)' : 'none',
            maxHeight: showProgress ? '8px' : '0px',
            marginTop: showProgress ? '0.75rem' : '0'
          }}
        >
          <div 
            className="h-2 bg-blue-300 rounded-full transition-all duration-500 ease-out" 
            style={{ 
              width: `${percentage}%`,
              boxShadow: '0 0 8px rgba(147, 197, 253, 0.6)',
              backgroundColor: isCompleted ? 'rgb(74, 222, 128)' : 'rgb(147, 197, 253)'
            }} 
          />
        </div>
      </div>
    </div>
  );
};

export default DownloadProgressToast;
