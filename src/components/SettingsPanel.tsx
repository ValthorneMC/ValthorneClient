import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { UpdaterService, UpdateInfo } from '@/services/updater';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/utils/logger';
import { toast } from 'vibe-toast';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  distributionUrl: string;
  onReloadDistribution: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  distributionUrl,
  onReloadDistribution
}) => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [debugResult, setDebugResult] = useState<string | null>(null);
  const [isTestingUrl, setIsTestingUrl] = useState(false);

  const handleReload = () => {
    onReloadDistribution();
    onClose();
  };

  const handleCheckUpdates = async () => {
    setIsChecking(true);
    try {
      const info = await UpdaterService.checkForUpdates();
      setUpdateInfo(info);
    } catch (error) {
      void logger.error('Error checking updates', error, 'handleCheckUpdates');
      setUpdateInfo({
        version: '',
        available: false,
        message: 'Error al verificar actualizaciones'
      });
    }
    setIsChecking(false);
  };

  const handleInstallUpdate = async () => {
    if (!updateInfo?.available) return;

    setIsInstalling(true);
    try {
      const result = await UpdaterService.installUpdate();
      if (result.success) {
        toast.success('Actualización instalada. Reiniciando...', { duration: 8000 });
      } else {
        toast.error(`Error al instalar actualización: ${result.message}`);
      }
    } catch (error) {
      void logger.error('Error installing update', error, 'handleInstallUpdate');
      toast.error('Error al instalar la actualización');
    }
    setIsInstalling(false);
  };

  const handleTestManifestUrl = async () => {
    setIsTestingUrl(true);
    setDebugResult(null);

    try {
      const result = await invoke<string>('test_manifest_url', {
        distributionUrl: distributionUrl,
        instanceId: 'thanatophobia2'
      });
      setDebugResult(result);
    } catch (error) {
      setDebugResult(`Error: ${error}`);
    } finally {
      setIsTestingUrl(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      handleCheckUpdates();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[10000] flex items-center justify-center">
      <div className="bg-gray-900/90 backdrop-blur-md rounded-lg p-6 border border-white/20 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Configuración</h2>
          <Button
            onClick={onClose}
            variant="ghost"
            size="sm"
            className="text-white/70 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        <div className="space-y-4">

          <div className="bg-black/20 rounded-lg p-3 border border-white/10">
            <h3 className="text-sm font-medium text-white mb-2">Actualizaciones</h3>
            {updateInfo && (
              <div className="mb-3">
                {updateInfo.available ? (
                  <div className="text-green-400 text-xs mb-2">
                    ✓ Actualización disponible: v{updateInfo.version}
                  </div>
                ) : (
                  <div className="text-gray-400 text-xs mb-2">
                    ✓ Está usando la versión más reciente
                  </div>
                )}
                <p className="text-xs text-gray-300">
                  {updateInfo.message}
                </p>
              </div>
            )}
            <div className="flex space-x-2">
              <button
                onClick={handleCheckUpdates}
                disabled={isChecking}
                className="text-xs px-3 py-2 rounded-xl border-2 border-cyan-400/60 text-cyan-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2"
                style={{
                  background: isChecking 
                    ? 'linear-gradient(135deg, rgba(34, 211, 238, 0.1) 0%, rgba(0, 0, 0, 0.3) 100%)'
                    : 'linear-gradient(135deg, rgba(34, 211, 238, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.4)'
                }}
              >
                {isChecking ? (
                  <>
                    <div className="w-3 h-3 border-2 border-cyan-300 border-t-transparent rounded-full animate-spin"></div>
                    Verificando...
                  </>
                ) : (
                  'Verificar'
                )}
              </button>
              {updateInfo?.available && (
                <button
                  onClick={handleInstallUpdate}
                  disabled={isInstalling}
                  className="text-xs px-3 py-2 rounded-xl border-2 border-green-400/60 text-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2"
                  style={{
                    background: isInstalling
                      ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(0, 0, 0, 0.3) 100%)'
                      : 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.4)'
                  }}
                >
                  {isInstalling ? (
                    <>
                      <div className="w-3 h-3 border-2 border-green-300 border-t-transparent rounded-full animate-spin"></div>
                      Instalando...
                    </>
                  ) : (
                    'Instalar'
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="bg-black/20 rounded-lg p-3 border border-white/10">
            <h3 className="text-sm font-medium text-white mb-2">Debugging</h3>
            <div className="space-y-2">
              <button
                onClick={handleTestManifestUrl}
                disabled={isTestingUrl}
                className="text-xs px-3 py-2 rounded-xl border-2 border-purple-400/60 text-purple-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 w-full flex items-center justify-center gap-2"
                style={{
                  background: isTestingUrl
                    ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(0, 0, 0, 0.3) 100%)'
                    : 'linear-gradient(135deg, rgba(168, 85, 247, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.4)'
                }}
              >
                {isTestingUrl ? (
                  <>
                    <div className="w-3 h-3 border-2 border-purple-300 border-t-transparent rounded-full animate-spin"></div>
                    Probando...
                  </>
                ) : (
                  'Probar URL del Manifest'
                )}
              </button>

              {debugResult && (
                <div className="bg-black/40 rounded p-2 border border-white/10">
                  <p className="text-xs text-gray-300 font-mono whitespace-pre-wrap">
                    {debugResult}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-black/20 rounded-lg p-3 border border-white/10">
            <h3 className="text-sm font-medium text-white mb-2">Distribución</h3>
            <p className="text-xs text-gray-300 mb-1">
              URL: {distributionUrl}
            </p>
            <p className="text-xs text-gray-400">
              Esta URL está configurada permanentemente para garantizar la seguridad y consistencia de la aplicación.
            </p>
          </div>

            
          <div className="flex space-x-3 pt-4">
            <button
              onClick={handleReload}
              className="flex-1 px-4 py-2 rounded-xl border-2 border-blue-400/60 text-blue-200 transition-all duration-200"
              style={{
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.4)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(0, 0, 0, 0.6) 100%)';
                e.currentTarget.style.boxShadow = '0 6px 20px 0 rgba(59, 130, 246, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)';
                e.currentTarget.style.boxShadow = '0 4px 16px 0 rgba(0, 0, 0, 0.4)';
              }}
            >
              Recargar Distribución
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-xl border-2 border-gray-400/60 text-gray-200 transition-all duration-200"
              style={{
                background: 'linear-gradient(135deg, rgba(156, 163, 175, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.4)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(156, 163, 175, 0.25) 0%, rgba(0, 0, 0, 0.6) 100%)';
                e.currentTarget.style.boxShadow = '0 6px 20px 0 rgba(156, 163, 175, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(156, 163, 175, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)';
                e.currentTarget.style.boxShadow = '0 4px 16px 0 rgba(0, 0, 0, 0.4)';
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
