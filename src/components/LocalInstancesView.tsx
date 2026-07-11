import React, { useState, useEffect } from 'react';
import type { LocalInstance } from '@/types/local-instances';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import gameControllerIcon from '@/assets/icons/game-controller.svg';

interface LocalInstancesViewProps {
  localInstances: LocalInstance[];
  selectedInstance: string | null;
  onInstanceSelect: (instanceId: string) => void;
  onLocalInstanceDeleted?: (instanceId: string) => void;
  onOpenFolder?: (instanceId: string) => void;
  onInstanceRenamed?: () => void;
  addToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
}

const LocalInstancesView: React.FC<LocalInstancesViewProps> = ({
  localInstances,
  selectedInstance,
  onInstanceSelect,
  onLocalInstanceDeleted,
  onOpenFolder,
  onInstanceRenamed,
  addToast,
}) => {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; instanceId: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'lastPlayed'>('lastPlayed');
  const [groupBy, setGroupBy] = useState<'none' | 'modLoader'>('none');
  const [isVisible, setIsVisible] = useState(false);
  const [renameModal, setRenameModal] = useState<{ instanceId: string; currentName: string } | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    setIsVisible(true);
  }, []);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, instanceId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, instanceId });
  };

  const handleDeleteInstance = async () => {
    if (!contextMenu) return;
    
    try {
      await invoke('delete_local_instance', { instanceId: contextMenu.instanceId });
      onLocalInstanceDeleted?.(contextMenu.instanceId);
      setContextMenu(null);
      if (addToast) {
        addToast('Instancia eliminada correctamente', 'success');
      }
    } catch (error) {
      if (addToast) {
        addToast(`Error al eliminar instancia: ${error}`, 'error');
      }
    }
  };

  const handleOpenFolder = async () => {
    if (!contextMenu) return;
    
    try {
      if (onOpenFolder) {
        await onOpenFolder(contextMenu.instanceId);
      } else {
        await invoke('open_instance_folder', { instanceId: contextMenu.instanceId });
      }
      setContextMenu(null);
      if (addToast) {
        addToast('Carpeta abierta correctamente', 'success');
      }
    } catch (error) {
      if (addToast) {
        addToast(`Error al abrir carpeta: ${error}`, 'error');
      }
    }
  };

  const handleRenameClick = () => {
    if (!contextMenu) return;
    const instance = localInstances.find(li => li.id === contextMenu.instanceId);
    if (instance) {
      setRenameModal({ instanceId: contextMenu.instanceId, currentName: instance.name });
      setNewName(instance.name);
      setContextMenu(null);
    }
  };

  const handleRenameConfirm = async () => {
    if (!renameModal || !newName.trim()) return;
    
    try {
      await invoke('rename_local_instance', { 
        instanceId: renameModal.instanceId, 
        newName: newName.trim() 
      });
      setRenameModal(null);
      setNewName('');
      if (addToast) {
        addToast('Instancia renombrada correctamente', 'success');
      }
      if (onInstanceRenamed) {
        onInstanceRenamed();
      }
    } catch (error) {
      if (addToast) {
        addToast(`Error al renombrar instancia: ${error}`, 'error');
      }
    }
  };

  const getLastPlayed = (instanceId: string): number => {
    const lastPlayed = localStorage.getItem(`last_played_${instanceId}`);
    return lastPlayed ? parseInt(lastPlayed, 10) : 0;
  };

  const filteredInstances = localInstances.filter(instance => 
    instance.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedInstances = [...filteredInstances].sort((a, b) => {
    if (sortBy === 'lastPlayed') {
      const aLastPlayed = getLastPlayed(a.id);
      const bLastPlayed = getLastPlayed(b.id);
      return bLastPlayed - aLastPlayed;
    } else {
      return a.name.localeCompare(b.name);
    }
  });

  const groupedInstances = groupBy === 'modLoader' 
    ? sortedInstances.reduce((acc, instance) => {
        const loaderType = instance.mod_loader?.type || 'none';
        if (!acc[loaderType]) {
          acc[loaderType] = [];
        }
        acc[loaderType].push(instance);
        return acc;
      }, {} as Record<string, LocalInstance[]>)
    : { 'all': sortedInstances };

  return (
    <div className={`h-full flex flex-col bg-gradient-to-br from-black via-[#0a0a0a] to-black transition-all duration-500 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      {/* Header */}
      <div className="flex-shrink-0 p-6 border-b border-white/10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#FFD700]/10 border border-[#FFD700]/20">
              <svg className="w-5 h-5 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white">
              Instancias Locales ({localInstances.length})
            </h2>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-4">
          {/*<button className="px-4 py-2 rounded-lg bg-[#FFD700]/20 text-[#FFD700] font-medium text-sm">
            Todas las instancias
          </button>*/}
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#FFD700]/50 focus:border-[#FFD700]/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
              >
                <svg className="w-5 h-5 text-white/40 hover:text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'lastPlayed')}
            className="px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700]/50 focus:border-[#FFD700]/50 appearance-none cursor-pointer"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.5rem center',
              backgroundSize: '1.5em 1.5em',
              paddingRight: '2.5rem',
            }}
          >
            <option value="lastPlayed" className="bg-[#1a1a1a] text-white">Ordenar por: Última jugada</option>
            <option value="name" className="bg-[#1a1a1a] text-white">Ordenar por: Nombre</option>
          </select>

          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as 'none' | 'modLoader')}
            className="px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700]/50 focus:border-[#FFD700]/50 appearance-none cursor-pointer"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.5rem center',
              backgroundSize: '1.5em 1.5em',
              paddingRight: '2.5rem',
            }}
          >
            <option value="none" className="bg-[#1a1a1a] text-white">Agrupar por: Ninguno</option>
            <option value="modLoader" className="bg-[#1a1a1a] text-white">Agrupar por: Mod Loader</option>
          </select>
        </div>
      </div>

      {/* Instances Grid - Fixed scroll container */}
      <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ minHeight: 0 }}>
        <div className="p-6">
          {Object.entries(groupedInstances).map(([groupKey, instances], groupIndex) => (
            <div 
              key={groupKey} 
              className="mb-8"
              style={{
                animation: `fadeInUp 0.5s ease-out ${groupIndex * 0.1}s both`,
              }}
            >
              {groupBy !== 'none' && (
                <h3 className="text-lg font-semibold text-white/60 mb-4 capitalize">
                  {groupKey === 'none' ? 'Sin mod loader' : groupKey}
                </h3>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {instances.map((instance, index) => {
                  const isSelected = selectedInstance === instance.id;
                  const iconUrl = instance.background ? convertFileSrc(instance.background) : undefined;
                  const loaderType = instance.mod_loader?.type || 'none';

                  return (
                    <div
                      key={instance.id}
                      onClick={() => onInstanceSelect(instance.id)}
                      onContextMenu={(e) => handleContextMenu(e, instance.id)}
                      className={`relative group cursor-pointer rounded-xl bg-white/5 border transition-all duration-300 hover:bg-white/10 ${
                        isSelected 
                          ? 'ring-2 ring-[#FFD700] border-[#FFD700] scale-[1.02]' 
                          : 'border-white/10 hover:border-[#FFD700]/50'
                      }`}
                      style={{
                        animation: `fadeInUp 0.5s ease-out ${(groupIndex * 0.1 + index * 0.05)}s both`,
                      }}
                    >
                      <div className="flex items-center gap-4 p-4">
                        {/* Icon */}
                        <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-white/5">
                          {iconUrl ? (
                            <img
                              src={iconUrl}
                              alt={instance.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-[#FFD700]/20 to-[#FF8C00]/20 flex items-center justify-center">
                              <span className="text-[#FFD700] font-bold text-xl">
                                {instance.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-white font-semibold text-base mb-1 truncate">
                            {instance.name}
                          </h3>
                          <div className="flex items-center gap-2 text-white/60 text-sm">
                            <img 
                              src={gameControllerIcon} 
                              alt="Gamepad" 
                              className="w-4 h-4 flex-shrink-0 opacity-60"
                            />
                            <span className="truncate">
                              {loaderType !== 'none' ? `${loaderType.charAt(0).toUpperCase() + loaderType.slice(1)} ${instance.minecraft_version}` : `Minecraft ${instance.minecraft_version}`}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      {isSelected && (
                        <div className="absolute top-2 right-2 p-1.5 rounded-full bg-[#FFD700]">
                          <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 glass-card rounded-xl border border-white/10 shadow-2xl overflow-hidden animate-scale-in"
          style={{ 
            top: contextMenu.y, 
            left: contextMenu.x,
            background: 'rgba(0, 0, 0, 0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            minWidth: '180px',
          }}
        >
          <button
            onClick={handleOpenFolder}
            className="w-full px-4 py-2.5 text-left text-white hover:bg-white/10 transition-all duration-200 flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Abrir carpeta
          </button>
          <div className="h-px bg-white/10" />
          <button
            onClick={handleRenameClick}
            className="w-full px-4 py-2.5 text-left text-white hover:bg-white/10 transition-all duration-200 flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Renombrar
          </button>
          <div className="h-px bg-white/10" />
          <button
            onClick={handleDeleteInstance}
            className="w-full px-4 py-2.5 text-left text-red-400 hover:bg-red-500/20 transition-all duration-200 flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Eliminar
          </button>
        </div>
      )}

      {/* Rename Modal */}
      {renameModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setRenameModal(null);
              setNewName('');
            }
          }}
        >
          <div 
            className="glass-card rounded-2xl border border-white/10 p-6 max-w-md w-full mx-4 shadow-2xl animate-slide-up"
            style={{
              background: 'rgba(10, 10, 10, 0.95)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
            }}
          >
            <h3 className="text-xl font-bold text-white mb-4">Renombrar instancia</h3>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameConfirm();
                } else if (e.key === 'Escape') {
                  setRenameModal(null);
                  setNewName('');
                }
              }}
              autoFocus
              className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#FFD700]/50 focus:border-[#FFD700]/50 mb-4"
              placeholder="Nombre de la instancia"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setRenameModal(null);
                  setNewName('');
                }}
                className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all duration-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleRenameConfirm}
                disabled={!newName.trim() || newName.trim() === renameModal.currentName}
                className="px-4 py-2 rounded-lg bg-[#FFD700]/20 border border-[#FFD700]/30 text-[#FFD700] hover:bg-[#FFD700]/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Renombrar
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default LocalInstancesView;
