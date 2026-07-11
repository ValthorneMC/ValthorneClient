import React, { useState, useEffect } from 'react';
import { SkinPreviewProps } from '@/types/skin';

export const SkinPreview: React.FC<SkinPreviewProps> = ({
  skinUrl,
  variant = 'classic',
  className = ''
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [cacheBust, setCacheBust] = useState<number>(Date.now());


  const buildPreviewUrl = (): string => {
    const modelParam = variant === 'slim' ? 'model=slim' : '';
    if (!skinUrl) {
      const base = `https://crafatar.com/renders/body/8667ba71-b85a-4004-af54-457a9734eed7`;
      const q = [`overlay=true`, modelParam, `v=${cacheBust}`].filter(Boolean).join('&');
      return `${base}?${q}`;
    }
    
    const hasQuery = skinUrl.includes('?');
    const sep = hasQuery ? '&' : '?';
    const parts = [`overlay=true`, modelParam, `v=${cacheBust}`].filter(Boolean).join('&');
    return `${skinUrl}${sep}${parts}`;
  };
  const previewUrl = buildPreviewUrl();

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setCacheBust(Date.now());
  }, [skinUrl, variant]);

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageError(true);
    setImageLoaded(false);
  };

  return (
    <div className={`relative ${className}`}>
        
      <div className="relative aspect-[3/4] bg-gradient-to-b from-gray-700 to-gray-900 rounded-lg overflow-hidden border border-gray-600">
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
          </div>
        )}

        {imageError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <svg className="mx-auto h-8 w-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
        ) : (
          <img
            src={previewUrl}
            alt="Previsualización de skin"
            className={`w-full h-full object-contain transition-opacity duration-300 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        )}
      </div>
    </div>
  );
};
