import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { SkinData } from '@/types/skin';
import { logger } from '@/utils/logger';

interface SkinUploaderProps {
  onUploadSuccess: (skinData: SkinData) => void;
  onUploadError: (error: string) => void;
  disabled?: boolean;
}

export const SkinUploader: React.FC<SkinUploaderProps> = ({
  onUploadSuccess,
  onUploadError,
  disabled = false
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    
    setIsProcessing(true);

    try {
      // Validaciones básicas
      if (file.type !== 'image/png') {
        throw new Error('Solo se permiten archivos PNG');
      }

      if (file.size > 24 * 1024) {
        throw new Error('El archivo debe ser menor a 24KB');
      }

      // Guardar skin localmente (sin subir a Mojang)
      const fileData = await file.arrayBuffer();
      const skinData: SkinData = {
        id: `skin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: file.name.replace('.png', ''),
        file,
        fileData,
        url: '', 
        textureId: '',
        variant: 'classic',
        uploadedAt: new Date(),
        isActive: false, // No activar automáticamente
        isMojangSynced: false
      };

      // Notificar éxito - el componente padre se encargará de guardarla
      onUploadSuccess(skinData);

    } catch (error) {
      void logger.error('Error processing skin', error, 'SkinUploader');
      onUploadError(error instanceof Error ? error.message : 'Error desconocido');
    } finally {
      setIsProcessing(false);
    }
  }, [onUploadSuccess, onUploadError]);

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    onDrop,
    accept: {
      'image/png': ['.png']
    },
    multiple: false,
    disabled: disabled || isProcessing,
    noClick: false,
    noKeyboard: false
  });

  return (
    <div className="w-full relative">
      
      {isProcessing && (
        <div className="absolute -top-3 left-0 right-0">
          <div className="h-2 bg-gray-700 overflow-hidden rounded-full">
            <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 animate-pulse" style={{ width: '100%' }} />
          </div>
        </div>
      )}
      <div
        {...getRootProps()}
        className={`
          relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-300 h-32 flex flex-col items-center justify-center
          ${isDragReject
            ? 'border-red-400 bg-red-400/10 scale-105'
            : isDragActive
            ? 'border-blue-400 bg-blue-400/10 scale-105'
            : 'border-gray-600 hover:border-gray-500 hover:bg-gray-800/50'
          }
          ${disabled || isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />

        
        <div className={`mb-2 transition-transform duration-300 ${isDragActive ? 'scale-110' : ''}`}>
          <svg className="mx-auto h-8 w-8 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>

        
        <div className={`text-xs transition-colors duration-200 ${isDragReject ? 'text-red-300' : isDragActive ? 'text-blue-300' : 'text-gray-400'}`}>
          {isDragReject 
            ? 'Solo archivos PNG' 
            : isDragActive 
            ? 'Soltar aquí' 
            : 'PNG 64×64px'
          }
        </div>

        
        {!isProcessing && !disabled && (
          <button type="button" onClick={open} className="mt-3 text-[11px] text-gray-400 hover:text-gray-200 underline">
            o haz clic para seleccionar
          </button>
        )}

          
        {isProcessing && (
          <div className="absolute inset-0 bg-black/60 rounded-xl flex items-center justify-center">
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              <span className="text-white text-sm">Subiendo...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
