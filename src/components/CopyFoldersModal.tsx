import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/utils/logger';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { LocalInstance } from '@/types/local-instances';

interface MinecraftWorld {
  name: string;
  path: string;
  icon_path: string | null;
}

interface RemoteInstance {
  id: string;
  name: string;
  minecraft_version: string;
  mod_loader?: {
    type: string;
    version: string;
  };
}

interface CopyFoldersModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetInstanceId: string;
  localInstances: LocalInstance[];
  remoteInstances?: RemoteInstance[];
  onFoldersCopied?: () => void;
  addToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
}

const CopyFoldersModal: React.FC<CopyFoldersModalProps> = ({
  isOpen,
  onClose,
  targetInstanceId,
  localInstances,
  remoteInstances = [],
  onFoldersCopied,
  addToast,
}) => {
  const [sourceInstanceId, setSourceInstanceId] = useState<string>('');
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [selectedWorlds, setSelectedWorlds] = useState<Set<string>>(new Set());
  const [worlds, setWorlds] = useState<MinecraftWorld[]>([]);
  const [isLoadingWorlds, setIsLoadingWorlds] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyProgress, setCopyProgress] = useState<Record<string, number>>({});

  const availableFolders = [
    { name: 'schematics', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { name: 'config', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    { name: 'resourcepacks', icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01' },
    { name: 'shaderpacks', icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01' },
    { name: 'saves', icon: 'M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z' },
    { name: 'screenshots', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  ];

  // Cargar mundos cuando se selecciona una instancia origen y saves está seleccionado
  useEffect(() => {
    const isSavesSelected = selectedFolders.has('saves');
    if (sourceInstanceId && isSavesSelected) {
      loadWorlds();
    } else if (!isSavesSelected) {
      setWorlds([]);
      setSelectedWorlds(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceInstanceId, Array.from(selectedFolders).join(',')]);

  const loadWorlds = async () => {
    if (!sourceInstanceId) return;
    
    setIsLoadingWorlds(true);
    try {
      const worldsList = await invoke<MinecraftWorld[]>('list_minecraft_worlds', {
        instanceId: sourceInstanceId,
      });
      setWorlds(worldsList);
    } catch (error) {
      console.error('Error loading worlds:', error);
      if (addToast) {
        addToast('Error al cargar mundos', 'error');
      }
      setWorlds([]);
    } finally {
      setIsLoadingWorlds(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setSourceInstanceId('');
      setSelectedFolders(new Set());
      setSelectedWorlds(new Set());
      setWorlds([]);
      setIsCopying(false);
      setCopyProgress({});
    }
  }, [isOpen]);

  // Escuchar eventos de progreso
  useEffect(() => {
    if (!isOpen) return;

    let unlisten: (() => void) | undefined;

    (async () => {
      unlisten = await listen('copy-folders-progress', (event: any) => {
        const data = event.payload;
        if (data.target_instance_id === targetInstanceId) {
          if (data.status === 'completed') {
            setCopyProgress(prev => ({ ...prev, [data.folder]: 100 }));
            setTimeout(() => {
              setCopyProgress(prev => {
                const newProgress = { ...prev };
                delete newProgress[data.folder];
                return newProgress;
              });
            }, 2000);
          } else if (data.status === 'copying') {
            setCopyProgress(prev => ({ ...prev, [data.folder]: data.percentage || 0 }));
          }
        }
      });
    })();

    return () => {
      if (unlisten) {
        try {
          unlisten();
        } catch {}
      }
    };
  }, [isOpen, targetInstanceId]);

  const handleFolderToggle = async (folder: string) => {
    setSelectedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folder)) {
        newSet.delete(folder);
        // Si se deselecciona saves, limpiar mundos seleccionados
        if (folder === 'saves') {
          setSelectedWorlds(new Set());
          setWorlds([]);
        }
      } else {
        newSet.add(folder);
      }
      return newSet;
    });
    
    // Si se selecciona saves y hay instancia origen, cargar mundos
    if (folder === 'saves' && sourceInstanceId) {
      await loadWorlds();
    }
  };

  const handleWorldToggle = (worldName: string) => {
    setSelectedWorlds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(worldName)) {
        newSet.delete(worldName);
      } else {
        newSet.add(worldName);
      }
      return newSet;
    });
  };

  const handleCopy = async () => {
    if (!sourceInstanceId || (selectedFolders.size === 0 && selectedWorlds.size === 0)) {
      if (addToast) {
        addToast('Por favor selecciona una instancia origen y al menos una carpeta o mundo', 'error');
      } else {
        alert('Por favor selecciona una instancia origen y al menos una carpeta o mundo');
      }
      return;
    }

    setIsCopying(true);
    try {
      // Construir lista de carpetas a copiar
      const foldersToCopy: string[] = [];
      
      // Agregar carpetas normales (excepto saves si hay mundos seleccionados)
      for (const folder of selectedFolders) {
        if (folder === 'saves') {
          // Si saves está seleccionado, agregar solo los mundos seleccionados
          if (selectedWorlds.size > 0) {
            for (const world of selectedWorlds) {
              foldersToCopy.push(`saves/${world}`);
            }
          } else {
            // Si saves está seleccionado pero no hay mundos, copiar toda la carpeta
            foldersToCopy.push('saves');
          }
        } else {
          foldersToCopy.push(folder);
        }
      }

      await invoke('copy_instance_folders', {
        sourceInstanceId: sourceInstanceId,
        targetInstanceId: targetInstanceId,
        folders: foldersToCopy,
      });

      if (onFoldersCopied) {
        onFoldersCopied();
      }
      onClose();
    } catch (error) {
      void logger.error('Error copying folders', error, 'CopyFoldersModal');
      if (addToast) {
        addToast(`Error al copiar carpetas: ${error}`, 'error');
      } else {
        alert(`Error al copiar carpetas: ${error}`);
      }
    } finally {
      setIsCopying(false);
    }
  };

  if (!isOpen) return null;

  const hasSelection = selectedFolders.size > 0 || selectedWorlds.size > 0;

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300"
      onClick={onClose}
    >
      <div
        className="glass-card rounded-3xl border border-white/10 p-8 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-300"
        style={{
          background: 'rgba(10, 10, 10, 0.95)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#ffff00]/10 border border-[#ffff00]/20">
              <svg className="w-6 h-6 text-[#ffff00]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-white">
              Copiar Carpetas entre Instancias
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:scale-110 transition-all duration-200 cursor-pointer"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6">
          {/* Source instance selection */}
          <div>
            <label className="flex text-white/80 mb-2 items-center gap-2">
              <svg className="w-4 h-4 text-[#ffff00]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Instancia Origen:
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <select
                value={sourceInstanceId}
                onChange={(e) => setSourceInstanceId(e.target.value)}
                className="w-full pl-10 p-3 rounded-xl bg-white/5 border border-white/10 text-white hover:border-[#ffff00]/30 focus:border-[#ffff00]/50 focus:ring-2 focus:ring-[#ffff00]/20 transition-all duration-200 cursor-pointer appearance-none"
                disabled={isCopying}
              >
                <option value="">Selecciona una instancia...</option>
                {localInstances.length > 0 && (
                  <optgroup label="Instancias Locales" className="bg-gray-900">
                    {localInstances
                      .filter(inst => inst.id !== targetInstanceId)
                      .map(inst => (
                        <option key={inst.id} value={inst.id} className="bg-gray-900">
                          {inst.name} (MC {inst.minecraft_version})
                        </option>
                      ))}
                  </optgroup>
                )}
                {remoteInstances.length > 0 && (
                  <optgroup label="Instancias Remotas" className="bg-gray-900">
                    {remoteInstances
                      .filter(inst => inst.id !== targetInstanceId)
                      .map(inst => (
                        <option key={inst.id} value={inst.id} className="bg-gray-900">
                          {inst.name} (MC {inst.minecraft_version})
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* Folders selection */}
          <div>
            <label className="flex text-white/80 mb-3 items-center gap-2">
              <svg className="w-4 h-4 text-[#ffff00]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Carpetas a Copiar:
            </label>
            <div className="grid grid-cols-2 gap-3">
              {availableFolders.map((folder, index) => {
                const isSelected = selectedFolders.has(folder.name);
                const progress = copyProgress[folder.name];
                const isCopyingFolder = isCopying && progress !== undefined;

                return (
                  <label
                    key={folder.name}
                    className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 group relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 ${
                      isSelected
                        ? 'bg-[#ffff00]/20 border-[#ffff00]/50 text-[#ffff00] shadow-lg shadow-[#ffff00]/20'
                        : 'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-[#ffff00]/30'
                    }`}
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex items-center gap-3 relative z-10">
                      <div className={`p-2 rounded-lg transition-colors ${
                        isSelected ? 'bg-[#ffff00]/20' : 'bg-white/5'
                      }`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={folder.icon} />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleFolderToggle(folder.name)}
                            disabled={isCopying}
                            className="w-4 h-4 rounded cursor-pointer accent-[#ffff00]"
                          />
                          <span className="font-medium capitalize">{folder.name}</span>
                        </div>
                      </div>
                      {isSelected && (
                        <svg className="w-5 h-5 text-[#ffff00] animate-in zoom-in" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    {isCopyingFolder && (
                      <div className="mt-3 w-full bg-white/5 rounded-full h-1.5 overflow-hidden relative z-10">
                        <div
                          className="bg-gradient-to-r from-[#ffff00] to-[#ffff00]/60 h-full transition-all duration-300 shadow-lg shadow-[#ffff00]/50"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#ffff00]/10 to-transparent pointer-events-none" />
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Worlds selection (only if saves is selected) */}
          {selectedFolders.has('saves') && (
            <div>
              <label className="flex text-white/80 mb-3 items-center gap-2">
                <svg className="w-4 h-4 text-[#ffff00]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Mundos a Copiar:
              </label>
              {!sourceInstanceId ? (
                <div className="text-center text-white/60 py-8 flex flex-col items-center gap-3">
                  <svg className="w-12 h-12 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p>Selecciona una instancia origen para ver los mundos disponibles</p>
                </div>
              ) : isLoadingWorlds ? (
                <div className="text-center text-white/60 py-8 flex flex-col items-center gap-3">
                  <svg className="w-8 h-8 animate-spin text-[#ffff00]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <p>Cargando mundos...</p>
                </div>
              ) : worlds.length === 0 ? (
                <div className="text-center text-white/60 py-8 flex flex-col items-center gap-3">
                  <svg className="w-12 h-12 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p>No se encontraron mundos en esta instancia</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {worlds.map((world, index) => {
                    const isSelected = selectedWorlds.has(world.name);
                    const worldKey = `saves/${world.name}`;
                    const progress = copyProgress[worldKey];
                    const isCopyingWorld = isCopying && progress !== undefined;

                    return (
                      <label
                        key={world.name}
                        className={`p-3 rounded-xl border cursor-pointer transition-all duration-200 group relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 ${
                          isSelected
                            ? 'bg-[#ffff00]/20 border-[#ffff00]/50 text-[#ffff00] shadow-lg shadow-[#ffff00]/20'
                            : 'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-[#ffff00]/30'
                        }`}
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <div className="flex items-center gap-3 relative z-10">
                          {world.icon_path ? (
                            <>
                              <img
                                src={convertFileSrc(world.icon_path)}
                                className="w-10 h-10 rounded-lg object-cover border border-white/10"
                                onError={(e) => {
                                  // Si falla la carga del icono, ocultar y mostrar placeholder
                                  e.currentTarget.style.display = 'none';
                                  const placeholder = e.currentTarget.nextElementSibling as HTMLElement;
                                  if (placeholder) placeholder.style.display = 'flex';
                                }}
                              />
                              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#ffff00]/20 to-[#ffff00]/5 border border-[#ffff00]/20 items-center justify-center hidden world-icon-placeholder">
                                <svg className="w-5 h-5 text-[#ffff00]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                                </svg>
                              </div>
                            </>
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#ffff00]/20 to-[#ffff00]/5 border border-[#ffff00]/20 flex items-center justify-center">
                              <svg className="w-5 h-5 text-[#ffff00]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                              </svg>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleWorldToggle(world.name)}
                                disabled={isCopying}
                                className="w-4 h-4 rounded cursor-pointer accent-[#ffff00] flex-shrink-0"
                              />
                              <span className="font-medium truncate">{world.name}</span>
                            </div>
                          </div>
                          {isSelected && (
                            <svg className="w-4 h-4 text-[#ffff00] animate-in zoom-in flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        {isCopyingWorld && (
                          <div className="mt-2 w-full bg-white/5 rounded-full h-1 overflow-hidden relative z-10">
                            <div
                              className="bg-gradient-to-r from-[#ffff00] to-[#ffff00]/60 h-full transition-all duration-300 shadow-lg shadow-[#ffff00]/50"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        )}
                        {isSelected && (
                          <div className="absolute inset-0 bg-gradient-to-br from-[#ffff00]/10 to-transparent pointer-events-none" />
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-white/10">
          <button
            onClick={onClose}
            disabled={isCopying}
            className="px-6 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium cursor-pointer hover:scale-105 active:scale-95 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Cancelar
          </button>
          <button
            onClick={handleCopy}
            disabled={isCopying || !sourceInstanceId || !hasSelection}
            className="px-6 py-2.5 rounded-xl bg-[#ffff00]/20 border-2 border-[#ffff00]/30 text-[#ffff00] hover:bg-[#ffff00]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium cursor-pointer hover:scale-105 active:scale-95 flex items-center gap-2 relative overflow-hidden min-w-[160px]"
          >
            {isCopying ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Copiando...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Copiar Carpetas</span>
              </>
            )}
            {isCopying && Object.keys(copyProgress).length > 0 && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#ffff00]/20">
                <div 
                  className="h-full bg-[#ffff00] transition-all duration-300"
                  style={{ 
                    width: `${Object.values(copyProgress).reduce((a, b) => a + b, 0) / (Object.keys(copyProgress).length * 100) * 100}%` 
                  }}
                />
              </div>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CopyFoldersModal;
