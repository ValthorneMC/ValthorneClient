import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleCheck,
  CircleHelp,
  Download,
  FolderOpen,
  Languages,
  Monitor,
  MoveHorizontal,
  MoveVertical,
  RefreshCw,
  ScrollText,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import AppBackground from '@/components/AppBackground';
import LanguageFlag from '@/components/LanguageFlag';
import {
  AUTO_LANGUAGE,
  SUPPORTED_LANGUAGES,
  changeLanguage,
  loadLanguagePreference,
  type LanguagePreference,
} from '@/i18n';
import { UpdaterService } from '@/services/updater';
import type { UpdateState, UpdateProgress } from '@/types/updater';
import { logger } from '@/utils/logger';

interface SettingsViewProps {
  addToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
  scrollToUpdates?: boolean;
}

const SettingsView: React.FC<SettingsViewProps> = ({ addToast, scrollToUpdates = false }) => {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { t: tUpdater } = useTranslation('updater');
  const [language, setLanguage] = useState<LanguagePreference>(AUTO_LANGUAGE);
  const [isVisible, setIsVisible] = useState(false);
  const updatesSectionRef = React.useRef<HTMLDivElement>(null);
  const [minRam, setMinRam] = useState(2.0);
  const [maxRam, setMaxRam] = useState(4.0);
  const [systemRam, setSystemRam] = useState(8);
  // Display values for the sliders
  const [displayMinRam, setDisplayMinRam] = useState(2.0);
  const [displayMaxRam, setDisplayMaxRam] = useState(4.0);
  
  // JVM Advanced Settings
  const [jvmArgs, setJvmArgs] = useState('');
  const [garbageCollector, setGarbageCollector] = useState('G1');
  
  // Window Settings
  const [windowWidth, setWindowWidth] = useState(1280);
  const [windowHeight, setWindowHeight] = useState(720);

  // Update Settings
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<UpdateProgress | null>(null);

  // Scroll state for shadow effect
  const [isScrolled, setIsScrolled] = useState(false);

  // Discord RPC state
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState(false);

  // Animate on mount
  useEffect(() => {
    setIsVisible(true);
  }, []);

  // Load the persisted language preference
  useEffect(() => {
    void loadLanguagePreference().then(setLanguage);
  }, []);

  const handleLanguageChange = async (preference: LanguagePreference) => {
    setLanguage(preference);
    try {
      await changeLanguage(preference);
    } catch (error) {
      void logger.error('Error saving language preference', error, 'SettingsView');
    }
  };

  // Scroll to updates section when requested
  useEffect(() => {
    if (scrollToUpdates && updatesSectionRef.current && isVisible) {
      setTimeout(() => {
        updatesSectionRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start' 
        });
      }, 500);
    }
  }, [scrollToUpdates, isVisible]);

  // Get system RAM and load saved configuration
  useEffect(() => {
    const initializeConfig = async () => {
      try {
        // Get system RAM
        const ram = await invoke<number>('get_system_ram');
        setSystemRam(ram);
        
        // Load saved RAM configuration
        const [savedMinRam, savedMaxRam] = await invoke<[number, number]>('load_ram_config');
        
        // Validate saved values against system limits
        const maxRamLimit = Math.max(2, Math.floor(ram * 0.75));
        
        // Set values, ensuring they're within valid ranges
        const validMinRam = Math.max(0.5, Math.min(savedMinRam, maxRamLimit));
        const validMaxRam = Math.max(validMinRam, Math.min(savedMaxRam, maxRamLimit));
        
        setMinRam(validMinRam);
        setMaxRam(validMaxRam);
        setDisplayMinRam(validMinRam);
        setDisplayMaxRam(validMaxRam);
        
        // Load advanced configuration
        const [savedJvmArgs, savedGc, savedWidth, savedHeight] = 
          await invoke<[string, string, number, number]>('load_advanced_config');
        
        setJvmArgs(savedJvmArgs);
        setGarbageCollector(savedGc);
        setWindowWidth(savedWidth);
        setWindowHeight(savedHeight);
        
      } catch (error) {
        void logger.error('Error initializing config', error, 'SettingsView');
        // Use defaults if loading fails
        setMinRam(2.0);
        setMaxRam(4.0);
        setJvmArgs('');
        setGarbageCollector('G1');
        setWindowWidth(1280);
        setWindowHeight(720);
      }
    };
    
    initializeConfig();
  }, []);

  // Initialize update state and event listeners
  useEffect(() => {
    const initializeUpdates = async () => {
      try {
        // Load current update state
        const state = await UpdaterService.getUpdateState();
        setUpdateState(state);

        // Set up progress callback
        UpdaterService.setProgressCallback((progress) => {
          setDownloadProgress(progress);
          // Compare progress, never the translated status text
          if (progress.percentage >= 100) {
            setIsDownloadingUpdate(false);
            // Refresh update state
            UpdaterService.getUpdateState().then(setUpdateState);
          }
        });

        // Start listening to update events
        await UpdaterService.startListeningToEvents();
      } catch (error) {
        void logger.error('Error initializing updates', error, 'SettingsView');
      }
    };

    initializeUpdates();
    initializeDiscordRpc();
  }, []);

  // Initialize Discord RPC state
  const initializeDiscordRpc = async () => {
    try {
      const config = await invoke<{ enabled: boolean }>('load_discord_rpc_config');
      setDiscordRpcEnabled(config.enabled);
    } catch (error) {
      void logger.error('Error loading Discord RPC config', error, 'SettingsView');
      setDiscordRpcEnabled(false);
    }
  };


  // Save configuration when values change
  const saveConfig = async (newMinRam: number, newMaxRam: number) => {
    try {
      await invoke('save_ram_config', { 
        minRam: newMinRam, 
        maxRam: newMaxRam 
      });
    } catch (error) {
      void logger.error('Error saving RAM config', error, 'SettingsView');
    }
  };

  // Save advanced settings
  const saveAdvancedConfig = async () => {
    try {
      await invoke('save_advanced_config', {
        jvmArgs,
        garbageCollector,
        windowWidth,
        windowHeight
      });
    } catch (error) {
      void logger.error('Error saving advanced config', error, 'SettingsView');
    }
  };

  // Handle scroll for shadow effect
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    setIsScrolled(scrollTop > 20);
  };

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdates(true);
    try {
      const result = await UpdaterService.checkForUpdates();
      const newState = await UpdaterService.getUpdateState();
      setUpdateState(newState);
      if (result.available && addToast) {
        addToast(t('updates.available', { version: result.version }), 'info');
      }
    } catch (error) {
      void logger.error('Error checking for updates', error, 'SettingsView');
      if (addToast) {
        addToast(tUpdater('checkFailed'), 'error');
      }
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setIsDownloadingUpdate(true);
    setDownloadProgress(null);
    try {
      const result = await UpdaterService.downloadUpdateSilent(true);
      if (result.success) {
        const newState = await UpdaterService.getUpdateState();
        setUpdateState(newState);
        if (addToast) {
          addToast(tUpdater('downloaded'), 'success');
        }
      } else {
        if (addToast) {
          addToast(tUpdater('downloadFailed'), 'error');
        }
      }
    } catch (error) {
      void logger.error('Error downloading update', error, 'SettingsView');
      if (addToast) {
        addToast(tUpdater('downloadFailed'), 'error');
      }
    } finally {
      setIsDownloadingUpdate(false);
    }
  };

  const [installConfirmOpen, setInstallConfirmOpen] = useState(false);

  const handleInstallUpdate = async () => {
    if (!updateState?.download_ready) return;
    setInstallConfirmOpen(true);
  };

  const handleConfirmInstall = async () => {
    setInstallConfirmOpen(false);
    
      try {
        const result = await UpdaterService.installUpdate();
        if (result.success) {
          if (addToast) {
            addToast(tUpdater('installed'), 'success');
          }
        } else {
          if (addToast) {
            addToast(tUpdater('installFailed'), 'error');
          }
        }
      } catch (error) {
        void logger.error('Error installing update', error, 'SettingsView');
        if (addToast) {
          addToast(tUpdater('installFailed'), 'error');
        }
      }
  };

  const handleMinRamChange = (value: number) => {
    const maxRamLimit = Math.max(2, Math.floor(systemRam * 0.75));
    // Round to multiples of 0.5 (valid value for Java)
    const roundedValue = Math.round(value * 2) / 2;

    // Update the display immediately for a fluid response
    setDisplayMinRam(roundedValue);

    // Only process valid changes (on release or when reaching a valid step)
    if (roundedValue <= maxRamLimit) {
      let newMaxRam = maxRam;

      // If the minimum exceeds the maximum, raise the maximum automatically
      if (roundedValue > maxRam && roundedValue <= maxRamLimit) {
        newMaxRam = roundedValue;
        setMaxRam(newMaxRam);
        setDisplayMaxRam(newMaxRam);
      }

      setMinRam(roundedValue);
      saveConfig(roundedValue, newMaxRam);
    }
  };

  // Handler for when the slider is being dragged (fluid display update)
  const handleMinRamInput = (value: number) => {
    const maxRamLimit = Math.max(2, Math.floor(systemRam * 0.75));
    // Round to multiples of 0.5 for display, but keep it fluid
    const roundedValue = Math.round(value * 2) / 2;

    // Only update the visual display while dragging
    if (roundedValue <= maxRamLimit) {
      setDisplayMinRam(roundedValue);

      // If it exceeds the maximum, also update the maximum display
      if (roundedValue > maxRam) {
        setDisplayMaxRam(roundedValue);
      }
    }
  };

  const handleMaxRamChange = (value: number) => {
    const maxRamLimit = Math.max(2, Math.floor(systemRam * 0.75));
    // Round to multiples of 0.5 (valid value for Java)
    const roundedValue = Math.round(value * 2) / 2;

    // Update the display immediately for a fluid response
    setDisplayMaxRam(roundedValue);

    if (roundedValue >= minRam && roundedValue <= maxRamLimit) {
      setMaxRam(roundedValue);
      saveConfig(minRam, roundedValue);
    }
  };

  // Handler for when the slider is being dragged (fluid display update)
  const handleMaxRamInput = (value: number) => {
    const maxRamLimit = Math.max(2, Math.floor(systemRam * 0.75));
    // Round to multiples of 0.5 for display, but keep it fluid
    const roundedValue = Math.round(value * 2) / 2;

    // Only update the visual display while dragging
    if (roundedValue >= minRam && roundedValue <= maxRamLimit) {
      setDisplayMaxRam(roundedValue);
    }
  };


  return (
    <div className="relative h-full w-full overflow-hidden">
      
      <AppBackground />

       {/* Content */}
       <div className="relative z-20 h-full flex flex-col">
         
          {/* Header with scroll shadow effect */}
          <div className={`pt-8 px-8 transition-all duration-500 ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'} ${
            isScrolled ? 'shadow-2xl shadow-black/50 bg-gradient-to-b from-black/20 to-transparent pb-4' : ''
          }`}>
            <div className="flex items-center gap-4 mb-6">
              <h1 className={`font-heading text-4xl font-black tracking-wide text-white drop-shadow-lg transition-all duration-500 ${
                isScrolled ? 'opacity-80 scale-95' : 'opacity-100 scale-100'
              }`}>
                {t('title')}
              </h1>
            </div>
            
            {/* Separator with fade effect */}
            <div className={`h-px bg-gradient-to-r from-transparent via-white/30 to-transparent mb-8 transition-all duration-500 ${
              isScrolled ? 'opacity-50 scale-y-50' : 'opacity-100 scale-y-100'
            }`}></div>
          </div>

         {/* Settings Content */}
         <div 
           className={`px-8 pb-8 scroll-container transition-all duration-700 delay-300 ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'}`} 
           style={{ 
             flex: '1 1 0',
             minHeight: '0',
             overflowY: 'auto',
             WebkitOverflowScrolling: 'touch',
             position: 'relative'
           }}
           onScroll={handleScroll}
         >
           {/* Fade overlay at top when scrolled */}
           <div className={`absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-black/60 to-transparent z-10 pointer-events-none transition-opacity duration-500 ${
             isScrolled ? 'opacity-100' : 'opacity-0'
           }`}></div>
          
          {/* Language Section */}
          <div className="max-w-4xl mx-auto mb-6">
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 flex items-center justify-center">
                  <Languages className="w-6 h-6 text-[#d4af37]" />
                </div>
                <h2 className="font-heading text-2xl font-bold text-white">{t('language.title')}</h2>
              </div>

              <p className="text-white/50 text-sm mb-4">{t('language.description')}</p>

              <div className="flex flex-wrap gap-3">
                {[
                  { code: AUTO_LANGUAGE, label: t('language.auto') },
                  ...SUPPORTED_LANGUAGES,
                ].map((option) => (
                  <button
                    key={option.code}
                    onClick={() => void handleLanguageChange(option.code as LanguagePreference)}
                    className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all duration-300 cursor-pointer ${
                      language === option.code
                        ? 'border-[#d4af37] bg-[#d4af37]/10 text-white'
                        : 'border-white/10 bg-white/5 text-white/70 hover:border-white/25 hover:text-white'
                    }`}
                  >
                    <LanguageFlag
                      language={option.code as LanguagePreference}
                      title={option.label}
                      className="w-5 h-auto rounded-[2px] shrink-0"
                    />
                    <span className="font-medium text-sm">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Java Configuration Section */}
          <div className="max-w-4xl mx-auto">
            <div className="glass-card rounded-2xl p-6">
              
              {/* Section Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 flex items-center justify-center">
                  <svg preserveAspectRatio="xMidYMid" viewBox="0 0 256 346" className="w-6 h-6">
                    <path d="M83 267s-14 8 9 11c27 3 41 2 71-3 0 0 8 5 19 9-67 29-153-2-99-17M74 230s-15 11 8 13c29 3 52 3 92-4 0 0 6 5 15 8-82 24-173 2-115-17" fill="#5382A1"/>
                    <path d="M144 166c17 19-4 36-4 36s42-22 22-49c-18-26-32-38 44-82 0 0-119 29-62 95" fill="#E76F00"/>
                    <path d="M233 295s10 8-10 15c-39 12-163 15-197 0-12-5 11-13 18-14l12-2c-14-9-89 19-38 28 138 22 251-10 215-27M89 190s-63 15-22 21c17 2 51 2 83-1 26-2 52-7 52-7l-16 9c-64 16-187 8-151-9 30-14 54-13 54-13M202 253c64-33 34-66 13-61l-7 2s2-3 6-5c41-14 73 43-14 66l2-2" fill="#5382A1"/>
                    <path d="M162 0s36 36-34 91c-56 45-12 70 0 99-32-30-56-56-40-80 23-35 89-53 74-110" fill="#E76F00"/>
                    <path d="M95 345c62 4 158-3 160-32 0 0-4 11-51 20-53 10-119 9-158 2 0 0 8 7 49 10" fill="#5382A1"/>
                  </svg>
                </div>
                <h2 className="font-heading text-2xl font-bold text-white">{t('java.title')}</h2>
              </div>

              {/* RAM Configuration */}
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4">{t('java.ram')}</h3>
                  
                  {/* Min RAM Slider */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-white/80 font-medium">{t('java.minRam')}</label>
                      <span className="text-white font-bold transition-all duration-100 ease-out">{displayMinRam.toFixed(displayMinRam % 1 === 0 ? 0 : 1)} GB</span>
                    </div>
                    <div className="relative ">
                      <input
                        type="range"
                        min="0.5"
                        max={Math.max(2, Math.floor(systemRam * 0.75))}
                        step="0.1"
                        value={minRam}
                        onInput={(e) => handleMinRamInput(parseFloat((e.target as HTMLInputElement).value))}
                        onChange={(e) => handleMinRamChange(parseFloat(e.target.value))}
                        className="w-full slider"
                      />
                    </div>
                  </div>

                  {/* Max RAM Slider */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-white/80 font-medium">{t('java.maxRam')}</label>
                      <span className="text-white font-bold transition-all duration-100 ease-out">{displayMaxRam.toFixed(displayMaxRam % 1 === 0 ? 0 : 1)} GB</span>
                    </div>
                    <div className="relative">
                      <input
                        type="range"
                        min="0.5"
                        max={Math.max(2, Math.floor(systemRam * 0.75))}
                        step="0.1"
                        value={maxRam}
                        onInput={(e) => handleMaxRamInput(parseFloat((e.target as HTMLInputElement).value))}
                        onChange={(e) => handleMaxRamChange(parseFloat(e.target.value))}
                        className="w-full slider"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* JVM Advanced Configuration Section */}
            <div className="glass-card rounded-2xl p-6 mt-6">
              
              {/* Section Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 flex items-center justify-center">
                  <Zap className="w-6 h-6 text-purple-400" />
                </div>
                <h2 className="font-heading text-2xl font-bold text-white">{t('jvm.title')}</h2>
              </div>

              <div className="space-y-6">
                 {/* Garbage Collector */}
                 <div>
                   <div className="flex items-center gap-2 mb-3">
                     <label className="text-white/80 font-medium">{t('jvm.garbageCollector')}</label>
                     <div className="relative group">
                       <button className="faq-button-small">
                         <CircleHelp className="w-4 h-4" />
                         <span className="tooltip-small">{t('jvm.gcHint')}</span>
                       </button>
                     </div>
                   </div>
                  <div className="grid grid-cols-3 gap-3">
                    {['G1', 'ZGC', 'Parallel'].map((gc) => (
                      <button
                        key={gc}
                        onClick={() => {
                          setGarbageCollector(gc);
                          saveAdvancedConfig();
                        }}
                        className={`p-3 rounded-xl border-2 transition-all duration-300 ease-out ${
                          garbageCollector === gc
                            ? 'glass-light border-[#d4af37]/50 cursor-pointer text-[#e8cf7a] neon-glow-cyan'
                            : 'glass-light border-white/10 text-white/70 hover:bg-white/10 hover:border-[#d4af37]/30 cursor-pointer'
                        }`}
                      >
                        <div className="text-sm font-semibold">{gc}</div>
                        <div className="text-xs opacity-70">
                          {gc === 'G1' && t('jvm.gcRecommended')}
                          {gc === 'ZGC' && t('jvm.gcLowLatency')}
                          {gc === 'Parallel' && t('jvm.gcHighPerformance')}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* JVM Arguments */}
                <div>
                  <label className="block text-white/80 font-medium mb-3">{t('jvm.extraArgs')}</label>
                  <textarea
                    value={jvmArgs}
                    onChange={(e) => setJvmArgs(e.target.value)}
                    onBlur={saveAdvancedConfig}
                    placeholder="-XX:+UseStringDeduplication -XX:+OptimizeStringConcat"
                    className="w-full h-20 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:border-purple-400 focus:bg-white/10 transition-all duration-200 resize-none"
                  />
                  <div className="text-xs text-red-500/50 mt-2 font-bold italic shadow-lg">
                    {t('jvm.extraArgsHint')}
                  </div>
                </div>
              </div>
            </div>

            {/* Window Configuration Section */}
            <div className="bg-black/20 backdrop-blur-sm rounded-2xl border border-white/10 p-6 mt-6">
              
              {/* Section Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 flex items-center justify-center">
                <Monitor className="w-6 h-6 text-[#d4af37]" />
                </div>
                <h2 className="font-heading text-2xl font-bold text-white">{t('window.title')}</h2>
              </div>

              <div className="space-y-6">
                {/* Resolution */}
                <div>
                   <div>
                     <label className="block text-white/80 font-medium mb-3">{t('window.resolution')}</label>
                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <label className="flex items-center gap-2 text-white/60 text-sm mb-2">
                           {t('window.width')}
                           <span className="inline-flex items-center">
                             <MoveHorizontal className="w-[18px] h-[18px]" />
                           </span>
                         </label>
                         <input
                           type="number"
                           value={windowWidth}
                           onChange={(e) => {
                             const value = parseInt(e.target.value) || 1280;
                             setWindowWidth(value);
                             saveAdvancedConfig();
                           }}
                           min="800"
                           max="7680"
                           className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-400 focus:bg-white/10 transition-all duration-200"
                           placeholder="1280"
                         />
                       </div>
                       <div>
                         <label className="flex items-center gap-2 text-white/60 text-sm mb-2">
                           {t('window.height')}
                           <span className="inline-flex items-center">
                           <MoveVertical className="w-[18px] h-[18px]" />
                           </span>
                         </label>
                           
                         <input
                           type="number"
                           value={windowHeight}
                           onChange={(e) => {
                             const value = parseInt(e.target.value) || 720;
                             setWindowHeight(value);
                             saveAdvancedConfig();
                           }}
                           min="600"
                           max="4320"
                           className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-400 focus:bg-white/10 transition-all duration-200"
                           placeholder="720"
                         />
                        </div>
                      </div>
                    </div>
                  </div>
               </div>
             </div>

            {/* Update Configuration Section */}
            <div ref={updatesSectionRef} className="bg-black/20 backdrop-blur-sm rounded-2xl border border-white/10 p-6 mt-6">
              
              {/* Section Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 text-green-400" />
                  </div>
                  <h2 className="font-heading text-2xl font-bold text-white">{t('updates.title')}</h2>
                </div>
                
                {/* Status Badge - A la derecha del header */}
                {updateState?.download_ready ? (
                  <div className="px-4 py-2 bg-blue-500/20 border border-blue-500/30 rounded-lg flex items-center gap-2">
                    <CircleCheck className="w-5 h-5 text-blue-300" />
                    <span className="text-blue-300 font-medium">{t('updates.readyToInstall')}</span>
                  </div>
                ) : updateState?.available_version ? (
                  <div className="px-4 py-2 bg-orange-500/20 border border-orange-500/30 rounded-lg flex items-center gap-2">
                    <TriangleAlert className="w-5 h-5 text-orange-300" />
                    <span className="text-orange-300 font-medium">{t('updates.newVersionAvailable', { version: updateState.available_version })}</span>
                  </div>
                ) : (
                  <div className="px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-lg flex items-center gap-2">
                    <CircleCheck className="w-5 h-5 text-green-300" />
                    <span className="text-green-300 font-medium">{t('updates.upToDate')}</span>
                  </div>
                )}
              </div>

              <div className="space-y-6">

                {/* Download Progress */}
                {downloadProgress && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-white/80 font-medium">{t('updates.progress')}</label>
                      <span className="text-white text-sm">{downloadProgress.status}</span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${downloadProgress.percentage}%` }}
                      ></div>
                    </div>
                    <div className="text-xs text-white/60 mt-1">
                      {downloadProgress.percentage}% 
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleCheckForUpdates}
                    disabled={isCheckingUpdates}
                    className="px-4 py-2 rounded-xl border-2 border-[#d4af37]/60 text-[#e8cf7a] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2"
                    style={{
                      background: isCheckingUpdates
                        ? 'linear-gradient(135deg, rgba(212, 175, 55, 0.1) 0%, rgba(0, 0, 0, 0.3) 100%)'
                        : 'linear-gradient(135deg, rgba(212, 175, 55, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.4)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isCheckingUpdates) {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(212, 175, 55, 0.25) 0%, rgba(0, 0, 0, 0.6) 100%)';
                        e.currentTarget.style.boxShadow = '0 6px 20px 0 rgba(212, 175, 55, 0.3)';
                        e.currentTarget.style.cursor = 'pointer';
                      } else {
                        e.currentTarget.style.cursor = 'not-allowed';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isCheckingUpdates) {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(212, 175, 55, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)';
                        e.currentTarget.style.boxShadow = '0 4px 16px 0 rgba(0, 0, 0, 0.4)';
                        e.currentTarget.style.cursor = 'pointer';
                      } else {
                        e.currentTarget.style.cursor = 'not-allowed';
                      }
                    }}
                  >
                    {isCheckingUpdates ? (
                      <>
                        <div className="w-4 h-4 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin"></div>
                        {t('updates.checking')}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        {t('updates.check')}
                      </>
                    )}
                  </button>

                  {updateState?.available_version && !updateState.download_ready && (
                    <button
                      onClick={handleDownloadUpdate}
                      disabled={isDownloadingUpdate}
                      className="px-4 py-2 rounded-xl border-2 border-orange-400/60 text-orange-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2"
                      style={{
                        background: isDownloadingUpdate
                          ? 'linear-gradient(135deg, rgba(234, 88, 12, 0.1) 0%, rgba(0, 0, 0, 0.3) 100%)'
                          : 'linear-gradient(135deg, rgba(234, 88, 12, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.4)'
                      }}
                      onMouseEnter={(e) => {
                        if (!isDownloadingUpdate) {
                          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(234, 88, 12, 0.25) 0%, rgba(0, 0, 0, 0.6) 100%)';
                          e.currentTarget.style.boxShadow = '0 6px 20px 0 rgba(234, 88, 12, 0.3)';
                          e.currentTarget.style.cursor = 'pointer';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isDownloadingUpdate) {
                          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(234, 88, 12, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)';
                          e.currentTarget.style.boxShadow = '0 4px 16px 0 rgba(0, 0, 0, 0.4)';
                          e.currentTarget.style.cursor = 'pointer';
                          }
                      }}
                    >
                      {isDownloadingUpdate ? (
                        <>
                          <div className="w-4 h-4 border-2 border-orange-300 border-t-transparent rounded-full animate-spin"></div>
                          {t('updates.downloading')}
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          {t('updates.download')}
                        </>
                      )}
                    </button>
                  )}

                  {updateState?.download_ready && (
                    <button
                      onClick={handleInstallUpdate}
                      className="px-4 py-2 rounded-xl border-2 border-green-400/60 text-green-200 transition-all duration-200 flex items-center gap-2"
                      style={{
                        background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.4)',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.25) 0%, rgba(0, 0, 0, 0.6) 100%)';
                        e.currentTarget.style.boxShadow = '0 6px 20px 0 rgba(34, 197, 94, 0.3)';
                        e.currentTarget.style.cursor = 'pointer';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)';
                        e.currentTarget.style.boxShadow = '0 4px 16px 0 rgba(0, 0, 0, 0.4)';
                        e.currentTarget.style.cursor = 'pointer';
                      }}
                    >
                      <CircleCheck className="w-4 h-4" />
                      {t('updates.install')}
                    </button>
                  )}
                </div>                
              </div>
            </div>

            {/* Logs Section */}
            <div className="bg-black/20 backdrop-blur-sm rounded-2xl border border-white/10 p-6 mt-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 flex items-center justify-center">
                  <ScrollText className="w-6 h-6 text-yellow-400" />
                </div>
                <h2 className="font-heading text-2xl font-bold text-white">{t('logs.title')}</h2>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    try {
                      await invoke('open_frontend_log_folder');
                    } catch (error) {
                      void logger.error('Failed to open frontend log folder', error, 'SettingsView');
                    }
                  }}
                  className="px-4 py-2 rounded-xl border-2 border-yellow-400/60 text-yellow-200 transition-all duration-200 flex items-center gap-2"
                  style={{
                    background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.4)',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(234, 179, 8, 0.25) 0%, rgba(0, 0, 0, 0.6) 100%)';
                    e.currentTarget.style.boxShadow = '0 6px 20px 0 rgba(234, 179, 8, 0.3)';
                    e.currentTarget.style.cursor = 'pointer';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(234, 179, 8, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)';
                    e.currentTarget.style.boxShadow = '0 4px 16px 0 rgba(0, 0, 0, 0.4)';
                    e.currentTarget.style.cursor = 'pointer';
                  }}
                >
                  <FolderOpen className="w-4 h-4" />
                  {t('logs.openFrontendFolder')}
                </button>

                <button
                  onClick={async () => {
                    try {
                      await invoke('open_backend_log_folder');
                    } catch (error) {
                      void logger.error('Failed to open backend log folder', error, 'SettingsView');
                    }
                  }}
                  className="px-4 py-2 rounded-xl border-2 border-yellow-400/60 text-yellow-200 transition-all duration-200 flex items-center gap-2"
                  style={{
                    background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.4)',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(234, 179, 8, 0.25) 0%, rgba(0, 0, 0, 0.6) 100%)';
                    e.currentTarget.style.boxShadow = '0 6px 20px 0 rgba(234, 179, 8, 0.3)';
                    e.currentTarget.style.cursor = 'pointer';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(234, 179, 8, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)';
                    e.currentTarget.style.boxShadow = '0 4px 16px 0 rgba(0, 0, 0, 0.4)';
                    e.currentTarget.style.cursor = 'pointer';
                  }}
                >
                  <FolderOpen className="w-4 h-4" />
                  {t('logs.openBackendFolder')}
                </button>
              </div>
            </div>

            {/* Discord RPC Configuration Section */}
            <div className="bg-black/20 backdrop-blur-sm rounded-2xl border border-white/10 p-6 mt-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 flex items-center justify-center">
                  <svg className="w-6 h-6 text-indigo-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.445.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                </div>
                <h2 className="font-heading text-2xl font-bold text-white">{t('discord.title')}</h2>
              </div>

              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <label className="text-white/80 font-medium">{t('discord.enable')}</label>
                      <div className="relative group">
                        <button className="faq-button-small">
                          <CircleHelp className="w-4 h-4" />
                          <span className="tooltip-small">
                            {t('discord.hint')}
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-medium ${discordRpcEnabled ? 'text-green-400' : 'text-red-400'}`}>
                        {discordRpcEnabled ? t('discord.enabled') : t('discord.disabled')}
                      </span>
                      <button
                        onClick={async () => {
                          try {
                            const newEnabled = !discordRpcEnabled;

                            if (newEnabled) {
                              await invoke<string>('initialize_discord_rpc');
                              if (addToast) {
                                addToast(t('discord.toastEnabled'), 'success');
                              }
                            } else {
                              await invoke('shutdown_discord_rpc');
                              if (addToast) {
                                addToast(t('discord.toastDisabled'), 'info');
                              }
                            }

                            setDiscordRpcEnabled(newEnabled);

                            // Save configuration
                            await invoke('save_discord_rpc_config', { enabled: newEnabled });

                          } catch (error) {
                            void logger.error('Error toggling Discord RPC', error, 'SettingsView');
                            if (addToast) {
                              addToast(t('discord.toastFailed'), 'error');
                            }
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                          discordRpcEnabled ? 'bg-indigo-600' : 'bg-gray-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                            discordRpcEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>


                </div>
              </div>
            </div>
           </div>
         </div>

      </div>

      {/* Confirmation dialog for installing the update */}
      {installConfirmOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div 
            className="rounded-2xl border-2 border-orange-400/60 p-8 max-w-md w-full mx-4 shadow-2xl"
            style={{
              background: 'linear-gradient(135deg, rgba(234, 88, 12, 0.15) 0%, rgba(0, 0, 0, 0.7) 100%)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.6)'
            }}
          >
            <div className="text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{
                  background: 'linear-gradient(135deg, rgba(234, 88, 12, 0.2) 0%, rgba(0, 0, 0, 0.4) 100%)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  border: '2px solid rgba(234, 88, 12, 0.4)'
                }}
              >
                <TriangleAlert className="w-8 h-8 text-orange-300" />
              </div>
              
              <h3 className="text-2xl font-bold text-white mb-2">{t('updates.confirmTitle')}</h3>
              <p className="text-white/80 mb-6">
                {t('updates.confirmBody')}
              </p>
              
              <div className="flex gap-3 justify-center">
                <button
                  onClick={handleConfirmInstall}
                  className="px-6 py-3 rounded-xl border-2 border-green-400/60 text-green-200 transition-all duration-200 font-medium"
                  style={{
                    background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.4)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.25) 0%, rgba(0, 0, 0, 0.6) 100%)';
                    e.currentTarget.style.boxShadow = '0 6px 20px 0 rgba(34, 197, 94, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(0, 0, 0, 0.5) 100%)';
                    e.currentTarget.style.boxShadow = '0 4px 16px 0 rgba(0, 0, 0, 0.4)';
                  }}
                >
                  {t('updates.confirmInstall')}
                </button>
                
                <button
                  onClick={() => setInstallConfirmOpen(false)}
                  className="px-6 py-3 rounded-xl border-2 border-gray-400/60 text-gray-200 transition-all duration-200 font-medium"
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
                  {tCommon('cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

       <style dangerouslySetInnerHTML={{
         __html: `
          .slider {
            -webkit-appearance: none;
            width: 100%;
            height: 10px;
            border-radius: 5px;
            background-color: #4158D0;
            background-image: linear-gradient(43deg, #4158D0 0%, #C850C0 46%, #FFCC70 100%);
            outline: none;
            opacity: 0.9;
            -webkit-transition: opacity 0.3s ease-in-out;
            transition: opacity 0.3s ease-in-out;
          }

          .slider:hover {
            opacity: 1;
          }

          .slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background-color: #4c00ff;
            background-image: linear-gradient(160deg, #4900f5 0%, #80D0C7 100%);
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
            will-change: transform, box-shadow;
          }

          .slider::-webkit-slider-thumb:hover {
            transform: scale(1.1);
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          }

          .slider::-webkit-slider-thumb:active {
            transform: scale(1.15);
            box-shadow: 0 6px 16px rgba(0,0,0,0.5);
            transition: all 0.1s cubic-bezier(0.4, 0, 0.2, 1);
          }

          .slider::-moz-range-thumb {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background-color: #0093E9;
            background-image: linear-gradient(160deg, #0093E9 0%, #80D0C7 100%);
            cursor: pointer;
            border: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
            will-change: transform, box-shadow;
          }

          .slider::-moz-range-thumb:hover {
            transform: scale(1.1);
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          }

          .slider::-moz-range-thumb:active {
            transform: scale(1.15);
            box-shadow: 0 6px 16px rgba(0,0,0,0.5);
            transition: all 0.1s cubic-bezier(0.4, 0, 0.2, 1);
          }

           .slider::-moz-range-track {
             height: 10px;
             background-color: #4158D0;
             background-image: linear-gradient(43deg, #4158D0 0%, #C850C0 46%, #FFCC70 100%);
             border-radius: 5px;
             border: none;
           }

           .slider::-webkit-slider-track {
             height: 10px;
             background-color: #4158D0;
             background-image: linear-gradient(43deg, #4158D0 0%, #C850C0 46%, #FFCC70 100%);
             border-radius: 5px;
             border: none;
           }

           .faq-button-small {
             width: 24px;
             height: 24px;
             border-radius: 50%;
             border: none;
             background-color: #ffe53b;
             background-image: linear-gradient(147deg, #ffe53b 0%, #ff2525 74%);
             display: flex;
             align-items: center;
             justify-content: center;
             cursor: pointer;
             box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.2);
             position: relative;
             transition: all 0.2s ease-in-out;
           }

           .faq-button-small:hover {
             transform: scale(1.1);
             box-shadow: 0px 6px 12px rgba(0, 0, 0, 0.3);
           }

           .faq-button-small svg {
             height: 1em;
             fill: white;
           }

           .faq-button-small:hover svg {
             animation: jello-vertical 0.7s both;
           }

           @keyframes jello-vertical {
             0% {
               transform: scale3d(1, 1, 1);
             }
             30% {
               transform: scale3d(0.75, 1.25, 1);
             }
             40% {
               transform: scale3d(1.25, 0.75, 1);
             }
             50% {
               transform: scale3d(0.85, 1.15, 1);
             }
             65% {
               transform: scale3d(1.05, 0.95, 1);
             }
             75% {
               transform: scale3d(0.95, 1.05, 1);
             }
             100% {
               transform: scale3d(1, 1, 1);
             }
           }

           .tooltip-small {
             position: absolute;
             top: -80px;
             left: 50%;
             transform: translateX(-50%);
             opacity: 0;
             background-color: #ffe53b;
             background-image: linear-gradient(147deg, #ffe53b 0%, #ff2525 74%);
             color: white;
             padding: 8px 12px;
             border-radius: 8px;
             display: flex;
             align-items: center;
             justify-content: center;
             transition-duration: 0.3s;
             pointer-events: none;
             letter-spacing: 0.5px;
             font-size: 12px;
             font-weight: 500;
             text-align: center;
             max-width: 280px;
             width: max-content;
             z-index: 50;
           }

           .tooltip-small::before {
             position: absolute;
             content: "";
             width: 8px;
             height: 8px;
             background-color: #ff2525;
             background-size: 1000%;
             background-position: center;
             transform: rotate(45deg);
             bottom: -4px;
             left: 50%;
             transform: translateX(-50%) rotate(45deg);
             transition-duration: 0.3s;
           }

           .faq-button-small:hover .tooltip-small {
             top: -90px;
             opacity: 1;
             transition-duration: 0.3s;
           }

           /* Custom scrollbar for Tauri */
           ::-webkit-scrollbar {
             width: 8px;
           }

           ::-webkit-scrollbar-track {
             background: rgba(255, 255, 255, 0.1);
             border-radius: 4px;
           }

           ::-webkit-scrollbar-thumb {
             background: rgba(255, 255, 255, 0.3);
             border-radius: 4px;
             transition: background 0.2s ease;
           }

           ::-webkit-scrollbar-thumb:hover {
             background: rgba(255, 255, 255, 0.5);
           }

           /* Force scrollbar to be visible */
           .scroll-container {
             scrollbar-width: thin;
             scrollbar-color: rgba(255, 255, 255, 0.3) rgba(255, 255, 255, 0.1);
           }
         `
       }} />
    </div>
  );
};

export default SettingsView;
