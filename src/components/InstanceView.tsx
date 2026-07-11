import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import LaunchButton from './LaunchButton';
import type { LocalInstance } from '@/types/local-instances';
import { logger } from '@/utils/logger';


import minecraftIcon from '@/assets/icons/minecraft.svg';
import { modLoaderIconInvertFilter, modLoaderIconSrc } from '@/utils/modLoaderIcon';
import Tooltip from './ui/Tooltip';

interface DistributionManifest {
  distribution: {
    name: string;
    version: string;
    description: string;
    base_url: string;
    last_updated: string;
  };
  instances: Array<{
    id: string;
    name: string;
    description: string;
    version: string;
    minecraft_version: string;
    icon?: string;
    background?: string;
    background_video?: string;
    last_updated?: string;
    instance_url: string;
    mod_loader?: {
      type: string;
      version: string;
    };
  }>;
}

interface InstanceViewProps {
  instanceId: string;
  distribution: DistributionManifest;
  distributionBaseUrl: string;
  onLaunch: (instance: any) => Promise<void>;
  isJavaInstalling?: boolean;
  localInstance?: LocalInstance | null;
  isLocal?: boolean;
  onSyncMods?: (localId: string) => void;
  onOpenFolder?: (localId: string) => void;
  onDownloadMods?: (localId: string) => void;
  onCopyFolders?: (localId: string) => void;
}

// Caché global para videos por instancia
const videoCache = new Map<string, { blobUrl: string; loaded: boolean }>();

