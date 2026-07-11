import { useState, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register } from "@tauri-apps/plugin-global-shortcut";
import { Button } from "@/components/ui/button";
import Loader from "@/components/Loader";
import { Toaster } from "vibe-toast";
import { addAppToast } from "@/utils/appToast";
import Sidebar from "@/components/Sidebar";
import UserProfile from "@/components/UserProfile";
import SettingsView from "@/components/SettingsView";
import InstanceView from "@/components/InstanceView";
import LocalInstancesView from "@/components/LocalInstancesView";
import DownloadProgressToast from "@/components/DownloadProgressToast";
import UpdateReadyToast from "@/components/UpdateReadyToast";
import { SkinManager } from "@/components/skin/SkinManager";
import { sendNotificationSafe, initializeNotificationPermissions } from "@/utils/notifications";
import { showIndeterminateProgressBar, hideProgressBar } from "@/utils/progressBar";
import { UpdaterService } from "@/services/updater";
import { WhitelistService } from "@/services/whitelist";
import { SessionService } from "@/services/sessions";
import { AdminService } from "@/services/admins";
import NoAccessScreen from "@/components/NoAccessScreen";
import CreateLocalInstanceModal from "@/components/CreateLocalInstanceModal";
import ModrinthSearchModal from "@/components/ModrinthSearchModal";
import CopyFoldersModal from "@/components/CopyFoldersModal";
import type { LocalInstance } from "@/types/local-instances";
import kindlyklanLogo from "@/assets/kindlyklan.png";
import microsoftIcon from "@/assets/icons/microsoft.svg";
import { logger } from "@/utils/logger";

// Función para actualizar Discord presence
const updateDiscordPresence = async (state: string, details: string) => {
  try {
    // Primero verificar si Discord RPC está habilitado
    const config = await invoke<{ enabled: boolean }>('load_discord_rpc_config');
    if (!config.enabled) return;

    // Verificar si está inicializado
    const isEnabled = await invoke<boolean>('is_discord_rpc_enabled');
    if (!isEnabled) return;

    await invoke('update_discord_presence', { state, details: details || '' });
  } catch (error) {
    // Silenciar errores de Discord RPC para no molestar al usuario
    void logger.debug('Discord RPC update failed (may not be enabled)', 'updateDiscordPresence');
  }
};
type AssetDownloadProgress = {
  current: number;
  total: number;
  percentage: number;
  current_file: string;
  status: string;
};


const checkJavaInstalled = async (javaVersion: string): Promise<boolean> => {
  try {
    const result = await invoke<string>('check_java_version', { version: javaVersion });
    return result === 'installed';
  } catch (error) {
    void logger.error('Error checking Java version', error, 'checkJavaInstalled');
    return false;
  }
};


const ensureJavaInstalled = async (
  minecraftVersion: string,
  setJavaProgress?: (progress: number) => void
): Promise<string> => {
  const javaVersion = await invoke<string>('get_required_java_version_command', {
    minecraftVersion,
  });

  const isInstalled = await checkJavaInstalled(javaVersion);
  if (isInstalled) {
    return javaVersion;
  }

  try {
    // Mostrar indicador de progreso indeterminado al iniciar descarga
    void showIndeterminateProgressBar();
    
    // Escuchar eventos de progreso de Java
    const unlistenProgress = await listen('java-download-progress', (e: any) => {
      const data = e.payload as { percentage: number; status: string };
      if (setJavaProgress) {
        setJavaProgress(data.percentage);
      }
    });
    
    const unlistenCompleted = await listen('java-download-completed', async (e: any) => {
      try {
        await hideProgressBar();
        // Mostrar notificación
        await sendNotificationSafe({
          title: 'Java instalado',
          body: `Java ${e.payload.version || ''} se ha instalado correctamente`,
        });
      } catch {}
      unlistenProgress();
      unlistenCompleted();
    });
    
    await invoke<string>('download_java', { version: javaVersion });
    return javaVersion;
  } catch (error) {
    void logger.error('Error downloading Java', error, 'ensureJavaInstalled');
    await hideProgressBar();
    throw error;
  }
};

const launchInstance = async (
  instance: any,
  currentAccount: Account | null,
  addToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void,
  onComplete?: () => void,
  setIsDownloadingAssets?: (downloading: boolean) => void,
  setDownloadProgress?: Dispatch<SetStateAction<AssetDownloadProgress | null>>,
  onAuthError?: () => void,
  baseUrl?: string,
  instanceUrl?: string
): Promise<void> => {
  let javaVersion = '';

  try {
    javaVersion = await ensureJavaInstalled(instance.minecraft_version);

    if (onComplete) {
      onComplete();
    }

    const javaPath = await invoke<string>('get_java_path', { version: javaVersion });

    await invoke<string>('create_instance_directory', {
      instanceId: instance.id,
      javaVersion: javaVersion
    });

    if (setIsDownloadingAssets && setDownloadProgress) {
      setIsDownloadingAssets(true);
      setDownloadProgress(null);

      try {
        const { listen } = await import('@tauri-apps/api/event');
        void showIndeterminateProgressBar();
        
        const unlistenProgress = await listen('asset-download-progress', (e: any) => {
          const data = e.payload as AssetDownloadProgress;
          setDownloadProgress(data);
        });
        const unlistenCompleted = await listen('asset-download-completed', async () => {
          setDownloadProgress({ current: 100, total: 100, percentage: 100, current_file: '', status: 'Completed' });
          try {
            await hideProgressBar();
            await sendNotificationSafe({
              title: 'Instancia lista',
              body: `La instancia "${instance.name}" se ha descargado correctamente`,
            });
          } catch {}
          unlistenProgress();
          unlistenCompleted();
        });

        await invoke<string>('download_instance_assets', {
          instanceId: instance.id,
          minecraftVersion: instance.minecraft_version,
          baseUrl: baseUrl,
          instanceUrl: instanceUrl
        });

        unlistenProgress();
        unlistenCompleted();
      } catch (error) {
        void logger.error('Error downloading assets', error, 'launchInstance');
        await hideProgressBar();
        addToast('Error descargando assets de la instancia', 'error');
        throw error;
      }
    }

    let accessToken = currentAccount?.user.access_token || '';
    if (currentAccount?.user.username) {
      try {
        const sessionResponse = await invoke<EnsureSessionResponse>('ensure_valid_session', {
          username: currentAccount.user.username
        });
        
        if (sessionResponse.status === 'Ok' && sessionResponse.data?.session) {
          accessToken = sessionResponse.data.session.access_token;
          if (sessionResponse.data.refreshed) {
            addToast('Sesión renovada automáticamente', 'info', 2000);
          }
        } else if (sessionResponse.status === 'Err') {
          addToast('Sesión expirada. Por favor, inicia sesión nuevamente.', 'error');
          if (onAuthError) {
            onAuthError();
          }
          return;
        }
      } catch (error) {
        void logger.error('Error validating session', error, 'launchInstance');
      }
    }

    const [minRam, maxRam] = await invoke<[number, number]>('load_ram_config');
    
    await invoke<string>('launch_minecraft_with_java', {
      appHandle: undefined,
      instanceId: instance.id,
      javaPath: javaPath,
      minecraftVersion: instance.minecraft_version,
      javaVersion: javaVersion,
      accessToken: accessToken,
      minRamGb: minRam,
      maxRamGb: maxRam
    });

    if (setIsDownloadingAssets) setIsDownloadingAssets(false);
    if (setDownloadProgress) setDownloadProgress(null);
    addToast(`Instancia "${instance.name}" lanzada correctamente`, 'success');
    void logger.info(`Instance launched successfully: ${instance.name}`, 'launchInstance');
  } catch (error) {
    void logger.error('Error launching instance', error, 'launchInstance');
    if (onComplete) {
      onComplete();
    }

    if (setIsDownloadingAssets) {
      setIsDownloadingAssets(false);
    }
    if (setDownloadProgress) {
      setDownloadProgress(null);
    }

    if (error && typeof error === 'string') {
      try {
        const errorData = JSON.parse(error);
        if (errorData.status === 'Err' && ['NO_SESSION', 'NO_REFRESH', 'REFRESH_FAILED', 'PROFILE_401'].includes(errorData.code)) {
          addToast('Sesión expirada. Por favor, inicia sesión nuevamente.', 'error');
          if (onAuthError) {
            onAuthError();
          }
          return;
        }
      } catch {
      }
    }

    addToast(`Error lanzando ${instance.name}`, 'error');
    throw error;
  }
};


