import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageUp, Info, Pencil, Plus, Save, UploadCloud, X } from 'lucide-react';
import { SkinPreviewRenderer } from './SkinPreviewRenderer';
import { releaseTexture } from '@/lib/skin-rendering/skin-rendering';
import { SkinData, SkinModel, CapeData } from '@/types/skin';
import { SkinStorageService } from '@/services/skin/skinStorage';
import { getBestSkinTextureUrl } from '@/services/avatarService';
import { invoke } from '@tauri-apps/api/core';
import { useDropzone } from 'react-dropzone';
import { logger } from '@/utils/logger';
import { translateBackendError } from '@/i18n';
import AppBackground from '@/components/AppBackground';

interface SkinManagerProps {
  currentUser: any;
  addToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
}

interface MojangSkin {
  id: string;
  state: string;
  url: string;
  variant: 'CLASSIC' | 'SLIM';
}

interface EnsureSessionResponse {
  status: string;
  data?: {
    session: {
      access_token: string;
      refresh_token: string | null;
      expires_at: number;
    };
    refreshed: boolean;
  };
  code?: string;
  message?: string;
}

interface ProfileResponse {
  status: string;
  profile?: any;
  code?: string;
  message?: string;
}

// In-memory cache (lives as long as the app is open) to avoid showing the capes
// spinner again every time the skins tab is entered during the same launcher session.
const capesSessionCache: Record<string, CapeData[]> = {};


const CAPE_SPRITE_SCALE = 6;
const CAPE_SPRITE_WIDTH = 10 * CAPE_SPRITE_SCALE;
const CAPE_SPRITE_HEIGHT = 16 * CAPE_SPRITE_SCALE;

const CapeSprite: React.FC<{ url: string; alt: string }> = ({ url, alt }) => (
  <div
    role="img"
    aria-label={alt}
    style={{
      width: CAPE_SPRITE_WIDTH,
      height: CAPE_SPRITE_HEIGHT,
      backgroundImage: `url(${url})`,
      backgroundSize: `${64 * CAPE_SPRITE_SCALE}px ${32 * CAPE_SPRITE_SCALE}px`,
      backgroundPosition: `-${1 * CAPE_SPRITE_SCALE}px -${1 * CAPE_SPRITE_SCALE}px`,
      backgroundRepeat: 'no-repeat',
      imageRendering: 'pixelated',
    }}
  />
);


const refreshAvatars = () => {
  const timestamp = Date.now();

  document
    .querySelectorAll('img[src*="minotar.net"], img[src*="mc-heads.net"]')
    .forEach((img: any) => {
    try {
      const url = new URL(img.src);
      url.searchParams.set('t', timestamp.toString());
      img.src = url.toString();
    } catch (e) {
      const separator = img.src.includes('?') ? '&' : '?';
      img.src = `${img.src}${separator}t=${timestamp}`;
    }
  });
};