const InstanceView: React.FC<InstanceViewProps> = ({
  instanceId,
  distribution,
  distributionBaseUrl,
  onLaunch,
  isJavaInstalling = false,
  localInstance = null,
  isLocal = false,
  onSyncMods,
  onOpenFolder,
  onDownloadMods,
  onCopyFolders,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [localVideoPath, setLocalVideoPath] = useState<string | null>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [showTitle, setShowTitle] = useState(true);
  
  // If it's a local instance, use localInstance data, otherwise find in distribution
  const instance = isLocal && localInstance 
    ? {
        id: localInstance.id,
        name: localInstance.name,
        description: `Instancia local`,
        version: "local",
        minecraft_version: localInstance.minecraft_version,
        icon: null,
        background: localInstance.background || null,
        background_video: null,
        last_updated: localInstance.created_at,
        instance_url: "",
        mod_loader: localInstance.mod_loader ?? {
          type: 'fabric',
          version: localInstance.fabric_version,
        }
      }
    : distribution.instances.find(inst => inst.id === instanceId);

  // Animate on instance change
  useEffect(() => {
    if (instanceId) {
      setIsVisible(false);
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    }
  }, [instanceId]);

  // Descargar video cuando hay background_video disponible
  useEffect(() => {
    const cacheKey = `${instanceId}-${instance?.background_video}`;
    const cached = videoCache.get(cacheKey);
    
    // Si tenemos el video en caché, usarlo directamente
    if (cached) {
      setLocalVideoPath(cached.blobUrl);
      setVideoLoaded(cached.loaded);
      setShowTitle(!cached.loaded); // Solo mostrar título si no estaba cargado
      return;
    }
    
    // Si no hay caché, resetear estados solo si cambió la instancia
    if (!cached) {
      setVideoLoaded(false);
      setShowTitle(true);
    }
    
    if (instance?.background_video && instanceId && distributionBaseUrl) {
      invoke<number[]>('get_instance_background_video', {
        baseUrl: distributionBaseUrl,
        instanceId: instanceId,
        videoPath: instance.background_video
      })
        .then((videoBytes) => {
          // Convertir bytes a Uint8Array y crear un Blob URL
          const uint8Array = new Uint8Array(videoBytes);
          const blob = new Blob([uint8Array], { type: 'video/mp4' });
          const blobUrl = URL.createObjectURL(blob);
          setLocalVideoPath(blobUrl);
          // Guardar en caché sin marcar como cargado aún (se marcará cuando el video se cargue)
          videoCache.set(cacheKey, { blobUrl, loaded: false });
        })
        .catch((error) => {
          void logger.error('Error downloading video', error, 'InstanceView');
          setLocalVideoPath(null);
        });
    } else {
      setLocalVideoPath(null);
    }
  }, [instance?.background_video, instanceId, distributionBaseUrl]);

  // Desvanecer el título cuando el video esté cargado
  useEffect(() => {
    if (videoLoaded) {
      const timer = setTimeout(() => {
        setShowTitle(false);
      }, 500); // Esperar 500ms antes de empezar a desvanecer
      return () => clearTimeout(timer);
    }
  }, [videoLoaded]);

  if (!instance) {
    return (
      <div className={`flex items-center justify-center h-full transition-all duration-500 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">
            Instancia no encontrada
          </h2>
          <p className="text-gray-300">
            La instancia seleccionada no se pudo cargar.
          </p>
        </div>
      </div>
    );
  }


  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0 z-0">
        {localVideoPath ? (
          <video
            key={localVideoPath}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
            style={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              width: '100%', 
              height: '100%',
              opacity: 0.8,
              filter: 'blur(2px)'
            }}
            onError={(e) => {
              void logger.error('Error loading video', e, 'InstanceView');
            }}
            onLoadedData={() => {
              setVideoLoaded(true);
              // Actualizar caché cuando el video se carga
              const cacheKey = `${instanceId}-${instance?.background_video}`;
              if (videoCache.has(cacheKey)) {
                videoCache.set(cacheKey, { blobUrl: localVideoPath, loaded: true });
              }
            }}
          >
            <source src={localVideoPath} type="video/mp4" />
            Tu navegador no soporta videos HTML5.
          </video>
        ) : (
          <>
            <div
              className="w-full h-full"
              style={{
                background: 'linear-gradient(135deg, #000000 0%, #0a0a0a 50%, #000000 100%)'
              }}
            />
            {/* Subtle neon accents in background */}
            <div className="absolute inset-0 z-5 opacity-10">
              <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#00ffff] rounded-full blur-3xl"></div>
              <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#ff00ff] rounded-full blur-3xl"></div>
            </div>
          </>
        )}
      </div>

      <div className="absolute inset-0 bg-black/60 z-10" />
      
      {/* Título de la instancia - se desvanece cuando el video está cargado */}
      {showTitle && instance && (
        <div 
          className={`absolute inset-0 z-15 flex items-center justify-center transition-all duration-700 ${
            videoLoaded ? 'opacity-0' : isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'
          }`}
          style={{
            fontFamily: '"Bebas Neue", cursive, sans-serif'
          }}
        >
          <h1 className="text-6xl md:text-8xl font-bold text-white drop-shadow-2xl tracking-wider">
            {instance.name}
          </h1>
        </div>
      )}


      <div className="relative z-20 h-full flex flex-col">
        {/* Spacer para empujar contenido abajo */}
        <div className="flex-1" />
        
        {/* Tags y botón al fondo */}
        <div className={`pb-12 flex flex-col items-center gap-6 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'}`}>
          {/* Tags */}
          <div className="flex items-center justify-center space-x-4 mb-4">
            <span 
              className="px-4 py-2 rounded-2xl border flex items-center space-x-2 shadow-xl backdrop-blur-xl transition-all duration-500 ease-out"
              style={{
                background: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.7)',
                borderColor: 'rgba(255, 255, 255, 0.2)',
                borderWidth: '1px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.35)';
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.65)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)';
              }}
            >
              <img src={minecraftIcon} alt="Minecraft" className="w-4 h-4 filter brightness-0 invert" />
              <span className="text-white font-semibold text-sm">{instance.minecraft_version}</span>
            </span>
            <span 
              className="px-4 py-2 rounded-2xl border shadow-xl backdrop-blur-xl transition-all duration-500 ease-out"
              style={{
                background: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.7)',
                borderColor: 'rgba(255, 255, 255, 0.2)',
                borderWidth: '1px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.35)';
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.65)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)';
              }}
            >
              <span className="text-white font-semibold text-sm">v{instance.version}</span>
            </span>
            {instance.mod_loader && (
              <span 
                className="px-4 py-2 rounded-2xl border flex items-center space-x-2 shadow-xl backdrop-blur-xl transition-all duration-500 ease-out"
                style={{
                  background: 'rgba(0, 0, 0, 0.6)',
                  backdropFilter: 'blur(24px)',
                  WebkitBackdropFilter: 'blur(24px)',
                  boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.7)',
                  borderColor: 'rgba(255, 255, 255, 0.2)',
                  borderWidth: '1px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.35)';
                  e.currentTarget.style.background = 'rgba(0, 0, 0, 0.65)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)';
                }}
              >
                <img
                  src={modLoaderIconSrc(instance.mod_loader.type)}
                  alt=""
                  className={
                    modLoaderIconInvertFilter(instance.mod_loader.type)
                      ? 'h-7 w-16 max-w-[6.5rem] shrink-0 object-contain object-left brightness-0 invert'
                      : 'h-7 w-16 max-w-[6.5rem] shrink-0 object-contain object-left'
                  }
                />
                <span className="text-white font-semibold text-sm">{instance.mod_loader.version}</span>
              </span>
            )}
          </div>

          <div className="flex flex-col items-center gap-4">
            {/* Buttons row for local instances */}
            {isLocal && (
              <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-4">
                {/* Open folder button */}
                <button
                  onClick={() => onOpenFolder?.(instanceId)}
                  className="p-3 rounded-xl bg-white/5 border border-white/20 text-white hover:bg-white/10 hover:border-white/30 transition-all duration-200 group"
                >
                  <Tooltip content="Abrir carpeta de la instancia" side="top">
                    <svg 
                      className="w-6 h-6 group-hover:scale-110 transition-transform" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </Tooltip>
                </button>

                {/* Download mods from Modrinth button */}
                <button
                  onClick={() => onDownloadMods?.(instanceId)}
                  className="p-3 rounded-xl bg-[#ff00ff]/10 border-2 border-[#ff00ff]/30 text-[#ff00ff] hover:bg-[#ff00ff]/20 hover:border-[#ff00ff] transition-all duration-200 group neon-glow-magenta-hover"
                >
                  <Tooltip content="Descargar mods desde Modrinth" side="top">
                    <div>
                      <svg 
                        className="w-6 h-6 group-hover:scale-110 transition-transform" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                  </Tooltip>
                </button>

                {/* Play button */}
                <LaunchButton
                  onLaunch={() => onLaunch(localInstance || instance)}
                  className="text-center"
                  isJavaInstalling={isJavaInstalling}
                  instanceId={instanceId}
                />

                {/* Sync mods button */}
                <button
                  onClick={() => onSyncMods?.(instanceId)}
                  className="p-3 rounded-xl bg-[#00ffff]/10 border-2 border-[#00ffff]/30 text-[#00ffff] hover:bg-[#00ffff]/20 hover:border-[#00ffff] transition-all duration-200 group neon-glow-cyan-hover"
                >
                  <Tooltip content="Sincronizar mods desde instancia remota" side="top">
                    <div>
                      <svg 
                        className="w-6 h-6 group-hover:rotate-180 transition-transform duration-500" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </div>
                  </Tooltip>
                </button>

                {/* Copy folders button */}
                <button
                  onClick={() => onCopyFolders?.(instanceId)}
                  className="p-3 rounded-xl bg-[#ffff00]/10 border-2 border-[#ffff00]/30 text-[#ffff00] hover:bg-[#ffff00]/20 hover:border-[#ffff00] transition-all duration-200 group"
                >
                  <Tooltip content="Copiar carpetas desde otra instancia" side="top">
                    <div>
                      <svg 
                        className="w-6 h-6 group-hover:scale-110 transition-transform" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </Tooltip>
                </button>
                </div>
                <PlayTimeStats instanceId={instanceId} />
              </div>
            )}

            {/* Regular instance - only play button */}
            {!isLocal && (
            <div className="flex flex-col items-center gap-2">
            <LaunchButton
              onLaunch={() => onLaunch(instance)}
              className="text-center"
              isJavaInstalling={isJavaInstalling}
              instanceId={instanceId}
            />
              <PlayTimeStats instanceId={instanceId} />
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};


const PlayTimeStats: React.FC<{ instanceId: string }> = ({ instanceId }) => {
  const [totalHours, setTotalHours] = React.useState<number>(0);
  
  React.useEffect(() => {
    // Cargar horas totales desde localStorage o base de datos
    const loadPlayTime = async () => {
      try {
        const saved = localStorage.getItem(`playtime_${instanceId}`);
        if (saved) {
          const hours = parseFloat(saved) || 0;
          setTotalHours(hours);
        }
      } catch (error) {
        void logger.error('Error loading play time', error, 'InstanceView');
      }
    };
    
    loadPlayTime();
    
    // Escuchar cuando el juego termine para guardar el tiempo
    const unlisten = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      return listen('minecraft_exited', () => {
        // El tiempo ya se guarda en LaunchButton, solo actualizar aquí
        loadPlayTime();
      });
    };
    
    unlisten().then(fn => {
      return () => { try { fn(); } catch {} };
    }).catch(() => {});
    
    // Escuchar evento personalizado cuando se actualiza el playtime
    const handlePlaytimeUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail?.instanceId === instanceId) {
        loadPlayTime();
      }
    };
    
    window.addEventListener('playtime_updated', handlePlaytimeUpdate);
    
    return () => {
      window.removeEventListener('playtime_updated', handlePlaytimeUpdate);
    };
  }, [instanceId]);
  
  if (totalHours < 1.0) return null;
  
  const hours = Math.floor(totalHours);
  const displayText = `${hours}h`;
  
  return (
    <div className="text-white/30 text-xs font-light opacity-50 transition-opacity hover:opacity-70">
      {displayText} jugadas
    </div>
  );
};

export default InstanceView;
