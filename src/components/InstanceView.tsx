import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import LaunchButton from './LaunchButton';
import AppBackground from '@/components/AppBackground';
import { logger } from '@/utils/logger';


import minecraftIcon from '@/assets/icons/minecraft.svg';
import { modLoaderIconInvertFilter, modLoaderIconSrc } from '@/utils/modLoaderIcon';

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
}

// Global cache for videos per instance
const videoCache = new Map<string, { blobUrl: string; loaded: boolean }>();

const InstanceView: React.FC<InstanceViewProps> = ({
  instanceId,
  distribution,
  distributionBaseUrl,
  onLaunch,
  isJavaInstalling = false,
}) => {
  const { t } = useTranslation('instance');
  const [isVisible, setIsVisible] = useState(false);
  const [localVideoPath, setLocalVideoPath] = useState<string | null>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [showTitle, setShowTitle] = useState(true);

  const instance = distribution.instances.find(inst => inst.id === instanceId);

  // Animate on instance change
  useEffect(() => {
    if (instanceId) {
      setIsVisible(false);
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    }
  }, [instanceId]);

  // Download video when background_video is available
  useEffect(() => {
    const cacheKey = `${instanceId}-${instance?.background_video}`;
    const cached = videoCache.get(cacheKey);

    // If we have the video cached, use it directly
    if (cached) {
      setLocalVideoPath(cached.blobUrl);
      setVideoLoaded(cached.loaded);
      setShowTitle(!cached.loaded); // Only show the title if it wasn't loaded
      return;
    }

    // If there's no cache, reset states only if the instance changed
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
          // Convert bytes to Uint8Array and create a Blob URL
          const uint8Array = new Uint8Array(videoBytes);
          const blob = new Blob([uint8Array], { type: 'video/mp4' });
          const blobUrl = URL.createObjectURL(blob);
          setLocalVideoPath(blobUrl);
          // Save to cache without marking as loaded yet (will be marked when the video loads)
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

  // Fade out the title when the video is loaded
  useEffect(() => {
    if (videoLoaded) {
      const timer = setTimeout(() => {
        setShowTitle(false);
      }, 500); // Wait 500ms before starting the fade
      return () => clearTimeout(timer);
    }
  }, [videoLoaded]);

  if (!instance) {
    return (
      <div className={`flex items-center justify-center h-full transition-all duration-500 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">
            {t('notFound.title')}
          </h2>
          <p className="text-gray-300">
            {t('notFound.body')}
          </p>
        </div>
      </div>
    );
  }


  return (
    <div className="relative h-full w-full overflow-hidden">
      <AppBackground>
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
              // Update cache when the video loads
              const cacheKey = `${instanceId}-${instance?.background_video}`;
              if (videoCache.has(cacheKey)) {
                videoCache.set(cacheKey, { blobUrl: localVideoPath, loaded: true });
              }
            }}
          >
            <source src={localVideoPath} type="video/mp4" />
            {t('videoUnsupported')}
          </video>
        ) : null}
      </AppBackground>

      {/* Instance title - fades out once the video is loaded */}
      {showTitle && instance && (
        <div 
          className={`absolute inset-0 z-15 flex items-center justify-center transition-all duration-700 ${
            videoLoaded ? 'opacity-0' : isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'
          }`}
          style={{
            fontFamily: '"Bebas Neue", cursive, sans-serif'
          }}
        >
          <h1 className="font-display text-6xl md:text-8xl font-bold text-white drop-shadow-2xl tracking-wider">
            {instance.name}
          </h1>
        </div>
      )}


      <div className="relative z-20 h-full flex flex-col">
        {/* Spacer to push the content down */}
        <div className="flex-1" />
        
        {/* Tags and button at the bottom */}
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
            <div className="flex flex-col items-center gap-2">
              <LaunchButton
                onLaunch={() => onLaunch(instance)}
                className="text-center"
                isJavaInstalling={isJavaInstalling}
                instanceId={instanceId}
              />
              <PlayTimeStats instanceId={instanceId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


const PlayTimeStats: React.FC<{ instanceId: string }> = ({ instanceId }) => {
  const { t } = useTranslation('instance');
  const [totalHours, setTotalHours] = React.useState<number>(0);
  
  React.useEffect(() => {
    // Load total hours from localStorage or database
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
    
    // Listen for when the game exits to save the time
    const unlisten = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      return listen('minecraft_exited', () => {
        // The time is already saved in LaunchButton, just refresh here
        loadPlayTime();
      });
    };

    unlisten().then(fn => {
      return () => { try { fn(); } catch {} };
    }).catch(() => {});

    // Listen for the custom event fired when playtime is updated
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

  return (
    <div className="text-white/30 text-xs font-light opacity-50 transition-opacity hover:opacity-70">
      {t('hoursPlayed', { count: hours })}
    </div>
  );
};

export default InstanceView;