export const SkinManager: React.FC<SkinManagerProps> = ({ currentUser, addToast }) => {
  const { t } = useTranslation('skins');
  const { t: tCommon } = useTranslation('common');
  const [skins, setSkins] = useState<SkinData[]>([]);
  const [selectedSkinId, setSelectedSkinId] = useState<string | null>(null);
  const [externalActiveSkin, setExternalActiveSkin] = useState<SkinData | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isImportingExternal, setIsImportingExternal] = useState(false);
  const hasInitialized = useRef(false);
  const blobUrlsRef = useRef<Map<string, string>>(new Map());
  const skinsRef = useRef<SkinData[]>([]);
  const selectedSkinIdRef = useRef<string | null>(null);

  useEffect(() => { skinsRef.current = skins; }, [skins]);
  useEffect(() => { selectedSkinIdRef.current = selectedSkinId; }, [selectedSkinId]);

  const [capes, setCapes] = useState<CapeData[]>([]);
  const [isLoadingCapes, setIsLoadingCapes] = useState(false);
  const [isUpdatingCape, setIsUpdatingCape] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [pendingVariant, setPendingVariant] = useState<SkinModel>('classic');
  const [pendingCapeId, setPendingCapeId] = useState<string>('none');
  const [pendingTextureFile, setPendingTextureFile] = useState<File | null>(null);
  const [pendingTexturePreviewUrl, setPendingTexturePreviewUrl] = useState<string | null>(null);
  const [isSavingEdits, setIsSavingEdits] = useState(false);

  // The skin actually equipped right now: an external (unsaved) skin takes priority
  // over the local library, since it reflects the true current state on Mojang.
  const activeSkin = externalActiveSkin ?? skins.find((s) => s.id === selectedSkinId);
  const hasActiveCape = capes.some((c) => c.state === 'ACTIVE');
  const activeCape = capes.find((c) => c.state === 'ACTIVE');

  const buildExternalSkinFromMojang = useCallback((mojangSkin: MojangSkin): SkinData => ({
    id: `external_${mojangSkin.id || mojangSkin.url}`,
    name: t('currentSkinName'),
    url: mojangSkin.url,
    textureId: mojangSkin.id,
    variant: mojangSkin.variant === 'SLIM' ? 'slim' : 'classic',
    uploadedAt: new Date(),
    isActive: true,
    isMojangSynced: true,
    isExternal: true,
  }), []);

  const getSkinUrl = useCallback((skin: SkinData): string => {
    if (blobUrlsRef.current.has(skin.id)) {
      return blobUrlsRef.current.get(skin.id)!;
    }

    if (skin.fileData && skin.fileData instanceof ArrayBuffer && skin.fileData.byteLength > 0) {
      try {
        const uint8Array = new Uint8Array(skin.fileData);
        const buffer = new ArrayBuffer(uint8Array.length);
        const view = new Uint8Array(buffer);
        view.set(uint8Array);
        const blob = new Blob([buffer], { type: 'image/png' });
        const blobUrl = URL.createObjectURL(blob);
        blobUrlsRef.current.set(skin.id, blobUrl);
        return blobUrl;
      } catch (err) {
        // continue
      }
    }

    if (skin.url && skin.url.trim() !== '') {
      return skin.url;
    }

    return currentUser?.uuid ? getBestSkinTextureUrl(currentUser.uuid) : '';
  }, [currentUser?.uuid]);

  const lastUploadTimeRef = useRef<number>(0);
  const MIN_UPLOAD_INTERVAL = 2000;

  const tokenRequestRef = useRef<Promise<string | null> | null>(null);
  const getValidMinecraftToken = useCallback(async (): Promise<string | null> => {
    if (tokenRequestRef.current) {
      return tokenRequestRef.current;
    }

    const requestPromise = (async () => {
      try {
        if (currentUser?.access_token && currentUser?.username) {
          const sessionResponse: EnsureSessionResponse = await invoke('ensure_valid_session', {
            username: currentUser.username
          });

          if (sessionResponse.status === 'Ok' && sessionResponse.data?.session) {
            return sessionResponse.data.session.access_token;
          }
        }

        const savedSession = localStorage.getItem('valthorne_session');
        if (savedSession) {
          try {
            const session = JSON.parse(savedSession);
            if (session?.username) {
              const sessionResponse: EnsureSessionResponse = await invoke('ensure_valid_session', {
                username: session.username
              });

              if (sessionResponse.status === 'Ok' && sessionResponse.data?.session) {
                return sessionResponse.data.session.access_token;
              }
            }
          } catch (parseError) {
            // ignore
          }
        }

        return null;
      } catch (error) {
        console.error('❌ Error getting token:', error);
        return null;
      } finally {
        setTimeout(() => {
          tokenRequestRef.current = null;
        }, 5000);
      }
    })();

    tokenRequestRef.current = requestPromise;
    return requestPromise;
  }, [currentUser]);

  const loadCapes = useCallback(async () => {
    const cacheKey = currentUser?.uuid || currentUser?.username;
    const cached = cacheKey ? capesSessionCache[cacheKey] : undefined;

    // If we already loaded this account's capes in this launcher session, they are shown
    // instantly (without a spinner) while they refresh in the background.
    if (cached) {
      setCapes(cached);
    } else {
      setIsLoadingCapes(true);
    }

    try {
      const accessToken = await getValidMinecraftToken();
      if (!accessToken) {
        if (!cached) setCapes([]);
        return;
      }

      const playerCapes = await invoke<CapeData[]>('get_player_capes', { accessToken });
      setCapes(playerCapes || []);
      if (cacheKey) capesSessionCache[cacheKey] = playerCapes || [];

      const active = (playerCapes || []).find((c) => c.state === 'ACTIVE');
      SkinStorageService.setLocalActiveCapeId(active?.id ?? null);
    } catch (error) {
      void logger.warn('Error loading capes', String(error), 'SkinManager');
      if (!cached) setCapes([]);
    } finally {
      setIsLoadingCapes(false);
    }
  }, [getValidMinecraftToken, currentUser?.uuid, currentUser?.username]);

  // Single source of truth for "what does Mojang actually say is equipped right now".
  // Reconciles both the left preview and the right library's selection against it, so
  // they can never disagree - whether the mismatch came from this app or from an
  // external change (minecraft.net, another launcher).
  const syncEquippedSkinFromMojang = useCallback(async () => {
    const accessToken = await getValidMinecraftToken();
    if (!accessToken) return;

    const profileResponse = await invoke<ProfileResponse>('get_minecraft_profile_safe', { accessToken });
    if (profileResponse.status !== 'Ok' || !profileResponse.profile) return;

    const profile = profileResponse.profile as any;
    const mojangSkins = profile.skins || [];
    const activeMojangSkin = mojangSkins.find((s: MojangSkin) => s.state === 'ACTIVE');

    if (!activeMojangSkin) {
      setExternalActiveSkin(null);
      if (selectedSkinIdRef.current) {
        await SkinStorageService.setActiveSkin('');
        setSelectedSkinId(null);
        refreshAvatars();
      }
    } else {
      const matchingLocalSkin = skinsRef.current.find((skin) =>
        (skin.url && skin.url === activeMojangSkin.url) ||
        (skin.textureId && skin.textureId === activeMojangSkin.id)
      );

      if (matchingLocalSkin) {
        setExternalActiveSkin(null);
        if (selectedSkinIdRef.current !== matchingLocalSkin.id) {
          await SkinStorageService.setActiveSkin(matchingLocalSkin.id);
          setSelectedSkinId(matchingLocalSkin.id);
          refreshAvatars();
        }
      } else {
        setExternalActiveSkin(buildExternalSkinFromMojang(activeMojangSkin));
        if (selectedSkinIdRef.current) {
          await SkinStorageService.setActiveSkin('');
          setSelectedSkinId(null);
          refreshAvatars();
        }
      }
    }

    const mojangCapes = profile.capes || [];
    const activeMojangCape = mojangCapes.find((c: CapeData) => c.state === 'ACTIVE');
    const localActiveCapeId = SkinStorageService.getLocalActiveCapeId();
    if ((activeMojangCape?.id ?? null) !== localActiveCapeId) {
      setCapes(mojangCapes);
      SkinStorageService.setLocalActiveCapeId(activeMojangCape?.id ?? null);
    }
  }, [getValidMinecraftToken, buildExternalSkinFromMojang]);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    let syncInterval: ReturnType<typeof setInterval> | null = null;

    const initializeSkins = async () => {
      try {
        const savedSkins = await SkinStorageService.getStoredSkins();
        const activeSkin = await SkinStorageService.getActiveSkin();

        savedSkins.forEach(skin => {
          if (skin.fileData && skin.fileData instanceof ArrayBuffer && skin.fileData.byteLength > 0) {
            if (!blobUrlsRef.current.has(skin.id)) {
              try {
                const uint8Array = new Uint8Array(skin.fileData);
                const buffer = new ArrayBuffer(uint8Array.length);
                const view = new Uint8Array(buffer);
                view.set(uint8Array);
                const blob = new Blob([buffer], { type: 'image/png' });
                const blobUrl = URL.createObjectURL(blob);
                blobUrlsRef.current.set(skin.id, blobUrl);
              } catch (err) {
                void logger.error(`Error creating blob URL for skin ${skin.id}`, err, 'SkinManager');
              }
            }
          }
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        setSkins([...savedSkins]);
        setSelectedSkinId(activeSkin?.id || null);
        skinsRef.current = savedSkins;
        selectedSkinIdRef.current = activeSkin?.id || null;
        setIsLoadingInitial(false);

        void loadCapes();
        void syncEquippedSkinFromMojang();

        syncInterval = setInterval(() => {
          void syncEquippedSkinFromMojang();
        }, 30000);
      } catch (error) {
        console.error('❌ Error loading skins from localStorage:', error);
        addToast?.(t('toast.loadFailed'), 'error');
        setIsLoadingInitial(false);
      }
    };

    void initializeSkins();

    return () => {
      hasInitialized.current = false;
      if (syncInterval) clearInterval(syncInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addToast]);

  const handleUploadSkin = useCallback(async (file: File) => {
    if (!file) return;

    if (file.type !== 'image/png') {
      addToast?.(t('toast.onlyPng'), 'error');
      return;
    }

    if (file.size > 24 * 1024) {
      addToast?.(t('toast.tooLarge'), 'error');
      return;
    }

    setIsUploading(true);

    try {
      const fileData = await file.arrayBuffer();
      const uint8Array = new Uint8Array(fileData);
      const buffer = new ArrayBuffer(uint8Array.length);
      const view = new Uint8Array(buffer);
      view.set(uint8Array);
      const blob = new Blob([buffer], { type: 'image/png' });
      const blobUrl = URL.createObjectURL(blob);

      const newSkin: SkinData = {
        id: `skin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: file.name.replace('.png', ''),
        fileData: buffer,
        url: '',
        textureId: '',
        variant: 'classic',
        uploadedAt: new Date(),
        isActive: false,
        isMojangSynced: false
      };

      await SkinStorageService.saveSkin(newSkin);
      blobUrlsRef.current.set(newSkin.id, blobUrl);

      const updatedSkins = await SkinStorageService.getStoredSkins();
      setSkins([...updatedSkins]);

      addToast?.(t('toast.saved'), 'success');
    } catch (error) {
      void logger.error('Error saving skin', error, 'SkinManager');
      addToast?.(t('toast.uploadFailed', { message: translateBackendError(error) || tCommon('unknownError') }), 'error');
    } finally {
      setIsUploading(false);
    }
  }, [addToast]);

  const getSkinWithFileData = useCallback(async (skinId: string): Promise<SkinData | null> => {
    const allSkins = await SkinStorageService.getStoredSkins();
    return allSkins.find(s => s.id === skinId) || null;
  }, []);

  const getSkinFileData = useCallback(async (skin: SkinData): Promise<ArrayBuffer> => {
    try {
      const fileDataArray = await invoke<number[]>('load_skin_file', { skinId: skin.id });
      const uint8Array = new Uint8Array(fileDataArray);
      const buffer = new ArrayBuffer(uint8Array.length);
      const view = new Uint8Array(buffer);
      view.set(uint8Array);
      return buffer;
    } catch (err) {
      // continuar
    }

    if (skin.fileData && skin.fileData instanceof ArrayBuffer && skin.fileData.byteLength > 0) {
      await SkinStorageService.saveSkin(skin);
      return skin.fileData;
    }

    if (skin.url && skin.url.trim() !== '') {
      const response = await fetch(skin.url);
      if (!response.ok) {
        throw new Error(`No se pudo descargar la skin desde la URL (${response.status})`);
      }
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      const updatedSkin = { ...skin, fileData: arrayBuffer };
      await SkinStorageService.saveSkin(updatedSkin);

      return arrayBuffer;
    }

    throw new Error(`La skin "${skin.name || skin.id}" no tiene datos disponibles. Por favor, vuelve a subirla.`);
  }, []);

  const handleSelectSkin = useCallback(async (skin: SkinData) => {
    if (isUploading || (!externalActiveSkin && selectedSkinId === skin.id)) return;

    // Optimistically resolve the "which skin is active" mismatch immediately - don't wait
    // for the next periodic Mojang sync to clear the external-skin card.
    setExternalActiveSkin(null);
    await SkinStorageService.setActiveSkin(skin.id);
    setSelectedSkinId(skin.id);

    const allSkins = await SkinStorageService.getStoredSkins();
    setSkins([...allSkins]);

    refreshAvatars();
    addToast?.(t('toast.applied'), 'success');
    setIsUploading(true);

    const timeSinceLastUpload = Date.now() - lastUploadTimeRef.current;
    if (timeSinceLastUpload < MIN_UPLOAD_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_UPLOAD_INTERVAL - timeSinceLastUpload));
    }

    try {
      const fileData = await getSkinFileData(skin);

      const accessToken = await getValidMinecraftToken();
      if (!accessToken) {
        setIsUploading(false);
        return;
      }

      const tempFilePath = await invoke<string>('create_temp_file', {
        fileName: `skin_${Date.now()}.png`,
        fileData: Array.from(new Uint8Array(fileData))
      });

      const currentStoredSkin = await getSkinWithFileData(skin.id);
      const variant = currentStoredSkin?.variant || skin.variant || 'classic';

      lastUploadTimeRef.current = Date.now();
      try {
        await invoke('upload_skin_to_mojang', {
          filePath: tempFilePath,
          variant: variant,
          accessToken
        });

        try {
          const profileResponse = await invoke<ProfileResponse>('get_minecraft_profile_safe', {
            accessToken
          });
          if (profileResponse.status === 'Ok' && profileResponse.profile) {
            const profile = profileResponse.profile as any;
            const mojangSkins = profile.skins || [];
            const activeMojangSkin = mojangSkins.find((s: MojangSkin) => s.state === 'ACTIVE');
            if (activeMojangSkin) {
              const updatedSkin: SkinData = {
                ...(currentStoredSkin || skin),
                fileData: fileData,
                url: activeMojangSkin.url || skin.url || '',
                textureId: activeMojangSkin.id || skin.textureId || '',
                isMojangSynced: true
              };
              await SkinStorageService.saveSkin(updatedSkin);

              const updatedSkins = await SkinStorageService.getStoredSkins();
              setSkins([...updatedSkins]);
            }
          }
        } catch (err) {
          // ignorar
        }
      } catch (uploadError: any) {
        if (uploadError?.message?.includes('429') || uploadError?.message?.includes('rate limit')) {
          addToast?.(t('toast.rateLimited'), 'info');
        } else if (uploadError?.message?.includes('401') || uploadError?.message?.includes('Unauthorized')) {
          addToast?.(t('toast.sessionExpiredLocal'), 'info');
        } else {
          void logger.warn('Error uploading to Mojang (skin active locally)', uploadError, 'SkinManager');
        }
      }
    } catch (error) {
      void logger.warn('Error processing skin for Mojang (skin active locally)', String(error), 'SkinManager');
    } finally {
      setIsUploading(false);
    }
  }, [isUploading, selectedSkinId, externalActiveSkin, addToast, getValidMinecraftToken, getSkinFileData, getSkinWithFileData]);

  // Downloads the texture of whatever skin is currently active on Mojang but not saved
  // locally, and adds it to the library as a normal (editable, deletable) skin.
  const handleImportExternalSkin = useCallback(async () => {
    if (!externalActiveSkin || isImportingExternal) return;

    setIsImportingExternal(true);
    try {
      const response = await fetch(externalActiveSkin.url);
      if (!response.ok) {
        throw new Error(`No se pudo descargar la skin (${response.status})`);
      }
      const arrayBuffer = await response.arrayBuffer();

      const importedSkin: SkinData = {
        id: `skin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: 'Skin importada',
        fileData: arrayBuffer,
        url: externalActiveSkin.url,
        textureId: externalActiveSkin.textureId,
        variant: externalActiveSkin.variant,
        uploadedAt: new Date(),
        isActive: true,
        isMojangSynced: true,
      };

      await SkinStorageService.saveSkin(importedSkin);
      await SkinStorageService.setActiveSkin(importedSkin.id);

      setExternalActiveSkin(null);
      setSelectedSkinId(importedSkin.id);
      const updatedSkins = await SkinStorageService.getStoredSkins();
      setSkins([...updatedSkins]);
      addToast?.(t('toast.imported'), 'success');
    } catch (error) {
      void logger.error('Error importing external skin', error, 'SkinManager');
      addToast?.(t('toast.importFailed'), 'error');
    } finally {
      setIsImportingExternal(false);
    }
  }, [externalActiveSkin, isImportingExternal, addToast]);

  const handleDeleteSkin = useCallback(async (skinId: string, event: React.MouseEvent) => {
    event.stopPropagation();

    if (selectedSkinId === skinId) {
      addToast?.(t('toast.cannotDeleteSelected'), 'error');
      return;
    }

    try {
      if (blobUrlsRef.current.has(skinId)) {
        const blobUrl = blobUrlsRef.current.get(skinId)!;
        releaseTexture(blobUrl);
        URL.revokeObjectURL(blobUrl);
        blobUrlsRef.current.delete(skinId);
      }

      await SkinStorageService.deleteSkin(skinId);
      const updatedSkins = await SkinStorageService.getStoredSkins();
      setSkins([...updatedSkins]);
      addToast?.(t('toast.deleted'), 'success');
      refreshAvatars();
    } catch (error) {
      void logger.error('Error deleting skin', error, 'SkinManager');
      addToast?.(t('toast.deleteFailed'), 'error');
    }
  }, [selectedSkinId, addToast]);

  const handleSelectCape = useCallback(async (cape: CapeData) => {
    if (isUpdatingCape) return;
    setIsUpdatingCape(true);

    const previousCapes = capes;
    const nextCapes = capes.map((c) => ({ ...c, state: c.id === cape.id ? 'ACTIVE' : 'INACTIVE' }));
    setCapes(nextCapes);
    SkinStorageService.setLocalActiveCapeId(cape.id);

    try {
      const accessToken = await getValidMinecraftToken();
      if (!accessToken) {
        addToast?.(t('toast.noSessionForCape'), 'error');
        setCapes(previousCapes);
        return;
      }

      await invoke('set_active_cape', { capeId: cape.id, accessToken });
      const cacheKey = currentUser?.uuid || currentUser?.username;
      if (cacheKey) capesSessionCache[cacheKey] = nextCapes;
      addToast?.(t('toast.capeApplied'), 'success');
      refreshAvatars();
    } catch (error) {
      void logger.error('Error activating cape', error, 'SkinManager');
      addToast?.(t('toast.capeApplyFailed'), 'error');
      setCapes(previousCapes);
      SkinStorageService.setLocalActiveCapeId(previousCapes.find((c) => c.state === 'ACTIVE')?.id ?? null);
    } finally {
      setIsUpdatingCape(false);
    }
  }, [isUpdatingCape, capes, addToast, getValidMinecraftToken, currentUser?.uuid, currentUser?.username]);

  const handleRemoveCape = useCallback(async () => {
    if (isUpdatingCape) return;
    setIsUpdatingCape(true);

    const previousCapes = capes;
    const nextCapes = capes.map((c) => ({ ...c, state: 'INACTIVE' }));
    setCapes(nextCapes);
    SkinStorageService.setLocalActiveCapeId(null);

    try {
      const accessToken = await getValidMinecraftToken();
      if (!accessToken) {
        addToast?.(t('toast.noSessionForCapeRemoval'), 'error');
        setCapes(previousCapes);
        return;
      }

      await invoke('remove_active_cape', { accessToken });
      const cacheKey = currentUser?.uuid || currentUser?.username;
      if (cacheKey) capesSessionCache[cacheKey] = nextCapes;
      addToast?.(t('toast.capeRemoved'), 'success');
      refreshAvatars();
    } catch (error) {
      void logger.error('Error removing cape', error, 'SkinManager');
      addToast?.(t('toast.capeRemoveFailed'), 'error');
      setCapes(previousCapes);
    } finally {
      setIsUpdatingCape(false);
    }
  }, [isUpdatingCape, capes, addToast, getValidMinecraftToken, currentUser?.uuid, currentUser?.username]);

  const handleOpenEditModal = useCallback((skin: SkinData, activeCapeId: string | null) => {
    setPendingVariant(skin.variant);
    setPendingCapeId(activeCapeId ?? 'none');
    setPendingTextureFile(null);
    setPendingTexturePreviewUrl(null);
    setShowEditModal(true);
  }, []);

  const handleCloseEditModal = useCallback(() => {
    if (pendingTexturePreviewUrl) {
      releaseTexture(pendingTexturePreviewUrl);
      URL.revokeObjectURL(pendingTexturePreviewUrl);
    }
    setShowEditModal(false);
    setPendingTextureFile(null);
    setPendingTexturePreviewUrl(null);
  }, [pendingTexturePreviewUrl]);

  const handleEditFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.type !== 'image/png') {
      addToast?.(t('toast.onlyPng'), 'error');
      return;
    }

    if (file.size > 24 * 1024) {
      addToast?.(t('toast.tooLarge'), 'error');
      return;
    }

    if (pendingTexturePreviewUrl) {
      releaseTexture(pendingTexturePreviewUrl);
      URL.revokeObjectURL(pendingTexturePreviewUrl);
    }

    setPendingTextureFile(file);
    setPendingTexturePreviewUrl(URL.createObjectURL(file));
  }, [addToast, pendingTexturePreviewUrl]);

  const handleSaveSkinEdits = useCallback(async () => {
    if (!activeSkin || isSavingEdits) return;

    setIsSavingEdits(true);

    try {
      let workingSkin: SkinData = { ...activeSkin, variant: pendingVariant };
      const variantChanged = pendingVariant !== activeSkin.variant;
      let textureChanged = false;

      if (pendingTextureFile) {
        const rawBuffer = await pendingTextureFile.arrayBuffer();
        const uint8Array = new Uint8Array(rawBuffer);
        const buffer = new ArrayBuffer(uint8Array.length);
        new Uint8Array(buffer).set(uint8Array);

        workingSkin = { ...workingSkin, fileData: buffer, url: '', textureId: '', isMojangSynced: false };
        textureChanged = true;
      }

      await SkinStorageService.saveSkin(workingSkin);

      if (textureChanged) {
        if (blobUrlsRef.current.has(activeSkin.id)) {
          const oldBlobUrl = blobUrlsRef.current.get(activeSkin.id)!;
          releaseTexture(oldBlobUrl);
          URL.revokeObjectURL(oldBlobUrl);
          blobUrlsRef.current.delete(activeSkin.id);
        }
        const blob = new Blob([workingSkin.fileData!], { type: 'image/png' });
        blobUrlsRef.current.set(activeSkin.id, URL.createObjectURL(blob));
      }

      setSkins([...(await SkinStorageService.getStoredSkins())]);

      if (textureChanged || variantChanged) {
        const timeSinceLastUpload = Date.now() - lastUploadTimeRef.current;
        if (timeSinceLastUpload < MIN_UPLOAD_INTERVAL) {
          await new Promise((resolve) => setTimeout(resolve, MIN_UPLOAD_INTERVAL - timeSinceLastUpload));
        }

        try {
          const fileData = await getSkinFileData(workingSkin);
          const accessToken = await getValidMinecraftToken();

          if (accessToken) {
            const tempFilePath = await invoke<string>('create_temp_file', {
              fileName: `skin_${Date.now()}.png`,
              fileData: Array.from(new Uint8Array(fileData)),
            });

            lastUploadTimeRef.current = Date.now();
            await invoke('upload_skin_to_mojang', {
              filePath: tempFilePath,
              variant: pendingVariant,
              accessToken,
            });

            try {
              const profileResponse = await invoke<ProfileResponse>('get_minecraft_profile_safe', { accessToken });
              if (profileResponse.status === 'Ok' && profileResponse.profile) {
                const profile = profileResponse.profile as any;
                const mojangSkins = profile.skins || [];
                const activeMojangSkin = mojangSkins.find((s: MojangSkin) => s.state === 'ACTIVE');
                if (activeMojangSkin) {
                  const finalSkin: SkinData = {
                    ...workingSkin,
                    url: activeMojangSkin.url || workingSkin.url || '',
                    textureId: activeMojangSkin.id || workingSkin.textureId || '',
                    isMojangSynced: true,
                  };
                  await SkinStorageService.saveSkin(finalSkin);
                  setSkins([...(await SkinStorageService.getStoredSkins())]);
                }
              }
            } catch {
              // ignore, the texture is already active locally
            }
          }
        } catch (uploadError) {
          void logger.warn('Error subiendo textura editada a Mojang', String(uploadError), 'SkinManager');
        }
      }

      const currentActiveCapeId = capes.find((c) => c.state === 'ACTIVE')?.id ?? 'none';
      if (pendingCapeId !== currentActiveCapeId) {
        if (pendingCapeId === 'none') {
          await handleRemoveCape();
        } else {
          const cape = capes.find((c) => c.id === pendingCapeId);
          if (cape) await handleSelectCape(cape);
        }
      }

      refreshAvatars();
      addToast?.(t('toast.updated'), 'success');
      handleCloseEditModal();
    } catch (error) {
      void logger.error('Error guardando cambios de skin', error, 'SkinManager');
      addToast?.(t('toast.saveChangesFailed'), 'error');
    } finally {
      setIsSavingEdits(false);
    }
  }, [
    activeSkin,
    isSavingEdits,
    pendingVariant,
    pendingTextureFile,
    pendingCapeId,
    capes,
    addToast,
    getSkinFileData,
    getValidMinecraftToken,
    handleRemoveCape,
    handleSelectCape,
    handleCloseEditModal,
  ]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      handleUploadSkin(acceptedFiles[0]);
    }
  }, [handleUploadSkin]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/png': ['.png'] },
    multiple: false,
    disabled: isUploading,
    noClick: true,
    noKeyboard: false
  });

  const activeSkinTextureForCapes = activeSkin
    ? getSkinUrl(activeSkin)
    : currentUser?.uuid
      ? getBestSkinTextureUrl(currentUser.uuid)
      : '';

  return (
    <div className="h-full w-full relative overflow-hidden">
      <AppBackground />

      <div className="relative z-20 h-full min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.5fr)] gap-8 p-6 overflow-hidden">
        <div className="flex flex-col min-h-0 overflow-hidden">
          <h1 className="font-heading text-4xl font-black tracking-wide text-white drop-shadow-lg mb-4">
            {t('title')}
          </h1>

          <div className="relative w-full h-[calc(80vh-1rem)] min-h-[280px] flex items-center justify-center">
            <SkinPreviewRenderer
              key={`main-preview-${activeSkin?.id ?? 'default'}-${activeSkin?.variant ?? 'classic'}`}
              textureSrc={activeSkinTextureForCapes}
              capeSrc={hasActiveCape ? activeCape?.url : undefined}
              variant={activeSkin?.variant === 'slim' ? 'SLIM' : 'CLASSIC'}
              framing="page"
              className="w-full h-full"
              nametag={currentUser?.username}
              showDragHint
              subtitle={
                activeSkin ? (
                  activeSkin.isExternal ? (
                    <button
                      onClick={handleImportExternalSkin}
                      disabled={isImportingExternal}
                      className="pointer-events-auto flex items-center gap-2 rounded-lg border border-[#d4af37]/40 bg-black/50 hover:bg-black/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-colors disabled:opacity-50"
                    >
                      {isImportingExternal ? (
                        <div className="w-4 h-4 animate-spin rounded-full border-t-2 border-b-2 border-[#d4af37]" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      {t('saveToYourSkins')}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleOpenEditModal(activeSkin, hasActiveCape ? activeCape?.id ?? null : null)}
                      className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/15 bg-black/50 hover:bg-black/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                      {t('editSkin')}
                    </button>
                  )
                ) : undefined
              }
            />

            {isUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="animate-spin rounded-full h-10 w-10 border-t-4 border-b-4 border-[#d4af37]" />
              </div>
            )}
          </div>
        </div>

        {/* Contenido scrollable: skins */}
        <div
          {...getRootProps()}
          className="overflow-y-auto min-h-0 custom-scrollbar pr-2 pt-1"
        >
          <input {...getInputProps()} />

          {isDragActive && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="glass-card px-12 py-8 rounded-2xl border-2 border-dashed border-[#d4af37] bg-gradient-to-br from-[#d4af37]/10 to-[#7c4dbd]/10">
                <UploadCloud className="mx-auto h-16 w-16 text-[#d4af37] mb-4" strokeWidth={1.5} />
                <p className="text-2xl font-bold text-white">{t('dropHere')}</p>
              </div>
            </div>
          )}

          {/* Skins section */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('yourSkins')}</h2>

            {isLoadingInitial ? (
              <div className="h-40 flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-[#d4af37]" />
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 min-[1000px]:grid-cols-4 min-[1300px]:grid-cols-5 min-[1600px]:grid-cols-6 gap-3">
                <div
                  onClick={() => {
                    if (!isUploading) {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/png';
                      input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) handleUploadSkin(file);
                      };
                      input.click();
                    }
                  }}
                  className={`group aspect-[31/40] w-full transition-all duration-300 ease-out ${
                    isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  <div className="w-full h-full rounded-[20px] overflow-hidden bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center gap-2 border-2 border-dashed border-white/15 group-hover:border-[#d4af37]/60 transition-colors duration-300">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#d4af37]/15 to-[#7c4dbd]/15 flex items-center justify-center group-hover:from-[#d4af37]/25 group-hover:to-[#7c4dbd]/25 transition-colors">
                      <Plus className="w-6 h-6 text-[#d4af37]" />
                    </div>
                    <div className="text-center px-3">
                      <p className="text-white text-xs font-semibold">{t('addSkin')}</p>
                      <p className="text-white/40 text-[10px] mt-0.5">{t('addSkinHint')}</p>
                    </div>
                  </div>
                </div>

                {externalActiveSkin && (
                  <div
                    onClick={handleImportExternalSkin}
                    className="group relative aspect-[31/40] w-full rounded-[20px] overflow-hidden transition-all duration-300 ease-out cursor-pointer valthorne-selected-ring"
                  >
                    <SkinPreviewRenderer
                      key={`preview-${externalActiveSkin.id}`}
                      textureSrc={externalActiveSkin.url}
                      capeSrc={hasActiveCape ? activeCape?.url : undefined}
                      variant={externalActiveSkin.variant === 'slim' ? 'SLIM' : 'CLASSIC'}
                      framing="modal"
                      interactive={false}
                      className="w-full h-full pointer-events-none"
                    />

                    <div className="absolute top-2 left-2 z-20 rounded-full bg-[#d4af37] px-2 py-0.5 text-[10px] font-bold text-black shadow-lg">
                      {t('current')}
                    </div>

                    <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 bg-gradient-to-t from-black/90 to-transparent px-2 pb-2 pt-6 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-white text-[11px] font-medium text-center leading-tight">
                        {isImportingExternal ? t('importing') : t('notInLibrary')}
                      </p>
                    </div>
                  </div>
                )}

                {skins.map((skin) => {
                  const isSelected = !externalActiveSkin && selectedSkinId === skin.id;
                  const skinUrl = getSkinUrl(skin);

                  return (
                    <div
                      key={skin.id}
                      onClick={() => handleSelectSkin(skin)}
                      className={`group relative aspect-[31/40] w-full rounded-[20px] overflow-hidden transition-all duration-300 ease-out ${
                        isUploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                      } ${isSelected ? 'valthorne-selected-ring' : 'ring-1 ring-white/10 hover:ring-white/25'}`}
                    >
                      <SkinPreviewRenderer
                        key={`preview-${skin.id}-${skin.variant}`}
                        textureSrc={skinUrl}
                        capeSrc={hasActiveCape ? activeCape?.url : undefined}
                        variant={skin.variant === 'slim' ? 'SLIM' : 'CLASSIC'}
                        framing="modal"
                        interactive={false}
                        className="w-full h-full pointer-events-none"
                      />

                      {!isSelected && (
                        <button
                          onClick={(e) => handleDeleteSkin(skin.id, e)}
                          className="absolute top-2 right-2 z-20 w-7 h-7 rounded-full bg-red-500/90 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-2 pt-6 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-white text-[11px] font-medium truncate">{skin.name}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {showEditModal && activeSkin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-[38rem] max-h-[calc(100%-3rem)] flex flex-col rounded-2xl bg-[#161019] border border-white/10 shadow-2xl">
            <div className="flex items-center justify-between gap-4 p-6 border-b border-white/10">
              <h2 className="text-lg font-extrabold text-white">{t('editingSkin')}</h2>
              <button
                onClick={handleCloseEditModal}
                title={tCommon('close')}
                className="w-9 h-9 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto custom-scrollbar p-6">
              <div className="flex flex-col md:flex-row gap-6">
                {/* Preview */}
                <div className="w-full md:w-[16rem] h-[20rem] md:h-[25rem] min-w-0 md:min-w-[16rem] shrink-0 md:self-center">
                  <SkinPreviewRenderer
                    key={`edit-preview-${pendingTexturePreviewUrl ?? activeSkin.id}-${pendingVariant}-${pendingCapeId}`}
                    textureSrc={pendingTexturePreviewUrl ?? getSkinUrl(activeSkin)}
                    capeSrc={pendingCapeId !== 'none' ? capes.find((c) => c.id === pendingCapeId)?.url : undefined}
                    variant={pendingVariant === 'slim' ? 'SLIM' : 'CLASSIC'}
                    framing="modal"
                    showDragHint
                    className="w-full h-full rounded-xl overflow-hidden bg-black/30"
                  />
                </div>

                {/* Controles */}
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-white mb-2">{t('texture')}</h3>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white/10 hover:bg-white/15 px-3 py-1.5 text-sm font-medium text-white transition-colors">
                      <ImageUp className="w-4 h-4" />
                      {t('replaceTexture')}
                      <input type="file" accept="image/png" className="hidden" onChange={handleEditFileChange} />
                    </label>
                  </div>

                  <div>
                    <h3 className="text-base font-semibold text-white mb-2">{t('armType')}</h3>
                    <div className="flex flex-col gap-1">
                      {(['classic', 'slim'] as SkinModel[]).map((variant) => (
                        <button
                          key={variant}
                          type="button"
                          onClick={() => setPendingVariant(variant)}
                          className={`flex w-fit items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium transition-colors ${
                            pendingVariant === variant ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'
                          }`}
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                              pendingVariant === variant ? 'border-[#d4af37]' : 'border-white/30'
                            }`}
                          >
                            {pendingVariant === variant && <span className="h-2.5 w-2.5 rounded-full bg-[#d4af37]" />}
                          </span>
                          {variant === 'classic' ? 'Wide' : 'Slim'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-base font-semibold text-white mb-2">{t('cape')}</h3>

                    {isLoadingCapes ? (
                      <div className="flex items-center gap-2 text-xs text-white/40 py-2">
                        <div className="animate-spin rounded-full h-3.5 w-3.5 border-t-2 border-b-2 border-[#d4af37]" />
                        {t('loadingCapes')}
                      </div>
                    ) : capes.length === 0 ? (
                      <div className="flex items-start gap-2 rounded-lg bg-white/5 px-3 py-2.5">
                        <Info className="w-4 h-4 shrink-0 text-white/40 mt-0.5" />
                        <p className="text-xs leading-snug text-white/50">
                          {t('noCapesHint')}
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-[repeat(4,max-content)] gap-2">
                        <button
                          onClick={() => setPendingCapeId('none')}
                          title={t('noCape')}
                          style={{ width: CAPE_SPRITE_WIDTH, height: CAPE_SPRITE_HEIGHT }}
                          className={`shrink-0 rounded-md flex items-center justify-center bg-black/50 transition-all ${
                            pendingCapeId === 'none' ? 'valthorne-selected-ring' : 'ring-1 ring-white/10 hover:ring-white/25'
                          }`}
                        >
                          <X className="w-4 h-4 text-white/50" />
                        </button>
                        {capes.map((cape) => (
                          <button
                            key={cape.id}
                            onClick={() => setPendingCapeId(cape.id)}
                            title={cape.alias}
                            style={{ width: CAPE_SPRITE_WIDTH, height: CAPE_SPRITE_HEIGHT }}
                            className={`shrink-0 overflow-hidden rounded-md bg-black/50 transition-all ${
                              pendingCapeId === cape.id ? 'valthorne-selected-ring' : 'ring-1 ring-white/10 hover:ring-white/25'
                            }`}
                          >
                            <CapeSprite url={cape.url} alt={cape.alias} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4">
              <button
                onClick={handleCloseEditModal}
                disabled={isSavingEdits}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={handleSaveSkinEdits}
                disabled={isSavingEdits}
                className="flex items-center gap-2 rounded-lg bg-[#d4af37] hover:bg-[#c19f2e] px-4 py-2 text-sm font-semibold text-black transition-colors disabled:opacity-50 disabled:pointer-events-none"
              >
                {isSavingEdits && <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-black" />}
                {t('saveSkin')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
