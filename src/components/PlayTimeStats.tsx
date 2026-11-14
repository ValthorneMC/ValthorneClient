import React from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '@/utils/logger';
import { listenScoped } from '@/utils/listenScoped';

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
    const unlisten = listenScoped<{ instance_id: string }>('minecraft_exited', event => {
      if (event.payload.instance_id === instanceId) void loadPlayTime();
    });

    // Listen for the custom event fired when playtime is updated
    const handlePlaytimeUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail?.instanceId === instanceId) {
        loadPlayTime();
      }
    };
    
    window.addEventListener('playtime_updated', handlePlaytimeUpdate);
    
    return () => {
      unlisten();
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

export default PlayTimeStats;
