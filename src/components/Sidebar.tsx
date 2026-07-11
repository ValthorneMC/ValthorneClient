import React, { useState } from 'react';
import Tooltip from '@/components/ui/Tooltip';
import type { LocalInstance } from '@/types/local-instances';
import { invoke } from '@tauri-apps/api/core';
import { Avatar } from '@/components/Avatar';
import { logger } from '@/utils/logger';

interface Instance {
  id: string;
  name: string;
  description: string;
  version: string;
  minecraft_version: string;
  icon?: string;
  background?: string;
  last_updated?: string;
  instance_url: string;
  mod_loader?: {
    type: string;
    version: string;
  };
  is_local?: boolean;
}

interface AuthSession {
  access_token: string;
  username: string;
  uuid: string;
  user_type: string;
  expires_at?: number;
  refresh_token?: string;
}

interface SidebarProps {
  instances: Instance[];
  localInstances?: LocalInstance[];
  selectedInstance: string | null;
  onInstanceSelect: (instanceId: string) => void;
  handleSettingsToggle: () => void;
  handleSkinToggle: () => void;
  distributionBaseUrl: string;
  currentUser?: AuthSession | null;
  settingsOpen?: boolean;
  isAdmin?: boolean;
  onCreateLocalInstance?: () => void;
  creatingInstanceId?: string | null;
  onLocalInstanceDeleted?: (instanceId: string) => void;
  addToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  instances,
  localInstances = [],
  selectedInstance,
  onInstanceSelect,
  handleSettingsToggle,
  handleSkinToggle,
  distributionBaseUrl,
  currentUser,
  settingsOpen = false,
  isAdmin = false,
  onCreateLocalInstance,
  creatingInstanceId = null,
  onLocalInstanceDeleted,
  addToast,
}) => {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; instanceId: string } | null>(null);
  const [hoveredInstance, setHoveredInstance] = useState<{ id: string; top: number } | null>(null);
  const [, setTooltipVisible] = useState(false);
  const [, forceUpdate] = useState(0);
  
  React.useEffect(() => {
    if (hoveredInstance) {
      setTooltipVisible(true);
    } else {
      setTooltipVisible(false);
    }
  }, [hoveredInstance]);

  React.useEffect(() => {
    const handleLastPlayedUpdate = () => {
      // Forzar re-render cuando se actualiza la última vez jugada
      forceUpdate(prev => prev + 1);
    };
    window.addEventListener('last_played_updated', handleLastPlayedUpdate);
    return () => window.removeEventListener('last_played_updated', handleLastPlayedUpdate);
  }, []);
  
  const MAX_VISIBLE_LOCAL_INSTANCES = 3;
  
  const getLastPlayed = (instanceId: string): number => {
    const lastPlayed = localStorage.getItem(`last_played_${instanceId}`);
    return lastPlayed ? parseInt(lastPlayed, 10) : 0;
  };

  const sortedLocalInstances = [...localInstances].sort((a, b) => {
    if (selectedInstance === a.id) return -1;
    if (selectedInstance === b.id) return 1;
    const aLastPlayed = getLastPlayed(a.id);
    const bLastPlayed = getLastPlayed(b.id);
    return bLastPlayed - aLastPlayed;
  });

  const visibleLocalInstances = sortedLocalInstances.slice(0, MAX_VISIBLE_LOCAL_INSTANCES);
  const hasMoreLocalInstances = localInstances.length > MAX_VISIBLE_LOCAL_INSTANCES;

  const handleContextMenu = (e: React.MouseEvent, instanceId: string) => {
    e.preventDefault();
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
      void logger.error('Error deleting instance', error, 'Sidebar');
      if (addToast) {
        addToast(`Error al eliminar instancia: ${error}`, 'error');
      }
    }
  };

  // Close context menu when clicking elsewhere
  React.useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <>

      <div className="fixed left-0 top-0 h-full w-20 glass border-r border-white/10 z-40">
        <div className="h-full flex flex-col relative">
        <div className="flex flex-col gap-2 overflow-y-auto flex-1 custom-scrollbar p-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', paddingBottom: isAdmin && localInstances.length > 0 ? '400px' : '200px' }}>
            {/* Remote instances */}
            {instances.map((instance) => {
              const isSelected = selectedInstance === instance.id;
              
              return (
                <div 
                  key={instance.id} 
                  className="relative group w-full"
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredInstance({ id: instance.id, top: rect.top + rect.height / 2 });
                  }}
                  onMouseLeave={() => setHoveredInstance(null)}
                >
                  <div
                    onClick={() => onInstanceSelect(instance.id)}
                    className={`w-full aspect-square cursor-pointer relative select-none transition-transform duration-300 ease-out ${
                      isSelected ? 'scale-105' : 'hover:scale-105'
                    }`}
                  >
                    <div 
                      className={`w-full h-full rounded-2xl overflow-hidden transition-all duration-500 ease-in-out ${
                        isSelected
                          ? 'ring-2 ring-[#00ffff]'
                          : 'ring-1 ring-white/10 hover:ring-white/20'
                      }`}
                      style={isSelected ? {
                        boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 255, 255, 0.6), 0 0 40px rgba(0, 255, 255, 0.4)'
                      } : {}}
                    >
                    {instance.icon ? (
                      <img
                        src={`${distributionBaseUrl}/${instance.icon}`}
                        alt={instance.name}
                        className="w-full h-full object-cover"
                        style={{ filter: selectedInstance === instance.id ? 'none' : 'none' }}
                      />
                    ) : (
                      <div className={`w-full h-full bg-gradient-to-br from-[#00ffff]/20 to-[#ff00ff]/20 flex items-center justify-center ${
                        selectedInstance === instance.id ? '' : ''
                      }`}>
                        <span className="text-white font-bold text-xl">
                          {instance.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
          
          {/* Tooltip for remote instances - rendered outside overflow container */}
          {hoveredInstance && (
            <div 
              className="pointer-events-none fixed z-[9999] transition-opacity duration-200 opacity-0 animate-[fadeIn_0.2s_ease-out_forwards]"
              style={{
                left: '80px',
                top: `${hoveredInstance.top}px`,
                transform: 'translateY(-50%)',
              }}
            >
              <div className="glass-card text-white text-xs px-2 py-1 rounded-xl whitespace-nowrap shadow-lg border border-white/10">
                {instances.find(i => i.id === hoveredInstance.id)?.name}
              </div>
            </div>
          )}

          {/* Settings Button at bottom - Only Icon */}
          <div className="absolute bottom-0 left-0 right-0 space-y-3 px-2 pb-2">
            {/* Local instances section (only if admin) - positioned above the + button */}
            {isAdmin && (
              <>
                {/* Separator above local instances */}
                {localInstances.length > 0 && (
                  <div className="relative my-4">
                    <div className="h-px bg-gradient-to-r from-transparent via-[#FFD700]/60 to-transparent" />
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#FFD700] shadow-[0_0_8px_rgba(255,215,0,0.8)]" />
                  </div>
                )}

                {/* Local instances list */}
                {localInstances.length > 0 && (
                  <div className="flex flex-col gap-2 relative">
                    {visibleLocalInstances.map((localInstance, index) => {
                      const isCreating = creatingInstanceId === localInstance.id;
                      const isSelected = selectedInstance === localInstance.id;
                      
                      const selectedIndexInSorted = selectedInstance ? sortedLocalInstances.findIndex(li => li.id === selectedInstance) : -1;
                      const currentIndexInSorted = sortedLocalInstances.findIndex(li => li.id === localInstance.id);
                      
                      let translateY = 0;
                      if (selectedIndexInSorted !== -1 && selectedIndexInSorted !== 0 && selectedIndexInSorted !== currentIndexInSorted) {
                        if (isSelected) {
                          translateY = -selectedIndexInSorted * (80 + 8);
                        } else if (currentIndexInSorted < selectedIndexInSorted) {
                          translateY = (80 + 8);
                        }
                      }
                      
                      return (
                        <Tooltip key={localInstance.id} content={localInstance.name} side="right">
                          <div
                            onClick={() => !isCreating && onInstanceSelect(localInstance.id)}
                            onContextMenu={(e) => !isCreating && handleContextMenu(e, localInstance.id)}
                            className={`w-full aspect-square relative select-none ${
                              isCreating ? 'cursor-not-allowed' : 'cursor-pointer'
                            }`}
                            style={{
                              order: isSelected ? -1 : index + 1,
                              transform: `translateY(${translateY}px) ${isSelected ? 'scale(1.05)' : 'scale(1)'}`,
                              transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), scale 0.3s ease-out',
                              zIndex: isSelected ? 10 : 1,
                            }}
                          >
                            <div 
                              className={`w-full h-full rounded-2xl overflow-hidden transition-all duration-500 ease-in-out ${
                                isSelected && !isCreating
                                  ? 'ring-2 ring-[#FFD700]'
                                  : 'ring-2 ring-[#FFD700]/30 hover:ring-[#FFD700]/50'
                              }`}
                              style={isSelected && !isCreating ? {
                                boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.5), 0 0 20px rgba(255, 215, 0, 0.6), 0 0 40px rgba(255, 215, 0, 0.4)'
                              } : {}}
                            >
                              {isCreating ? (
                                <div className="w-full h-full bg-gradient-to-br from-[#FFD700]/20 to-[#FF8C00]/20 flex items-center justify-center">
                                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#FFD700]"></div>
                                </div>
                              ) : localInstance.background ? (
                                <img
                                  src={`file://${localInstance.background}`}
                                  alt={localInstance.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-br from-[#FFD700]/20 to-[#FF8C00]/20 flex items-center justify-center">
                                  <span className="text-[#FFD700] font-bold text-xl">
                                    {localInstance.name.charAt(0).toUpperCase()}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </Tooltip>
                      );
                    })}

                    {/* Show all instances button */}
                    {hasMoreLocalInstances && (
                      <Tooltip content={`Ver todas las instancias (${localInstances.length})`} side="right">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            onInstanceSelect('local-instances-view');
                          }}
                          className="w-full aspect-square cursor-pointer transition-all duration-300 ease-out hover:scale-105 flex items-center justify-center"
                        >
                          <div className="w-full h-full rounded-2xl overflow-hidden transition-all duration-300 ease-out ring-2 ring-[#FFD700]/30 hover:ring-[#FFD700]/50 bg-gradient-to-br from-[#FFD700]/10 to-[#FF8C00]/10 flex items-center justify-center">
                            <span className="text-[#FFD700] font-bold text-2xl">
                              +{localInstances.length - visibleLocalInstances.length}
                            </span>
                          </div>
                        </div>
                      </Tooltip>
                    )}
                  </div>
                )}

                {/* Add local instance button */}
                <Tooltip content="Crear Instancia Local" side="right">
                  <div
                    onClick={() => onCreateLocalInstance?.()}
                    className="flex justify-center cursor-pointer transition-all duration-300 ease-out hover:scale-105 group"
                  >
                    <div className="w-14 h-14 rounded-2xl overflow-hidden transition-all duration-300 ease-out ring-2 ring-[#FFD700]/50 hover:ring-[#FFD700] bg-gradient-to-br from-[#FFD700]/10 to-[#FF8C00]/10 flex items-center justify-center hover:shadow-lg hover:shadow-[#FFD700]/20">
                      <svg 
                        className="w-6 h-6 text-[#FFD700] transition-transform duration-300 group-hover:rotate-90"
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                      </svg>
                    </div>
                  </div>
                </Tooltip>

                {/* Separator below add button */}
                <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              </>
            )}

            {/* Skin Management Button */}
            {currentUser && (
              <Tooltip content="Cambiar Skin" side="right">
                <div className="flex justify-center">
                  <div
                    onClick={() => handleSkinToggle()}
                    className="relative group cursor-pointer transition-all duration-300 ease-out hover:scale-105"
                  >
                    <div className="w-14 h-14 rounded-2xl overflow-hidden ring-1 ring-white/10 hover:ring-white/20 transition-all duration-300 ease-out select-none">
                      <Avatar
                        uuid={currentUser.uuid}
                        username={currentUser.username}
                        size={64}
                        overlay={true}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                </div>
              </Tooltip>
            )}

            <div className="relative group flex items-center justify-center">
              <svg 
                onClick={() => handleSettingsToggle()}
                className={`w-12 h-12 cursor-pointer transition-[transform,color,filter] duration-500 ease-in-out ${
                  settingsOpen 
                    ? 'text-white' 
                    : 'text-white/70 hover:text-white'
                } ${settingsOpen ? '' : 'hover:scale-110'}`}
                style={{
                  transformOrigin: 'center center',
                  filter: settingsOpen 
                    ? 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.6)) drop-shadow(0 0 16px rgba(0, 255, 255, 0.4))' 
                    : 'drop-shadow(0 0 0 rgba(0, 255, 255, 0))',
                  transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.3s ease-out, filter 0.3s ease-out',
                }}
                onMouseEnter={(e) => {
                  if (!settingsOpen) {
                    e.currentTarget.style.filter = 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.6)) drop-shadow(0 0 16px rgba(0, 255, 255, 0.4))';
                    e.currentTarget.style.transform = 'scale(1.1) rotate(15deg)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!settingsOpen) {
                    e.currentTarget.style.filter = 'drop-shadow(0 0 0 rgba(0, 255, 255, 0))';
                    e.currentTarget.style.transform = 'scale(1) rotate(0deg)';
                  } else {
                    e.currentTarget.style.filter = 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.6)) drop-shadow(0 0 16px rgba(0, 255, 255, 0.4))';
                    e.currentTarget.style.transform = 'scale(1) rotate(0deg)';
                  }
                }}
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94 1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50">
                <div className="glass-card text-white text-xs px-2 py-1 rounded-xl whitespace-nowrap shadow-lg border border-white/10">Ajustes</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Context menu for local instances */}
      {contextMenu && (
        <div
          className="fixed z-50 glass-card rounded-xl border border-white/10 shadow-2xl overflow-hidden animate-scale-in"
          style={{ 
            top: contextMenu.y, 
            left: contextMenu.x,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <button
            onClick={handleDeleteInstance}
            className="w-full px-3 py-2 text-left text-red-400 hover:bg-red-500/20 transition-all duration-200 flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Eliminar
          </button>
        </div>
      )}

    </>
  );
};

export default Sidebar;
