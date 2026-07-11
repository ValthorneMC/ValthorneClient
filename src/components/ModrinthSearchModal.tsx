import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Input } from '@/components/ui/input';
import { logger } from '@/utils/logger';

interface ModrinthProject {
  project_id: string;
  project_type: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  client_side: string;
  server_side: string;
  downloads: number;
  icon_url?: string;
  author: string;
}

interface ModrinthVersion {
  id: string;
  project_id: string;
  version_number: string;
  name: string;
  changelog?: string;
  date_published: string;
  downloads: number;
  version_type: string;
  game_versions: string[];
  loaders: string[];
  files: Array<{
    hashes: {
      sha512?: string;
      sha1?: string;
    };
    url: string;
    filename: string;
    primary: boolean;
    size: number;
  }>;
  dependencies: Array<{
    version_id?: string;
    project_id?: string;
    file_name?: string;
    dependency_type: string;
  }>;
}

interface ModrinthSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  instanceId: string;
  minecraftVersion: string;
  loader: string;
  onModDownloaded?: () => void;
  addToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
}

const ModrinthSearchModal: React.FC<ModrinthSearchModalProps> = ({
  isOpen,
  onClose,
  instanceId,
  minecraftVersion,
  loader,
  onModDownloaded,
  addToast,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ModrinthProject[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ModrinthProject | null>(null);
  const [versions, setVersions] = useState<ModrinthVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [downloadingMods, setDownloadingMods] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  
  interface InstalledMod {
    filename: string;
    project_id: string | null;
  }
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>([]);

  // Cargar mods instalados cuando se abre el modal
  useEffect(() => {
    if (isOpen) {
      (async () => {
        try {
          const mods = await invoke<InstalledMod[]>('list_installed_mods', { instanceId });
          setInstalledMods(mods || []);
        } catch (error) {
          void logger.error('Error loading installed mods', error, 'ModrinthSearchModal');
          setInstalledMods([]);
        }
      })();
    }
  }, [isOpen, instanceId]);

  // Resetear estado al cerrar el modal
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);
      setSelectedProject(null);
      setVersions([]);
    }
  }, [isOpen]);

  // Escuchar eventos de progreso de descarga
  useEffect(() => {
    if (!isOpen) return;

    let unlisten: (() => void) | undefined;

    (async () => {
      unlisten = await listen('modrinth-download-progress', (event: any) => {
        const data = event.payload;
        if (data.instance_id === instanceId) {
          if (data.status === 'completed' || data.status === 'completed_dependency') {
            setDownloadProgress(prev => ({ ...prev, [data.filename]: 100 }));
            setTimeout(() => {
              setDownloadProgress(prev => {
                const newProgress = { ...prev };
                delete newProgress[data.filename];
                return newProgress;
              });
              setDownloadingMods(prev => {
                const newSet = new Set(prev);
                newSet.delete(data.filename);
                return newSet;
              });
            }, 2000);
          } else if (data.status === 'downloading' || data.status === 'downloading_dependency') {
            setDownloadingMods(prev => new Set(prev).add(data.filename));
            setDownloadProgress(prev => ({ ...prev, [data.filename]: data.percentage || 0 }));
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
  }, [isOpen, instanceId]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setHasSearched(true);
    try {
      const result = await invoke<any>('search_modrinth_mods', {
        query: searchQuery,
        minecraftVersion: minecraftVersion,
        loader: loader,
        limit: 20,
      });

      setSearchResults(result.hits || []);
    } catch (error) {
      void logger.error('Error searching mods', error, 'ModrinthSearchModal');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, minecraftVersion, loader]);

  const handleProjectSelect = async (project: ModrinthProject) => {
    setSelectedProject(project);
    setIsLoadingVersions(true);
    try {
      const versions = await invoke<ModrinthVersion[]>('get_modrinth_project_versions', {
        projectId: project.project_id,
        minecraftVersion: minecraftVersion,
        loader: loader,
      });
      setVersions(versions);
    } catch (error) {
      void logger.error('Error loading versions', error, 'ModrinthSearchModal');
      setVersions([]);
      if (addToast) {
        addToast('Error al cargar versiones del mod', 'error');
      }
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const handleDownloadLatest = async (project: ModrinthProject) => {
    setIsLoadingVersions(true);
    try {
      const versions = await invoke<ModrinthVersion[]>('get_modrinth_project_versions', {
        projectId: project.project_id,
        minecraftVersion: minecraftVersion,
        loader: loader,
      });
      
      if (versions.length === 0) {
        if (addToast) {
          addToast('No se encontraron versiones compatibles para este mod', 'error');
        }
        return;
      }

      // Obtener la última versión (la primera debería ser la más reciente)
      const latestVersion = versions[0];
      await handleDownloadMod(latestVersion);
    } catch (error) {
      void logger.error('Error downloading latest version', error, 'ModrinthSearchModal');
      if (addToast) {
        addToast(`Error al descargar el mod: ${error}`, 'error');
      }
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const handleDownloadMod = async (version: ModrinthVersion) => {
    try {
      await invoke('download_modrinth_mod_with_dependencies', {
        versionId: version.id,
        instanceId: instanceId,
        minecraftVersion: minecraftVersion,
        loader: loader,
      });
      
      if (onModDownloaded) {
        onModDownloaded();
      }
      
      // Recargar mods instalados después de descargar
      try {
        const mods = await invoke<InstalledMod[]>('list_installed_mods', { instanceId });
        setInstalledMods(mods || []);
      } catch (error) {
        void logger.error('Error reloading installed mods', error, 'ModrinthSearchModal');
      }
    } catch (error) {
      void logger.error('Error downloading mod', error, 'ModrinthSearchModal');
      if (addToast) {
        addToast(`Error al descargar el mod: ${error}`, 'error');
      } else {
        alert(`Error al descargar el mod: ${error}`);
      }
    }
  };

  // Verificar si un mod está instalado
  const isModInstalled = (project: ModrinthProject): boolean => {
    // Primero intentar comparar por project_id (más preciso)
    if (installedMods.some(mod => mod.project_id === project.project_id)) {
      return true;
    }
    
    // Fallback: comparar por nombre de archivo (slug o título)
    const projectSlug = project.slug.toLowerCase();
    const projectTitle = project.title.toLowerCase();
    
    return installedMods.some(mod => {
      const modFileName = mod.filename.toLowerCase();
      return modFileName.includes(projectSlug) || modFileName.includes(projectTitle);
    });
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300"
      onClick={onClose}
    >
      <div
        className="glass-card rounded-2xl border border-white/10 p-6 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-300"
        style={{
          background: 'rgba(10, 10, 10, 0.95)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#00ffff]/10 border border-[#00ffff]/20">
              <svg className="w-5 h-5 text-[#00ffff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white">
              {selectedProject ? selectedProject.title : 'Buscar Mods en Modrinth'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all duration-200 cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!selectedProject ? (
          <>
            {/* Search Bar */}
            <div className="flex gap-2 mb-4">
              <div className="flex-1 relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <Input
                  type="text"
                  placeholder="Buscar mods..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSearch();
                    }
                  }}
                  className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-[#00ffff]/50 focus:ring-2 focus:ring-[#00ffff]/20"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={isSearching || !searchQuery.trim()}
                className="px-4 py-2 rounded-lg bg-[#00ffff]/20 border border-[#00ffff]/30 text-[#00ffff] hover:bg-[#00ffff]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium text-sm cursor-pointer flex items-center gap-2"
              >
                {isSearching ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Buscando...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Buscar
                  </>
                )}
              </button>
            </div>

            {/* Search Results */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar space-y-2 pr-2">
              {searchResults.length === 0 && !isSearching && hasSearched && (
                <div className="text-center text-white/60 py-12 flex flex-col items-center gap-3">
                  <svg className="w-16 h-16 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p>No se encontraron mods. Intenta con otra búsqueda.</p>
                </div>
              )}
              {searchResults.map((project, index) => (
                <div
                  key={project.project_id}
                  onClick={() => handleProjectSelect(project)}
                  className="w-full p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[#00ffff]/30 transition-all duration-200 group cursor-pointer animate-in fade-in slide-in-from-bottom-4"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center gap-3">
                    {project.icon_url ? (
                      <img
                        src={project.icon_url}
                        alt={project.title}
                        className="w-12 h-12 rounded-lg object-cover border border-white/10 group-hover:border-[#00ffff]/30 transition-colors flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#00ffff]/20 to-[#00ffff]/5 border border-[#00ffff]/20 flex items-center justify-center flex-shrink-0">
                        <svg className="w-6 h-6 text-[#00ffff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-white font-semibold text-sm group-hover:text-[#00ffff] transition-colors truncate">
                          {project.title}
                        </h3>
                        {isModInstalled(project) && (
                          <div className="px-1.5 py-0.5 rounded bg-green-500/20 border border-green-500/30 flex items-center gap-1 flex-shrink-0">
                            <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="text-xs text-green-400 font-medium">Instalado</span>
                          </div>
                        )}
                      </div>
                      <p className="text-white/60 text-xs line-clamp-2">
                        {project.description}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-white/40">
                        <div className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          <span>{project.downloads.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                          </svg>
                          <span className="truncate">{project.categories.join(', ')}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!isModInstalled(project) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadLatest(project);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#00ffff]/20 border border-[#00ffff]/30 text-[#00ffff] hover:bg-[#00ffff]/30 transition-all duration-200 font-medium text-xs cursor-pointer flex items-center gap-1.5"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Descargar
                        </button>
                      )}
                      <svg
                        className="w-5 h-5 text-white/40 group-hover:text-[#00ffff] transition-colors"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Back button */}
            <button
              onClick={() => {
                setSelectedProject(null);
                setVersions([]);
              }}
              className="mb-3 text-[#00ffff] hover:text-[#00ffff]/80 transition-colors flex items-center gap-1.5 cursor-pointer group text-sm"
            >
              <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Volver
            </button>

            {/* Versions List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
              {isLoadingVersions ? (
                <div className="text-center text-white/60 py-12 flex flex-col items-center gap-3">
                  <svg className="w-12 h-12 animate-spin text-[#00ffff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <p>Cargando versiones...</p>
                </div>
              ) : versions.length === 0 ? (
                <div className="text-center text-white/60 py-12 flex flex-col items-center gap-3">
                  <svg className="w-16 h-16 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p>No se encontraron versiones compatibles para {minecraftVersion} ({loader}).</p>
                </div>
              ) : (
                versions.map((version, index) => {
                  const isDownloading = downloadingMods.has(version.files[0]?.filename || '');
                  const progress = downloadProgress[version.files[0]?.filename || ''] || 0;

                  return (
                    <div
                      key={version.id}
                      className="p-3 rounded-lg bg-white/5 border border-white/10 hover:border-[#00ffff]/30 transition-all duration-200 hover:bg-white/10 animate-in fade-in slide-in-from-bottom-4"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-white font-semibold text-sm">{version.name || version.version_number}</h3>
                          <p className="text-white/60 text-xs mt-1 flex items-center gap-2 flex-wrap">
                            <span className="flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              {new Date(version.date_published).toLocaleDateString('es-ES')}
                            </span>
                            <span className="flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              {version.downloads.toLocaleString()} descargas
                            </span>
                          </p>
                          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-white/40 flex-wrap">
                            <span className="px-1.5 py-0.5 rounded bg-white/5 flex items-center gap-1">
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                              </svg>
                              {version.version_type}
                            </span>
                            {version.dependencies.length > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 flex items-center gap-1">
                                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                                {version.dependencies.length} dep.
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDownloadMod(version)}
                          disabled={isDownloading}
                          className="px-3 py-1.5 rounded-lg bg-[#00ffff]/20 border border-[#00ffff]/30 text-[#00ffff] hover:bg-[#00ffff]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium text-xs cursor-pointer relative overflow-hidden min-w-[90px] flex-shrink-0"
                        >
                          {isDownloading ? (
                            <div className="flex items-center gap-1.5">
                              <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              <span>{progress}%</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Descargar
                            </div>
                          )}
                          {isDownloading && (
                            <div 
                              className="absolute bottom-0 left-0 h-0.5 bg-[#00ffff] transition-all duration-300"
                              style={{ width: `${progress}%` }}
                            />
                          )}
                        </button>
                      </div>
                      {isDownloading && (
                        <div className="mt-2 w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-[#00ffff] to-[#00ffff]/60 h-full transition-all duration-300"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ModrinthSearchModal;