if (typeof window !== 'undefined') {
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    return false;
  });

  document.addEventListener('keydown', (e) => {

    if (
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && e.key === 'I') ||
      (e.ctrlKey && e.key === 'U') ||
      (e.key === 'F5' && e.ctrlKey) 
    ) {
      e.preventDefault();
      return false;
    }
  });
}

interface AuthSession {
  access_token: string;
  username: string;
  uuid: string;
  user_type: string;
  expires_at?: number;
  refresh_token?: string;
}

interface EnsureSessionResponse {
  status: 'Ok' | 'Err';
  data?: {
    session?: {
      id: string;
      username: string;
      access_token: string;
      refresh_token: string | null;
      expires_at: number;
      created_at: number;
      updated_at: number;
    };
    refreshed?: boolean;
    code?: string;
    message?: string;
  };
}

interface Account {
  id: string;
  user: AuthSession;
  isActive: boolean;
}


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


function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const devToolsOpenRef = useRef(false);
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const [distribution, setDistribution] = useState<DistributionManifest | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  const [loaderText, setLoaderText] = useState("Iniciando sesión...");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isLoginVisible, setIsLoginVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scrollToUpdates, setScrollToUpdates] = useState(false);
  const [distributionLoaded, setDistributionLoaded] = useState(false);
  const [skinViewOpen, setSkinViewOpen] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<AssetDownloadProgress | null>(null);
  const [logoVisible, setLogoVisible] = useState(false);
  const [isDownloadingAssets, setIsDownloadingAssets] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateDialogState, setUpdateDialogState] = useState<{ isDownloadReady: boolean; hasUpdateAvailable: boolean; version: string | null } | null>(null);
  const [showNoAccessScreen, setShowNoAccessScreen] = useState(false);
  const [filteredInstances, setFilteredInstances] = useState<any[]>([]);
  const initialized = useRef(false);
  
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<number | null>(null);
  const [updateDownloadVersion, setUpdateDownloadVersion] = useState<string | null>(null);
  const [updateReadyVersion, setUpdateReadyVersion] = useState<string | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  // Estados para instancias locales
  const [localInstances, setLocalInstances] = useState<LocalInstance[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [createLocalModalOpen, setCreateLocalModalOpen] = useState(false);
  const [creatingInstanceId, setCreatingInstanceId] = useState<string | null>(null);
  const [syncModsModalOpen, setSyncModsModalOpen] = useState(false);
  const [syncingLocalId, setSyncingLocalId] = useState<string | null>(null);
  const [modrinthModalOpen, setModrinthModalOpen] = useState(false);
  const [modrinthInstanceId, setModrinthInstanceId] = useState<string | null>(null);
  const [copyFoldersModalOpen, setCopyFoldersModalOpen] = useState(false);
  const [copyFoldersInstanceId, setCopyFoldersInstanceId] = useState<string | null>(null);
  const [showLocalInstancesView, setShowLocalInstancesView] = useState(false);

  useEffect(() => {
    void logger.info('Aplicación iniciada', 'APP');
    void initializeNotificationPermissions();
    (async () => {
      try {
        await getCurrentWindow().setTheme('dark');
      } catch {}
    })();

    (async () => {
      try {
        await register('CommandOrControl+Shift+D', async () => {
          try {
            await invoke('toggle_devtools');
            devToolsOpenRef.current = !devToolsOpenRef.current;
          } catch (error) {
          }
        });
      } catch (error) {
      }
    })();

    (async () => {
      try {
        const config = await invoke<{ enabled: boolean }>('load_discord_rpc_config');
        if (config.enabled) {
          await invoke('initialize_discord_rpc');
          await updateDiscordPresence('En el cliente', '');
        }
      } catch (error) {
        void logger.debug('Discord RPC initialization failed', 'App');
      }
    })();
  }, []);
  
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('close-requested-during-download', () => {
      setCloseDialogOpen(true);
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { if (unlisten) { try { unlisten(); } catch {} } };
  }, []);
  
  useEffect(() => {
    if (!selectedInstance && !settingsOpen && !skinViewOpen && currentAccount) {
      setLogoVisible(false);
      const timer = setTimeout(() => setLogoVisible(true), 50);
      return () => clearTimeout(timer);
    }
  }, [selectedInstance, settingsOpen, skinViewOpen, currentAccount]);
  
  const DISTRIBUTION_URL = 'http://files.kindlyklan.com:26500/dist/manifest.json';

  const checkForUpdatesOnStartup = async () => {
    try {
      const state = await UpdaterService.getUpdateState();
      const currentVersion = state.current_version;
      
      if (state.available_version && state.available_version === currentVersion) {
        await invoke('clear_update_state');
      }
      
      if (state.download_ready) {
        try {
          const result = await UpdaterService.installUpdate();
          if (result.success) {
            addToast('Actualización instalada. La aplicación se reiniciará.', 'success');
            return;
          } else {
            void logger.error('Error instalando actualización automática', result.message, 'checkForUpdatesOnStartup');
            if (state.available_version) {
              setUpdateReadyVersion(state.available_version);
            }
            return;
          }
        } catch (error) {
          void logger.error('Error instalando actualización automática', error, 'checkForUpdatesOnStartup');
          if (state.available_version) {
            setUpdateReadyVersion(state.available_version);
          }
          return;
        }
      }

      const result = await UpdaterService.checkForUpdates();
      
      if (result.available) {
        const newState = await UpdaterService.getUpdateState();
        if (newState.available_version && !newState.downloaded) {
          setUpdateDownloadVersion(newState.available_version);
          setUpdateDownloadProgress(0);
          
          const downloadResult = await UpdaterService.downloadUpdateSilent(false);
          if (!downloadResult.success) {
            setUpdateDownloadProgress(null);
            setUpdateDownloadVersion(null);
            addToast('Error al descargar la actualización', 'error');
            const finalState = await UpdaterService.getUpdateState();
            if (finalState.available_version) {
              setUpdateDialogState({ isDownloadReady: false, hasUpdateAvailable: true, version: finalState.available_version });
              setUpdateDialogOpen(true);
            }
          } 
        }
      }
    } catch (error) {
      void logger.error('Error checking for updates on startup', error, 'checkForUpdatesOnStartup');
    }
  };

  const checkForUpdatesPeriodic = async () => {
    try {
      const shouldCheck = await UpdaterService.shouldCheckForUpdates();
      if (!shouldCheck) {
        console.log('Not time to check for updates');
        return;
      }

      console.log('Checking for updates periodically...');
      const result = await UpdaterService.checkForUpdates();
      if (result.available) {
        const state = await UpdaterService.getUpdateState();
        if (state.available_version && !state.downloaded) {
          console.log('New update available in periodic check, starting download...');
          setUpdateDownloadVersion(state.available_version);
          setUpdateDownloadProgress(0);
          
          const downloadResult = await UpdaterService.downloadUpdateSilent(false);
          if (!downloadResult.success) {
            setUpdateDownloadProgress(null);
            setUpdateDownloadVersion(null);
            addToast('Error al descargar la actualización', 'error');
            const newState = await UpdaterService.getUpdateState();
            if (newState.available_version && !newState.download_ready) {
              setUpdateDialogState({ isDownloadReady: false, hasUpdateAvailable: true, version: newState.available_version });
              setUpdateDialogOpen(true);
            }
          }
        }
      }
    } catch (error) {
      void logger.error('Error checking for updates in periodic check', error, 'checkForUpdatesPeriodic');
    }
  };

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const hideInitialLoader = () => {
      const loaderElement = document.querySelector('.initial-loader') as HTMLElement;
      if (loaderElement) {
        loaderElement.classList.add('hidden');
      }
    };
    setTimeout(hideInitialLoader, 100);

    loadDistribution();
    checkExistingSession().catch((error) => {
      void logger.error('Error in checkExistingSession', error, 'useEffect');
    });
    
    setTimeout(() => {
      checkForUpdatesOnStartup();
    }, 2000);

    const updateCheckInterval = setInterval(() => {
      checkForUpdatesPeriodic();
    }, 30 * 60 * 1000); // 30 minutos

    let unlistenUpdateStart: (() => void) | null = null;
    let unlistenUpdateProgress: (() => void) | null = null;
    let unlistenUpdateComplete: (() => void) | null = null;
    
    (async () => {
      try {
        unlistenUpdateStart = await listen('update-download-start', async () => {
          void showIndeterminateProgressBar();
          try {
            const state = await UpdaterService.getUpdateState();
            if (state.available_version) {
              setUpdateDownloadVersion(state.available_version);
              setUpdateDownloadProgress(0);
            }
          } catch (error) {
            void logger.error('Error getting update state', error, 'update-download-start');
            setUpdateDownloadProgress(0);
          }
        });
        
        unlistenUpdateProgress = await listen<number>('update-download-progress', (event) => {
          const progress = event.payload;
          setUpdateDownloadProgress(progress);
        });
        
        unlistenUpdateComplete = await listen('update-download-complete', async () => {
          setUpdateDownloadProgress(100);
          await hideProgressBar();
          setTimeout(async () => {
            const state = await UpdaterService.getUpdateState();
            if (state.available_version && state.available_version === state.current_version) {
              await invoke('clear_update_state');
              setUpdateDownloadProgress(null);
              setUpdateDownloadVersion(null);
              return;
            }
            if (state.download_ready && state.available_version) {
              setUpdateDownloadProgress(null);
              setUpdateDownloadVersion(null);
              setUpdateReadyVersion(state.available_version);
            }
          }, 500);
        });
      } catch (error) {
        void logger.error('Error setting up update event listeners', error, 'useEffect');
      }
    })();

    if (accounts.length === 0 && !isLoginVisible) {
      const timer = setTimeout(() => {
        setIsLoginVisible(true);
      }, 100);
      return () => {
        clearTimeout(timer);
        clearInterval(updateCheckInterval);
        if (unlistenUpdateStart) unlistenUpdateStart();
        if (unlistenUpdateProgress) unlistenUpdateProgress();
        if (unlistenUpdateComplete) unlistenUpdateComplete();
      };
    }
    
    return () => {
      clearInterval(updateCheckInterval);
      if (unlistenUpdateStart) unlistenUpdateStart();
      if (unlistenUpdateProgress) unlistenUpdateProgress();
      if (unlistenUpdateComplete) unlistenUpdateComplete();
    };
  }, [accounts.length, isLoginVisible]);

  // Actualizar Discord presence cuando cambie la vista
  useEffect(() => {
    const updatePresence = async () => {
      if (selectedInstance) {
        // Buscar el nombre de la instancia
        const instance = [...(filteredInstances || []), ...(localInstances || [])]
          .find(inst => inst.id === selectedInstance);
        const instanceName = instance ? instance.name : 'Instancia desconocida';
        await updateDiscordPresence(`Jugando ${instanceName}`, '');
      } else {
        await updateDiscordPresence('En el cliente', '');
      }
    };

    updatePresence();
  }, [selectedInstance, currentAccount]);

  useEffect(() => {
    if (accounts.length === 0) return;

    const validateAllTokens = async () => {
      const validAccounts: Account[] = [];

      for (const account of accounts) {
        const isValid = await validateAccountToken(account);
        if (isValid) {
          validAccounts.push(account);
        } else {
          void logger.warn(`Invalid token for account ${account.user.username}, deleting...`, 'validateAllTokens');
        }
      }

      if (validAccounts.length !== accounts.length) {
        setAccounts(validAccounts);

        if (currentAccount && !validAccounts.find(acc => acc.id === currentAccount.id)) {
          if (validAccounts.length > 0) {
            setCurrentAccount(validAccounts[0]);
            addToast(`Cuenta activa cambiada a: ${validAccounts[0].user.username}`, 'info');
          } else {
            setCurrentAccount(null);
            setIsLoginVisible(true);
            addToast('Todas las cuentas han expirado. Vuelve a iniciar sesión.', 'info');
          }
        }
      }
    };
    validateAllTokens();
    const interval = setInterval(validateAllTokens, 5 * 60 * 1000); 

    return () => clearInterval(interval);
  }, [accounts, currentAccount]);


  const addToast = addAppToast;

  const handleInstanceSelect = (instanceId: string) => {
    setSkinViewOpen(false);
    setSettingsOpen(false);
    if (instanceId === 'local-instances-view') {
      setShowLocalInstancesView(true);
      setSelectedInstance(null);
    } else {
      setShowLocalInstancesView(false);
    setSelectedInstance(instanceId);
      if (localInstances.some(li => li.id === instanceId)) {
        localStorage.setItem(`last_played_${instanceId}`, Date.now().toString());
      }
    }
  };

  const handleAddAccount = async () => {
    setCurrentAccount(null);
    setSelectedInstance(null);
    setSkinViewOpen(false);
    setSettingsOpen(false);
    setIsLoginVisible(true);

    addToast('Logéate para añadir una nueva cuenta', 'info');
  };

  const handleSwitchAccount = (account: Account) => {
    validateAccountToken(account).then(isValid => {
      if (!isValid) {
        addToast(`Token de ${account.user.username} ha expirado. Por favor, inicia sesión nuevamente.`, 'error');
        handleLogoutAccount(account.id);
        return;
      }

      setCurrentAccount(account);

      const updatedAccounts = accounts.map(acc => ({
        ...acc,
        isActive: acc.id === account.id
      }));
      setAccounts(updatedAccounts);
      addToast(`Cambiado a cuenta: ${account.user.username}`, 'success');
    }).catch(error => {
      void logger.error('Error switching account', error, 'handleSwitchAccount');
      addToast('Error al cambiar de cuenta', 'error');
    });
  };

  const validateAccountToken = async (account: Account): Promise<boolean> => {
    try {
      const refreshed = await SessionService.validateAndRefreshToken(account.user.username);
      if (refreshed && refreshed.access_token && refreshed.username === account.user.username) {
        account.user.access_token = refreshed.access_token;
        account.user.expires_at = refreshed.expires_at;
      }
      return true;
    } catch (error) {
      void logger.error(`Token validation/refresh failed for account ${account.user.username}`, error, 'validateAccountToken');
      return false;
    }
  };

  const handleLogoutAccount = async (accountId: string) => {
    const updatedAccounts = accounts.filter(acc => acc.id !== accountId);

    if (updatedAccounts.length === 0) {
      try {
        await SessionService.clearAllSessions();
      } catch (error) {
        void logger.error('Error clearing all sessions from database', error, 'handleLogoutAccount');
      }

      setAccounts([]);
      setCurrentAccount(null);
      setIsLoginVisible(true);
      addToast('Todas las cuentas cerradas. Vuelve a iniciar sesión.', 'info');
    } else {
      const newActiveAccount = updatedAccounts[0];
      setCurrentAccount(newActiveAccount);

      try {
        const accountToRemove = accounts.find(acc => acc.id === accountId);
        if (accountToRemove) {
          await SessionService.deleteSession(accountToRemove.user.username);
        }
      } catch (error) {
        void logger.error('Error deleting session from database', error, 'handleLogoutAccount');
      }

      setAccounts(updatedAccounts);
      addToast(`Sesión cerrada.`, 'info');
    }

    setSelectedInstance(null);
    setSkinViewOpen(false);
    setSettingsOpen(false);
  };

  const handleSettingsToggle = () => {
    if (!settingsOpen) {
      setSkinViewOpen(false);
      setSelectedInstance(null);
      setScrollToUpdates(false);
      setSettingsOpen(true);
    } else {
      setSettingsOpen(false);
      setSelectedInstance(null);
      setScrollToUpdates(false);
    }
  };

  const handleSkinToggle = () => {
    if (!skinViewOpen) {
      setSettingsOpen(false);
      setSelectedInstance(null);
      setSkinViewOpen(true);
    } else {
      setSkinViewOpen(false);
      setSelectedInstance(null);
    }
  };


  const loadDistribution = async () => {
    if (distributionLoaded) return; 
    try {
      const manifest = await invoke<DistributionManifest>('load_distribution_manifest', {
        url: DISTRIBUTION_URL
      });
      setDistribution(manifest);
      setDistributionLoaded(true);
      
      if (currentAccount) {
        const accessibleInstances = await WhitelistService.getAccessibleInstances(
          currentAccount.user.username,
          manifest.instances
        );
        setFilteredInstances(accessibleInstances);
      } else {
        setFilteredInstances(manifest.instances);
      }
      
      addToast(`¡Instancias cargadas correctamente!`, 'success');
    } catch (error) {
      addToast('Error al cargar la distribución', 'error');
    }
  };

  const checkAdminStatus = async () => {
    if (!currentAccount) {
      setIsAdmin(false);
      return;
    }

    try {
      const admin = await AdminService.checkIsAdmin(currentAccount.user.username);
      setIsAdmin(admin);
    } catch (error) {
      void logger.error('Error checking admin status', error, 'checkAdminStatus');
      setIsAdmin(false);
    }
  };

  const loadLocalInstancesRef = useRef<(() => Promise<void>) | null>(null);

  const loadLocalInstances = async () => {
    if (!isAdmin) {
      setLocalInstances([]);
      return;
    }

    try {
      const instances = await invoke<LocalInstance[]>('get_local_instances');
      setLocalInstances(instances);
    } catch (error) {
      void logger.error('Error loading local instances', error, 'loadLocalInstances');
      addToast('Error al cargar instancias locales', 'error');
    }
  };
  
  loadLocalInstancesRef.current = loadLocalInstances;
  
  const handleCreateLocalInstance = (instance: LocalInstance) => {
    setCreatingInstanceId(instance.id);    
    setTimeout(() => {
      setCreatingInstanceId(null);
    }, 2000);
  };

  const handleSyncMods = (localId: string) => {
    setSyncingLocalId(localId);
    setSyncModsModalOpen(true);
  };

  const handleSyncModsConfirm = async (remoteId: string) => {
    if (!syncingLocalId || !distribution) return;

    try {
      setShowLoader(true);
      setLoaderText('Sincronizando mods...');
      
      await invoke('sync_mods_from_remote', {
        localInstanceId: syncingLocalId,
        remoteInstanceId: remoteId,
        distributionUrl: distribution.distribution.base_url,
      });
      setSyncModsModalOpen(false);
      setSyncingLocalId(null);
    } catch (error) {
      void logger.error('Error syncing mods', error, 'handleSyncModsConfirm');
      addToast(`Error al sincronizar mods: ${error}`, 'error');
    } finally {
      setShowLoader(false);
      setLoaderText('Iniciando sesión...');
    }
  };

  const handleOpenFolder = async (instanceId: string) => {
    try {
      await invoke('open_instance_folder', { instanceId });
    } catch (error) {
      void logger.error('Error opening folder', error, 'handleOpenFolder');
      addToast('Error al abrir carpeta de la instancia', 'error');
    }
  };

  const handleDownloadMods = (instanceId: string) => {
    setModrinthInstanceId(instanceId);
    setModrinthModalOpen(true);
  };

  const handleCopyFolders = (instanceId: string) => {
    setCopyFoldersInstanceId(instanceId);
    setCopyFoldersModalOpen(true);
  };

  const handleLocalInstanceDeleted = (instanceId: string) => {
    setLocalInstances(localInstances.filter(li => li.id !== instanceId));
    if (selectedInstance === instanceId) {
      setSelectedInstance(null);
    }
  };

  useEffect(() => {
    checkAdminStatus();
  }, [currentAccount]);

  useEffect(() => {
    loadLocalInstances();
  }, [isAdmin]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isUnmounted = false;
    
    listen('local-instance-progress', (event: any) => {
      if (isUnmounted) return;
      
      const progress = event.payload;
      
      if (progress.stage === 'completed') {
        addToast(progress.message, 'success');
        setTimeout(() => {
          if (!isUnmounted && loadLocalInstancesRef.current) {
            loadLocalInstancesRef.current();
          }
        }, 500);
      }
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    
    return () => { 
      isUnmounted = true;
      if (unlisten) { try { unlisten(); } catch {} } 
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    
    listen('mod-sync-progress', (event: any) => {
      const progress = event.payload;
      
      if (progress.stage === 'completed') {
        addToast(progress.message, 'success');
      }
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    
    return () => { if (unlisten) { try { unlisten(); } catch {} } };
  }, []);

  const handleLogout = async () => {
    try {
      if (currentAccount) {
        await SessionService.deleteSession(currentAccount.user.username);
      }
      await SessionService.clearAllSessions();
    } catch (error) {
      void logger.error('Error clearing sessions from database', error, 'handleLogout');
    }

    setAccounts([]);
    setCurrentAccount(null);
    setShowNoAccessScreen(false);
    setIsLoginVisible(true);
    addToast('Sesión cerrada correctamente', 'info');
  };

  const checkExistingSession = async () => {
    try {
      const activeSession = await SessionService.getActiveSession();

      if (activeSession) {
        if (SessionService.isSessionExpired(activeSession)) {
          await SessionService.deleteSession(activeSession.username);
          setShowNoAccessScreen(true);
          return;
        }

        if (SessionService.isSessionExpiringSoon(activeSession, 10)) {
          try {
            await SessionService.refreshActiveSession(activeSession.username);
          } catch (refreshError) {
            void logger.error('Session refresh failed', refreshError, 'checkExistingSession');
          }
        }

        const account: Account = {
          id: activeSession.username,
          user: {
            access_token: activeSession.access_token,
            username: activeSession.username,
            uuid: activeSession.uuid,
            user_type: 'microsoft',
            expires_at: activeSession.expires_at
          },
          isActive: true
        };

        setAccounts([account]);
        setCurrentAccount(account);

        try {
          const accessCheck = await WhitelistService.checkAccess(account.user.username);
          if (!accessCheck.has_access) {
            setAccounts([]);
            setCurrentAccount(null);
            setShowNoAccessScreen(true);
            await SessionService.deleteSession(activeSession.username);
            return;
          }
        } catch (whitelistError) {
          void logger.error('Error checking whitelist for existing session', whitelistError, 'checkExistingSession');
          addToast('Advertencia: No se pudo verificar el acceso. Contacta a un administrador si hay problemas.', 'info');
        }
      }
    } catch (error) {
      void logger.error('Error checking existing session', error, 'checkExistingSession');
      const savedAccounts = localStorage.getItem('kkk_accounts');
      const activeAccountId = localStorage.getItem('kkk_active_account');

      if (savedAccounts && activeAccountId) {
        try {
          const accountsData = JSON.parse(savedAccounts);
          setAccounts(accountsData);

          const activeAccount = accountsData.find((acc: Account) => acc.id === activeAccountId);
          if (activeAccount) {
            setCurrentAccount(activeAccount);
          }
        } catch (parseError) {
          void logger.error('Error parsing saved accounts', parseError, 'checkExistingSession');
        }
      }
    }
  };

  const handleMicrosoftAuth = async () => {
    setIsLoading(true);
    setLoaderText("Iniciando sesión...");
    setShowLoader(true);

    try {
      const userSession = await invoke<AuthSession>('start_microsoft_auth');

      const newAccount: Account = {
        id: userSession.username,
        user: userSession,
        isActive: true
      };

      const expiresAt = userSession.expires_at || Math.floor(Date.now() / 1000) + 3600;

      try {
        await SessionService.saveSession(
          userSession.username,
          userSession.uuid,
          userSession.access_token,
          userSession.refresh_token || null,
          expiresAt
        );
        void logger.info(`Session saved successfully for user: ${userSession.username}`, 'handleMicrosoftAuth');
      } catch (sessionError) {
        void logger.error('CRITICAL: Error saving session to database', sessionError, 'handleMicrosoftAuth');
        addToast('Error crítico: No se pudo guardar la sesión. Contacta a soporte.', 'error', 10000);
        setIsLoading(false);
        setShowLoader(false);
        throw sessionError;
      }

      const updatedAccounts = [...accounts.filter(a => a.user.username !== newAccount.user.username), newAccount];
      setCurrentAccount(newAccount);
      setAccounts(updatedAccounts);

      setLoaderText("Verificando acceso...");
      try {
        const whitelistPromise = WhitelistService.checkAccess(userSession.username);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Whitelist timeout')), 8000));
        const accessCheck = await Promise.race([whitelistPromise, timeoutPromise]) as any;

        if (!accessCheck.has_access) {
          await SessionService.deleteSession(userSession.username);
          setShowNoAccessScreen(true);
          setIsLoading(false);
          setShowLoader(false);
          return;
        }

        addToast('Autenticación exitosa.', 'success');
        setIsTransitioning(true);

        setTimeout(() => {
          setIsLoading(false);
          setShowLoader(false);
          setLoaderText("Iniciando sesión...");

          setTimeout(() => {
            setIsTransitioning(false);
          }, 500);
        }, 1000);
        
      } catch (whitelistError) {
        void logger.error('Whitelist check error', whitelistError, 'handleMicrosoftAuth');
        addToast('Error verificando acceso. Inténtalo de nuevo.', 'error');
        setIsLoading(false);
        setShowLoader(false);
      }
      
    } catch (error) {
      void logger.error('Microsoft auth error', error, 'handleMicrosoftAuth');
      addToast('Error en autenticación: ' + error, 'error');
      setIsLoading(false);
      setShowLoader(false);
      setLoaderText("Iniciando sesión...");
      setIsTransitioning(false);
    }
  };




  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-[#0a0a0a] to-black flex relative overflow-hidden">
      {/* No Access Screen - Full screen overlay */}
      {showNoAccessScreen ? (
        <NoAccessScreen 
          onLogout={handleLogout}
          username={currentAccount?.user.username}
        />
      ) : (
        <>
          {currentAccount && (
               <Sidebar
                 instances={filteredInstances.length > 0 ? filteredInstances : (distribution?.instances || [])}
                 localInstances={localInstances}
                 selectedInstance={selectedInstance}
                 onInstanceSelect={handleInstanceSelect}
                 handleSettingsToggle={handleSettingsToggle}
                 handleSkinToggle={handleSkinToggle}
                 distributionBaseUrl={distribution?.distribution.base_url || ''}
                 currentUser={currentAccount.user}
                 settingsOpen={settingsOpen}
                 isAdmin={isAdmin}
                 onCreateLocalInstance={() => setCreateLocalModalOpen(true)}
                 creatingInstanceId={creatingInstanceId}
                 onLocalInstanceDeleted={handleLocalInstanceDeleted}
                 addToast={addToast}
               />
          )}

          <div className={`flex-1 flex flex-col ${currentAccount ? 'ml-20' : ''}`}>
            {accounts.length > 0 && (
              <div className="absolute top-4 right-4 z-50">
                <UserProfile
                  accounts={accounts}
                  currentAccount={currentAccount}
                  onSwitchAccount={handleSwitchAccount}
                  onLogoutAccount={handleLogoutAccount}
                  onAddAccount={handleAddAccount}
                />
              </div>
            )}

                 <main className={`flex-1 relative transition-all duration-500 ease-out ${isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
                  {!currentAccount ? (
                <div className={`flex items-center justify-center h-full transition-all duration-500 ease-out ${isLoginVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                  <div className="text-center group animate-fade-in-up">
                    <div className={`mb-10 transition-all duration-500 delay-200 ${isLoginVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
                      <div className="p-12 inline-block">
                        <img
                          src={kindlyklanLogo}
                          alt="KindlyKlan"
                          className="w-48 h-48 mx-auto transition-all duration-500 group-hover:brightness-110 group-hover:contrast-110 group-hover:drop-shadow-[0_0_40px_rgba(0,255,255,0.4)] group-hover:scale-105 select-none"
                        />
                      </div>
                    </div>
                    <div className={`transition-all duration-500 delay-400 ${isLoginVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                <Button
                        onClick={handleMicrosoftAuth}
                        disabled={isLoading}
                        className="relative glass-light hover:bg-white/10 text-white border-2 border-white/20 hover:border-[#00ffff]/50 
                                 rounded-2xl px-16 py-6 text-2xl font-semibold transition-all duration-300 ease-out 
                                 shadow-2xl hover:shadow-[0_0_30px_rgba(0,255,255,0.3)] group overflow-hidden min-w-[380px] 
                                 cursor-pointer hover:scale-105 neon-glow-cyan-hover"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#00ffff]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        <img src={microsoftIcon} alt="Microsoft" className="w-8 h-8 mr-3 relative z-10" />
                        <span className="relative z-10">Iniciar Sesión</span>
                </Button>
              </div>
            </div>
                </div>
               ) : skinViewOpen ? (
                 <SkinManager
                   currentUser={currentAccount?.user}
                   addToast={addToast}
                 />
               ) : settingsOpen ? (
                 <SettingsView
                   addToast={addToast}
                   scrollToUpdates={scrollToUpdates}
                 />
               ) : !distribution ? (
                <div className="flex items-center justify-center h-full">
                  <Loader text="Cargando distribución..." variant="orbital" showReloadAfter={30} />
            </div>
               ) : showLocalInstancesView ? (
                 <div className="h-full">
                   <LocalInstancesView
                     localInstances={localInstances}
                     selectedInstance={selectedInstance}
                     onInstanceSelect={(instanceId) => {
                       setShowLocalInstancesView(false);
                       setSelectedInstance(instanceId);
                       localStorage.setItem(`last_played_${instanceId}`, Date.now().toString());
                       window.dispatchEvent(new CustomEvent('last_played_updated', { detail: { instanceId } }));
                     }}
                     onLocalInstanceDeleted={handleLocalInstanceDeleted}
                     onOpenFolder={handleOpenFolder}
                     onInstanceRenamed={() => loadLocalInstances()}
                     addToast={addToast}
                   />
                 </div>
               ) : !selectedInstance ? (
                   <div className="relative h-full w-full overflow-hidden">
                     
                     {/* Background - More subtle gradient */}
                     <div className="absolute inset-0 z-0">
                       <div
                         className="w-full h-full"
                         style={{
                           background: 'linear-gradient(135deg, #000000 0%, #0a0a0a 50%, #000000 100%)'
                         }}
                       />
                     </div>

                     {/* Subtle neon accents in background */}
                     <div className="absolute inset-0 z-5 opacity-10">
                       <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#00ffff] rounded-full blur-3xl"></div>
                       <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#ff00ff] rounded-full blur-3xl"></div>
                     </div>

                     {/* Overlay */}
                     <div className="absolute inset-0 bg-black/60 z-10" />

                     {/* Content */}
                     <div className="relative z-20 h-full flex flex-col">
                       <div className={`flex-1 flex items-center justify-center p-8 transition-all duration-500 ease-out delay-200 ${logoVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'}`}>
                         <div className="text-center group animate-scale-in">
                           <div className="p-16 inline-block">
                             <img 
                               src={kindlyklanLogo} 
                               alt="KindlyKlan" 
                               className="w-64 h-64 mx-auto transition-all duration-500 group-hover:brightness-110 group-hover:contrast-110 group-hover:drop-shadow-[0_0_50px_rgba(0,255,255,0.5)] group-hover:scale-105"
                             />
                           </div>
                         </div>
                       </div>
                     </div>
                   </div>
               ) : (
                 <div className="h-full">
                   <InstanceView
                     instanceId={selectedInstance}
                     distribution={distribution}
                     distributionBaseUrl={distribution.distribution.base_url}
                     isJavaInstalling={showLoader || isDownloadingAssets}
                     localInstance={localInstances.find(li => li.id === selectedInstance)}
                     isLocal={localInstances.some(li => li.id === selectedInstance)}
                     onSyncMods={handleSyncMods}
                     onOpenFolder={handleOpenFolder}
                     onDownloadMods={handleDownloadMods}
                     onCopyFolders={handleCopyFolders}
                     onLaunch={async (instance) => {
                       if (isDownloadingAssets) {
                         setLoaderText("Descargando assets de instancia...");
                       } else {
                         setLoaderText("Iniciando instancia...");
                       }
                       setShowLoader(true);

                       const isLocalInstance = localInstances.some(li => li.id === selectedInstance);
                       
                       if (isLocalInstance) {
                         try {
                           const localInst = localInstances.find(li => li.id === selectedInstance);
                           if (!localInst) throw new Error('Local instance not found');

                           const [minRam, maxRam] = await invoke<[number, number]>('load_ram_config');

                           await invoke('launch_local_instance', {
                             instanceId: localInst.id,
                             accessToken: currentAccount.user.access_token,
                             username: currentAccount.user.username,
                             uuid: currentAccount.user.uuid,
                             minRamGb: minRam,
                             maxRamGb: maxRam,
                           });
                           
                           setShowLoader(false);
                           setLoaderText("Iniciando sesión...");
                           addToast('Minecraft iniciado exitosamente', 'success');
                         } catch (error) {
                           void logger.error('Error launching local instance', error, 'onLaunch');
                           addToast(`Error al iniciar instancia: ${error}`, 'error');
                           setShowLoader(false);
                           setLoaderText("Iniciando sesión...");
                         }
                       } else {
                       await launchInstance(
                         instance,
                         currentAccount,
                         addToast,
                         () => {
                           setShowLoader(false);
                           setLoaderText("Iniciando sesión...");
                         },
                         setIsDownloadingAssets,
                         setDownloadProgress,
                         () => {
                           setCurrentAccount(null);
                           setIsLoginVisible(true);
                        },
                        distribution?.distribution.base_url,
                        instance.instance_url
                       );
                       }
                     }}
                   />
          </div>
        )}
             </main>
      </div>


      {showLoader && (
        <div className={`blur-overlay transition-all duration-500 ${isTransitioning ? 'opacity-0 scale-110' : 'opacity-100 scale-100'}`}>
          <Loader text={loaderText} />
        </div>
      )}

      <div className="pointer-events-none fixed bottom-4 right-4 z-[10000] flex flex-col gap-2">
        <div className="pointer-events-auto flex flex-col gap-2">
          {downloadProgress && (
            <DownloadProgressToast
              message={downloadProgress.status === 'Completed' ? 'Assets descargados' : 'Descargando assets de instancia'}
              percentage={downloadProgress.percentage}
              onClose={() => setDownloadProgress(null)}
            />
          )}
          {updateDownloadProgress !== null && updateDownloadVersion && (
            <DownloadProgressToast
              message="Descargando nueva actualización"
              percentage={updateDownloadProgress}
              onClose={() => {
                setUpdateDownloadProgress(null);
                setUpdateDownloadVersion(null);
              }}
            />
          )}
          {updateReadyVersion && (
            <UpdateReadyToast
              message="Nueva actualización lista para instalar"
              version={updateReadyVersion}
              onClose={() => setUpdateReadyVersion(null)}
              onClick={() => {
                setScrollToUpdates(true);
                setSettingsOpen(true);
                setSelectedInstance(null);
                setSkinViewOpen(false);
              }}
            />
          )}
        </div>
      </div>
      <Toaster position="bottom-right" theme="dark" duration={5000} />

      {/* Update Dialog */}
      {updateDialogOpen && updateDialogState && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
          style={{
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setUpdateDialogOpen(false);
            }
          }}
        >
          <div 
            className="rounded-3xl p-10 max-w-md w-full mx-4 animate-slide-up"
            style={{
              background: updateDialogState.isDownloadReady
                ? 'linear-gradient(145deg, rgba(17, 24, 39, 0.98) 0%, rgba(31, 41, 55, 0.95) 100%)'
                : 'linear-gradient(145deg, rgba(17, 24, 39, 0.98) 0%, rgba(31, 41, 55, 0.95) 100%)',
              backdropFilter: 'blur(32px)',
              WebkitBackdropFilter: 'blur(32px)',
              boxShadow: updateDialogState.isDownloadReady
                ? '0 25px 80px -12px rgba(34, 197, 94, 0.5), 0 0 0 1px rgba(34, 197, 94, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
                : '0 25px 80px -12px rgba(59, 130, 246, 0.5), 0 0 0 1px rgba(59, 130, 246, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
              border: updateDialogState.isDownloadReady
                ? '1px solid rgba(34, 197, 94, 0.25)'
                : '1px solid rgba(59, 130, 246, 0.25)'
            }}
          >
            <div className="text-center">
              <div 
                className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 animate-scale-in"
                style={{
                  animationDelay: '0.1s',
                  animationFillMode: 'both',
                  background: updateDialogState.isDownloadReady
                    ? 'radial-gradient(circle, rgba(34, 197, 94, 0.25) 0%, rgba(34, 197, 94, 0.1) 100%)'
                    : 'radial-gradient(circle, rgba(59, 130, 246, 0.25) 0%, rgba(59, 130, 246, 0.1) 100%)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: updateDialogState.isDownloadReady
                    ? '2px solid rgba(34, 197, 94, 0.4)'
                    : '2px solid rgba(59, 130, 246, 0.4)',
                  boxShadow: updateDialogState.isDownloadReady
                    ? '0 0 30px rgba(34, 197, 94, 0.3), inset 0 0 20px rgba(34, 197, 94, 0.1)'
                    : '0 0 30px rgba(59, 130, 246, 0.3), inset 0 0 20px rgba(59, 130, 246, 0.1)'
                }}
              >
                <svg 
                  className={`w-10 h-10 ${updateDialogState.isDownloadReady ? 'text-green-400' : 'text-blue-400'}`} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                  style={{
                    filter: updateDialogState.isDownloadReady
                      ? 'drop-shadow(0 0 8px rgba(34, 197, 94, 0.6))'
                      : 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.6))'
                  }}
                >
                  {updateDialogState.isDownloadReady ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  )}
                </svg>
              </div>
              
              {updateDialogState.isDownloadReady ? (
                <>
                  <h3 className="text-3xl font-bold text-white mb-3 animate-fade-in-up" style={{ animationDelay: '0.2s', animationFillMode: 'both' }}>
                    Actualización Lista
                  </h3>
                  <p className="text-white/70 mb-8 leading-relaxed animate-fade-in-up" style={{ animationDelay: '0.3s', animationFillMode: 'both' }}>
                    Hay una actualización descargada y lista para instalar. La aplicación se reiniciará después de la instalación.
                  </p>
                  
                  <div className="flex gap-4 justify-center animate-fade-in-up" style={{ animationDelay: '0.4s', animationFillMode: 'both' }}>
                    <button
                      onClick={async () => {
                        setUpdateDialogOpen(false);
                        await new Promise(resolve => setTimeout(resolve, 200));
                        try {
                          const result = await UpdaterService.installUpdate();
                          if (result.success) {
                            addToast('Actualización instalada. La aplicación se reiniciará.', 'success');
                          } else {
                            addToast('Error al instalar la actualización', 'error');
                          }
                        } catch (error) {
                          addToast('Error al instalar la actualización', 'error');
                        }
                      }}
                      className="px-8 py-3.5 rounded-xl font-semibold text-green-100 transition-all duration-300 hover:scale-105 active:scale-95"
                      style={{
                        background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(22, 163, 74, 0.15) 100%)',
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)',
                        border: '1.5px solid rgba(34, 197, 94, 0.4)',
                        boxShadow: '0 4px 20px rgba(34, 197, 94, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.3) 0%, rgba(22, 163, 74, 0.25) 100%)';
                        e.currentTarget.style.boxShadow = '0 8px 30px rgba(34, 197, 94, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)';
                        e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.6)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(22, 163, 74, 0.15) 100%)';
                        e.currentTarget.style.boxShadow = '0 4px 20px rgba(34, 197, 94, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.4)';
                      }}
                    >
                      Instalar Ahora
                    </button>
                  </div>
                </>
              ) : updateDialogState.hasUpdateAvailable ? (
                <>
                  <h3 className="text-3xl font-bold text-white mb-3 animate-fade-in-up" style={{ animationDelay: '0.2s', animationFillMode: 'both' }}>
                    Actualización Disponible
                  </h3>
                  <p className="text-white/70 mb-8 leading-relaxed animate-fade-in-up" style={{ animationDelay: '0.3s', animationFillMode: 'both' }}>
                    Hay una nueva versión disponible ({updateDialogState.version}). ¿Quieres descargarla ahora?
                  </p>
                  
                  <div className="flex gap-4 justify-center animate-fade-in-up" style={{ animationDelay: '0.4s', animationFillMode: 'both' }}>
                    <button
                      onClick={async () => {
                        setUpdateDialogOpen(false);
                        await new Promise(resolve => setTimeout(resolve, 200));
                        try {
                          const result = await UpdaterService.downloadUpdateSilent(false);
                          if (result.success) {
                            addToast('Actualización descargada correctamente', 'success');
                            const newState = await UpdaterService.getUpdateState();
                            if (newState.download_ready) {
                              setUpdateDialogState({ isDownloadReady: true, hasUpdateAvailable: false, version: newState.available_version });
                              setTimeout(() => setUpdateDialogOpen(true), 500);
                            }
                          } else {
                            addToast('Error al descargar la actualización', 'error');
                          }
                        } catch (error) {
                          addToast('Error al descargar la actualización', 'error');
                        }
                      }}
                      className="px-8 py-3.5 rounded-xl font-semibold text-blue-100 transition-all duration-300 hover:scale-105 active:scale-95"
                      style={{
                        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(37, 99, 235, 0.15) 100%)',
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)',
                        border: '1.5px solid rgba(59, 130, 246, 0.4)',
                        boxShadow: '0 4px 20px rgba(59, 130, 246, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(37, 99, 235, 0.25) 100%)';
                        e.currentTarget.style.boxShadow = '0 8px 30px rgba(59, 130, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)';
                        e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.6)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(37, 99, 235, 0.15) 100%)';
                        e.currentTarget.style.boxShadow = '0 4px 20px rgba(59, 130, 246, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.4)';
                      }}
                    >
                      Descargar
                    </button>
                    
                    <button
                      onClick={() => setUpdateDialogOpen(false)}
                      className="px-8 py-3.5 rounded-xl font-semibold text-gray-100 transition-all duration-300 hover:scale-105 active:scale-95"
                      style={{
                        background: 'linear-gradient(135deg, rgba(107, 114, 128, 0.15) 0%, rgba(75, 85, 99, 0.1) 100%)',
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)',
                        border: '1.5px solid rgba(107, 114, 128, 0.3)',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(107, 114, 128, 0.25) 0%, rgba(75, 85, 99, 0.2) 100%)';
                        e.currentTarget.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.borderColor = 'rgba(107, 114, 128, 0.5)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(107, 114, 128, 0.15) 0%, rgba(75, 85, 99, 0.1) 100%)';
                        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)';
                        e.currentTarget.style.borderColor = 'rgba(107, 114, 128, 0.3)';
                      }}
                    >
                      Más Tarde
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Diálogo de confirmación de cierre durante descarga */}
      {closeDialogOpen && (
          <div 
          className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
            style={{
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setCloseDialogOpen(false);
            }
          }}
        >
          <div 
            className="rounded-3xl p-10 max-w-md w-full mx-4 animate-slide-up"
            style={{
              background: 'linear-gradient(145deg, rgba(17, 24, 39, 0.98) 0%, rgba(31, 41, 55, 0.95) 100%)',
              backdropFilter: 'blur(32px)',
              WebkitBackdropFilter: 'blur(32px)',
              boxShadow: '0 25px 80px -12px rgba(234, 88, 12, 0.5), 0 0 0 1px rgba(234, 88, 12, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(234, 88, 12, 0.25)'
            }}
          >
            <div className="text-center">
              <div 
                className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 animate-scale-in"
                style={{
                  animationDelay: '0.1s',
                  animationFillMode: 'both',
                  background: 'radial-gradient(circle, rgba(234, 88, 12, 0.25) 0%, rgba(234, 88, 12, 0.1) 100%)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '2px solid rgba(234, 88, 12, 0.4)',
                  boxShadow: '0 0 30px rgba(234, 88, 12, 0.3), inset 0 0 20px rgba(234, 88, 12, 0.1)'
                }}
              >
                <svg 
                  className="w-10 h-10 text-orange-400" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                  style={{
                    filter: 'drop-shadow(0 0 8px rgba(234, 88, 12, 0.6))'
                  }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              
              <h3 className="text-3xl font-bold text-white mb-3 animate-fade-in-up" style={{ animationDelay: '0.2s', animationFillMode: 'both' }}>
                Descarga en progreso
              </h3>
              <p className="text-white/70 mb-8 leading-relaxed animate-fade-in-up" style={{ animationDelay: '0.3s', animationFillMode: 'both' }}>
                Hay una descarga en progreso. Si cierras la aplicación ahora, la descarga se cancelará. ¿Estás seguro de que quieres cerrar?
              </p>
              
              <div className="flex gap-4 justify-center animate-fade-in-up" style={{ animationDelay: '0.4s', animationFillMode: 'both' }}>
                <button
                  onClick={async () => {
                    setCloseDialogOpen(false);
                    await new Promise(resolve => setTimeout(resolve, 200));
                    await invoke('set_downloading_state', { isDownloading: false });
                    const { getCurrentWindow } = await import('@tauri-apps/api/window');
                    await getCurrentWindow().close();
                  }}
                  className="px-8 py-3.5 rounded-xl font-semibold text-red-100 transition-all duration-300 hover:scale-105 active:scale-95"
                  style={{
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(185, 28, 28, 0.15) 100%)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: '1.5px solid rgba(239, 68, 68, 0.4)',
                    boxShadow: '0 4px 20px rgba(239, 68, 68, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.3) 0%, rgba(185, 28, 28, 0.25) 100%)';
                    e.currentTarget.style.boxShadow = '0 8px 30px rgba(239, 68, 68, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)';
                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.6)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(185, 28, 28, 0.15) 100%)';
                    e.currentTarget.style.boxShadow = '0 4px 20px rgba(239, 68, 68, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                  }}
                >
                  Cerrar
                </button>
                
                <button
                  onClick={() => setCloseDialogOpen(false)}
                  className="px-8 py-3.5 rounded-xl font-semibold text-gray-100 transition-all duration-300 hover:scale-105 active:scale-95"
                  style={{
                    background: 'linear-gradient(135deg, rgba(107, 114, 128, 0.15) 0%, rgba(75, 85, 99, 0.1) 100%)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: '1.5px solid rgba(107, 114, 128, 0.3)',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(107, 114, 128, 0.25) 0%, rgba(75, 85, 99, 0.2) 100%)';
                    e.currentTarget.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(107, 114, 128, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(107, 114, 128, 0.15) 0%, rgba(75, 85, 99, 0.1) 100%)';
                    e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.borderColor = 'rgba(107, 114, 128, 0.3)';
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de creación de instancia local */}
      <CreateLocalInstanceModal
        isOpen={createLocalModalOpen}
        onClose={() => setCreateLocalModalOpen(false)}
        onInstanceCreated={handleCreateLocalInstance}
      />

      {/* Modal de sincronización de mods */}
      {syncModsModalOpen && distribution && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div 
            className="glass-card rounded-3xl border border-white/10 p-8 max-w-2xl w-full shadow-2xl"
            style={{
              background: 'rgba(10, 10, 10, 0.95)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
            }}
          >
            <h2 className="text-3xl font-bold text-white mb-4">
              Sincronizar Mods
            </h2>
            <p className="text-white/60 mb-6">
              Selecciona una instancia remota para copiar sus mods a esta instancia local
            </p>

            <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar mb-6">
              {filteredInstances.map((instance) => (
                <button
                  key={instance.id}
                  onClick={() => handleSyncModsConfirm(instance.id)}
                  className="w-full p-4 rounded-xl bg-white/5 border border-white/10 text-left hover:bg-white/10 hover:border-[#00ffff]/30 transition-all duration-200 group"
                >
                  <div className="flex items-center gap-4">
                    {instance.icon && (
                      <img
                        src={`${distribution.distribution.base_url}/${instance.icon}`}
                        alt={instance.name}
                        className="w-12 h-12 rounded-lg"
                      />
                    )}
                    <div className="flex-1">
                      <h3 className="text-white font-bold group-hover:text-[#00ffff] transition-colors">
                        {instance.name}
                      </h3>
                      <p className="text-white/60 text-sm">
                        Minecraft {instance.minecraft_version} • {instance.version}
                      </p>
                    </div>
                    <svg 
                      className="w-6 h-6 text-white/40 group-hover:text-[#00ffff] transition-colors" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => {
                  setSyncModsModalOpen(false);
                  setSyncingLocalId(null);
                }}
                className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all duration-200"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modrinth Search Modal */}
      {modrinthModalOpen && modrinthInstanceId && (
        <ModrinthSearchModal
          isOpen={modrinthModalOpen}
          onClose={() => {
            setModrinthModalOpen(false);
            setModrinthInstanceId(null);
          }}
          instanceId={modrinthInstanceId}
          minecraftVersion={
            localInstances.find(li => li.id === modrinthInstanceId)?.minecraft_version || '1.21.1'
          }
          loader={
            localInstances.find(li => li.id === modrinthInstanceId)?.fabric_version 
              ? 'fabric' 
              : 'fabric'
          }
          onModDownloaded={() => {
            addToast('Mod descargado correctamente', 'success');
          }}
          addToast={addToast}
        />
      )}

      {/* Copy Folders Modal */}
      {copyFoldersModalOpen && copyFoldersInstanceId && (
        <CopyFoldersModal
          isOpen={copyFoldersModalOpen}
          onClose={() => {
            setCopyFoldersModalOpen(false);
            setCopyFoldersInstanceId(null);
          }}
          targetInstanceId={copyFoldersInstanceId}
          localInstances={localInstances}
          remoteInstances={filteredInstances.length > 0 ? filteredInstances : (distribution?.instances || [])}
          onFoldersCopied={() => {
            addToast('Carpetas copiadas correctamente', 'success');
          }}
          addToast={addToast}
        />
      )}
        </>
      )}
    </div>
  );
}

export default App;
