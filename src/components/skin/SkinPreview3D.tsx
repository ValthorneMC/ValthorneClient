import React, { useEffect, useRef, useState } from 'react';
import * as skinview3d from 'skinview3d';
import { logger } from '@/utils/logger';

interface SkinPreview3DProps {
  skinUrl?: string;
  skinFileData?: ArrayBuffer;
  className?: string;
  onTextureLoad?: (textureUrl: string) => void;
}

export const SkinPreview3D: React.FC<SkinPreview3DProps> = ({
  skinUrl,
  skinFileData,
  className = '',
  onTextureLoad
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const skinViewerRef = useRef<skinview3d.SkinViewer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentSkinUrlRef = useRef<string | null>(null);
  const currentFileDataRef = useRef<ArrayBuffer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Obtener el tamaño del contenedor para ajustar el canvas
    const container = canvasRef.current.parentElement;
    const width = container?.clientWidth || 192;
    const height = container?.clientHeight || 256;

    const skinViewer = new skinview3d.SkinViewer({
      canvas: canvasRef.current,
      width: width, 
      height: height, 
      skin: undefined,
    });
    skinViewer.globalLight.intensity = 3;
    skinViewer.cameraLight.intensity = 0;
    skinViewer.fov = 40;
    skinViewer.zoom = 1;
    skinViewer.autoRotate = true;
    skinViewerRef.current = skinViewer;

    return () => {
      if (skinViewerRef.current) {
        skinViewerRef.current.dispose();
        skinViewerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!skinViewerRef.current) {
      return;
    }

    // Si no hay ni URL ni fileData, limpiar
    if (!skinUrl && !skinFileData) {
      currentSkinUrlRef.current = null;
      currentFileDataRef.current = null;
      return;
    }

    // Si ya está cargando la misma skin, no hacer nada
    if (currentSkinUrlRef.current === skinUrl && currentFileDataRef.current === skinFileData) {
      return;
    }

    setIsLoading(true);
    setError(null);
    currentSkinUrlRef.current = skinUrl || null;
    currentFileDataRef.current = skinFileData || null;

    const loadSkin = async () => {
      try {
        // PRIORIDAD 1: Si tenemos fileData, crear Image directamente desde ArrayBuffer
        if (skinFileData && skinFileData instanceof ArrayBuffer && skinFileData.byteLength > 0) {
          const blob = new Blob([skinFileData], { type: 'image/png' });
          const blobUrl = URL.createObjectURL(blob);
          
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              URL.revokeObjectURL(blobUrl);
              reject(new Error('Timeout loading image'));
            }, 5000);
            
            img.onload = () => {
              clearTimeout(timeout);
              URL.revokeObjectURL(blobUrl); // Limpiar inmediatamente después de cargar
              resolve();
            };
            
            img.onerror = () => {
              clearTimeout(timeout);
              URL.revokeObjectURL(blobUrl);
              reject(new Error('Failed to load image'));
            };
            
            img.src = blobUrl;
          });

          // Pasar el Image directamente a loadSkin (más eficiente y persistente)
          skinViewerRef.current?.loadSkin(img);
          onTextureLoad?.(blobUrl);
          setIsLoading(false);
          return;
        }

        // PRIORIDAD 2: Si tenemos URL (Mojang, Crafatar, etc.)
        if (skinUrl) {
          await skinViewerRef.current?.loadSkin(skinUrl);
          onTextureLoad?.(skinUrl);
          setIsLoading(false);
          return;
        }

        setIsLoading(false);
      } catch (err: any) {
        void logger.error('Error loading skin', err, 'SkinPreview3D');
        setError('Error loading skin');
        setIsLoading(false);
        currentSkinUrlRef.current = null;
        currentFileDataRef.current = null;
      }
    };

    loadSkin();
  }, [skinUrl, skinFileData, onTextureLoad]);

  if (error) {
    return (
      <div className={`relative ${className}`}>
        <div className="w-full h-full bg-black flex items-center justify-center">
          <div className="text-center text-red-400">
            <p className="text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full h-full ${className}`}>
      <div className="w-full h-full bg-black relative">
        <canvas
          ref={canvasRef}
          className={`w-full h-full ${isLoading ? 'opacity-50' : ''}`}
          style={{
            imageRendering: 'pixelated',
            cursor: 'grab',
            pointerEvents: 'auto',
            display: 'block',
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.cursor = 'grabbing';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.cursor = 'grab';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.cursor = 'grab';
          }}
          onClick={(e) => {
            // Prevenir que el click en el canvas seleccione la skin
            e.stopPropagation();
          }}
        />
      </div>

      {isLoading && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
        </div>
      )}
    </div>
  );
};
