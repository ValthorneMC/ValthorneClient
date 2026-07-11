import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2 } from 'lucide-react';
import type { MinecraftVersionInfo, FabricLoaderVersion, ForgeVersion, NeoForgeVersion, LocalInstance } from '@/types/local-instances';
import { logger } from '@/utils/logger';
import { modLoaderIconInvertFilter, modLoaderIconSrc } from '@/utils/modLoaderIcon';

interface CreateLocalInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInstanceCreated: (instance: LocalInstance) => void;
}

type ModLoaderType = 'vanilla' | 'fabric' | 'forge' | 'neoforge';

function loaderChoiceIconClass(loader: ModLoaderType) {
  const base = 'h-12 w-12 max-w-full mb-2 shrink-0 object-contain object-center';
  return modLoaderIconInvertFilter(loader) ? `${base} brightness-0 invert opacity-95` : base;
}

function StepLoader({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-16">
      <div className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center">
        <span
          className="absolute inset-[-6px] rounded-full border-2 border-[#00ffff]/20"
          aria-hidden
        />
        <span
          className="absolute inset-0 animate-ping rounded-full bg-[#00ffff]/15 [animation-duration:1.75s]"
          aria-hidden
        />
        <Loader2
          className="relative h-11 w-11 animate-spin text-[#00ffff] [animation-duration:0.7s]"
          strokeWidth={2.5}
          style={{ filter: 'drop-shadow(0 0 12px rgba(0,255,255,0.45))' }}
          aria-hidden
        />
      </div>
      <p className="max-w-xs text-center text-sm font-medium tracking-wide text-white/80">{message}</p>
    </div>
  );
}

const CreateLocalInstanceModal: React.FC<CreateLocalInstanceModalProps> = ({
  isOpen,
  onClose,
  onInstanceCreated,
}) => {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [generatedId, setGeneratedId] = useState('');
  const [minecraftVersions, setMinecraftVersions] = useState<MinecraftVersionInfo[]>([]);
  const [selectedMinecraftVersion, setSelectedMinecraftVersion] = useState('');
  const [modLoaderType, setModLoaderType] = useState<ModLoaderType>('fabric');
  const [fabricVersions, setFabricVersions] = useState<FabricLoaderVersion[]>([]);
  const [forgeVersions, setForgeVersions] = useState<ForgeVersion[]>([]);
  const [neoforgeVersions, setNeoforgeVersions] = useState<NeoForgeVersion[]>([]);
  const [selectedModLoaderVersion, setSelectedModLoaderVersion] = useState('');
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setName('');
      setGeneratedId('');
      setSelectedMinecraftVersion('');
      setModLoaderType('fabric');
      setSelectedModLoaderVersion('');
      setMinecraftVersions([]);
      setFabricVersions([]);
      setForgeVersions([]);
      setNeoforgeVersions([]);
      setError('');
    }
  }, [isOpen]);

  // Generate ID preview when name changes
  useEffect(() => {
    if (name.trim()) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
      setGeneratedId(`${slug}-xxxxx`);
    } else {
      setGeneratedId('');
    }
  }, [name]);

  // Load Minecraft versions when step 2 is reached
  useEffect(() => {
    if (step === 2 && minecraftVersions.length === 0) {
      loadMinecraftVersions();
    }
  }, [step]);

  // Load mod loader versions when step 4 is reached
  useEffect(() => {
    if (selectedMinecraftVersion && step === 4 && modLoaderType !== 'vanilla') {
      loadModLoaderVersions();
    }
  }, [selectedMinecraftVersion, step, modLoaderType]);

  const loadMinecraftVersions = async () => {
    setIsLoadingVersions(true);
    setError('');
    try {
      const versions = await invoke<MinecraftVersionInfo[]>('get_minecraft_versions');
      setMinecraftVersions(versions);
    } catch (error) {
      void logger.error('Error loading Minecraft versions', error, 'loadMinecraftVersions');
      setError('Error al cargar versiones de Minecraft');
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const loadModLoaderVersions = async () => {
    setIsLoadingVersions(true);
    setError('');
    setSelectedModLoaderVersion('');
    
    try {
      switch (modLoaderType) {
        case 'fabric':
          const fabricVers = await invoke<FabricLoaderVersion[]>('get_fabric_loader_versions', {
            minecraftVersion: selectedMinecraftVersion,
          });
          setFabricVersions(fabricVers);
          break;
          
        case 'forge':
          const forgeVers = await invoke<ForgeVersion[]>('get_forge_versions', {
            minecraftVersion: selectedMinecraftVersion,
          });
          setForgeVersions(forgeVers);
          break;
          
        case 'neoforge':
          const neoforgeVers = await invoke<NeoForgeVersion[]>('get_neoforge_versions', {
            minecraftVersion: selectedMinecraftVersion,
          });
          setNeoforgeVersions(neoforgeVers);
          break;
      }
    } catch (error) {
      void logger.error(`Error loading ${modLoaderType} versions`, error, 'loadModLoaderVersions');
      setError(`Error al cargar versiones de ${modLoaderType}: ${error}`);
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const getModLoaderVersions = () => {
    switch (modLoaderType) {
      case 'fabric':
        return fabricVersions.map(v => ({ version: v.loader.version, stable: v.loader.stable }));
      case 'forge':
        return forgeVersions.map(v => ({ version: v.version, recommended: v.recommended }));
      case 'neoforge':
        return neoforgeVersions.map(v => ({ version: v.version }));
      default:
        return [];
    }
  };

  const handleNext = () => {
    setError('');
    
    if (step === 1 && !name.trim()) {
      setError('El nombre de la instancia no puede estar vacío');
      return;
    }
    
    if (step === 2 && !selectedMinecraftVersion) {
      setError('Debes seleccionar una versión de Minecraft');
      return;
    }
    
    if (step === 4 && modLoaderType !== 'vanilla' && !selectedModLoaderVersion) {
      setError(`Debes seleccionar una versión de ${modLoaderType}`);
      return;
    }
    
    // Skip step 4 if vanilla is selected
    if (step === 3 && modLoaderType === 'vanilla') {
      setSelectedModLoaderVersion('');
      setStep(5);
      return;
    }
    
    if (step < 5) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    setError('');
    if (step > 1) {
      if (step === 5 && modLoaderType === 'vanilla') {
        setStep(3);
      } else {
        setStep(step - 1);
      }
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setError('');
    
    try {
      const instance = await invoke<LocalInstance>('create_local_instance', {
        name,
        minecraftVersion: selectedMinecraftVersion,
        modLoaderType: modLoaderType,
        modLoaderVersion: selectedModLoaderVersion || 'none',
      });
      
      void logger.info(`Instance created successfully: ${instance.name}`, 'handleCreate');
      onInstanceCreated(instance);
      onClose();
    } catch (error) {
      void logger.error('Error creating instance', error, 'handleCreate');
      setError(`Error al crear instancia: ${error}`);
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  const totalSteps = modLoaderType === 'vanilla' ? 4 : 5;
  const displayStep = step === 5 && modLoaderType === 'vanilla' ? 4 : step;

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isCreating) {
          onClose();
        }
      }}
    >
      <div 
        className="glass-card rounded-3xl border border-white/10 p-8 max-w-2xl w-full shadow-2xl animate-slide-up"
        style={{
          background: 'rgba(10, 10, 10, 0.95)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
      >
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-2">
            Nueva Instancia Local
          </h2>
          <p className="text-white/60">
            Crea una instancia personalizada para pruebas (Paso {displayStep} de {totalSteps})
          </p>
        </div>

        <div className="mb-8">
          <div className="flex items-center gap-2">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-2 rounded-full transition-all duration-300 ${
                  i + 1 <= displayStep ? 'bg-[#00ffff] neon-glow-cyan' : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="min-h-[300px]">
          {step === 1 && (
            <div className="space-y-6 animate-fade-in-up">
              <div>
                <label className="block text-white mb-2 font-medium">
                  Nombre de la instancia
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Mi Instancia de Pruebas"
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-[#00ffff] focus:ring-2 focus:ring-[#00ffff]/20 transition-all"
                  autoFocus
                />
              </div>
              
              {generatedId && (
                <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-white/60 text-sm mb-1">ID generado:</p>
                  <p className="text-white font-mono">{generatedId}</p>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-fade-in-up">
              <div>
                <label className="block text-white mb-2 font-medium">
                  Versión de Minecraft
                </label>
                {isLoadingVersions ? (
                  <StepLoader message="Obteniendo versiones de Minecraft…" />
                ) : (
                  <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {minecraftVersions.map((version) => (
                      <button
                        key={version.id}
                        onClick={() => setSelectedMinecraftVersion(version.id)}
                        className={`w-full px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                          selectedMinecraftVersion === version.id
                            ? 'bg-[#00ffff]/20 border-2 border-[#00ffff] text-white neon-glow-cyan'
                            : 'bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{version.id}</span>
                          <span className="text-sm text-white/60">
                            {new Date(version.releaseTime).toLocaleDateString()}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-fade-in-up">
              <div>
                <label className="block text-white mb-2 font-medium">
                  Tipo de Mod Loader
                </label>
                <p className="text-white/60 text-sm mb-4">
                  Para Minecraft {selectedMinecraftVersion}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setModLoaderType('vanilla')}
                    className={`p-6 rounded-xl text-left transition-all duration-200 ${
                      modLoaderType === 'vanilla'
                        ? 'bg-[#00ffff]/20 border-2 border-[#00ffff] neon-glow-cyan'
                        : 'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex flex-col items-center text-center">
                      <img src={modLoaderIconSrc('vanilla')} alt="" className={loaderChoiceIconClass('vanilla')} />
                      <span className="text-white font-medium">Vanilla</span>
                    </div>
                  </button>
                  
                  <button
                    onClick={() => setModLoaderType('fabric')}
                    className={`p-6 rounded-xl text-left transition-all duration-200 ${
                      modLoaderType === 'fabric'
                        ? 'bg-[#00ffff]/20 border-2 border-[#00ffff] neon-glow-cyan'
                        : 'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex flex-col items-center text-center">
                      <img src={modLoaderIconSrc('fabric')} alt="" className={loaderChoiceIconClass('fabric')} />
                      <span className="text-white font-medium">Fabric</span>
                    </div>
                  </button>
                  
                  <button
                    onClick={() => setModLoaderType('forge')}
                    className={`p-6 rounded-xl text-left transition-all duration-200 ${
                      modLoaderType === 'forge'
                        ? 'bg-[#00ffff]/20 border-2 border-[#00ffff] neon-glow-cyan'
                        : 'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex flex-col items-center text-center">
                      <img src={modLoaderIconSrc('forge')} alt="" className={loaderChoiceIconClass('forge')} />
                      <span className="text-white font-medium">Forge</span>
                    </div>
                  </button>
                  
                  <button
                    onClick={() => setModLoaderType('neoforge')}
                    className={`p-6 rounded-xl text-left transition-all duration-200 ${
                      modLoaderType === 'neoforge'
                        ? 'bg-[#00ffff]/20 border-2 border-[#00ffff] neon-glow-cyan'
                        : 'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex flex-col items-center text-center">
                      <img src={modLoaderIconSrc('neoforge')} alt="" className={loaderChoiceIconClass('neoforge')} />
                      <span className="text-white font-medium">NeoForge</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 4 && modLoaderType !== 'vanilla' && (
            <div className="space-y-6 animate-fade-in-up">
              <div>
                <label className="block text-white mb-2 font-medium">
                  Versión de {modLoaderType === 'fabric' ? 'Fabric' : modLoaderType === 'forge' ? 'Forge' : 'NeoForge'}
                </label>
                <p className="text-white/60 text-sm mb-4">
                  Para Minecraft {selectedMinecraftVersion}
                </p>
                {isLoadingVersions ? (
                  <StepLoader
                    message={
                      modLoaderType === 'fabric'
                        ? 'Cargando versiones de Fabric…'
                        : modLoaderType === 'forge'
                          ? 'Cargando versiones de Forge…'
                          : 'Cargando versiones de NeoForge…'
                    }
                  />
                ) : (
                  <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {getModLoaderVersions().length === 0 ? (
                      <div className="p-8 text-center">
                        <p className="text-white/60">No hay versiones disponibles de {modLoaderType} para Minecraft {selectedMinecraftVersion}</p>
                      </div>
                    ) : (
                      getModLoaderVersions().map((version: any) => (
                        <button
                          key={version.version}
                          onClick={() => setSelectedModLoaderVersion(version.version)}
                          className={`w-full px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                            selectedModLoaderVersion === version.version
                              ? 'bg-[#00ffff]/20 border-2 border-[#00ffff] text-white neon-glow-cyan'
                              : 'bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{version.version}</span>
                            <div className="flex gap-2">
                              {version.stable && (
                                <span className="px-2 py-1 rounded-lg bg-green-500/20 text-green-300 text-xs">
                                  Estable
                                </span>
                              )}
                              {version.recommended && (
                                <span className="px-2 py-1 rounded-lg bg-blue-500/20 text-blue-300 text-xs">
                                  Recomendada
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className={`space-y-6 animate-fade-in-up ${isCreating ? 'pointer-events-none opacity-60' : ''}`}>
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-white mb-4">Resumen de la instancia</h3>
                
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-white/60 text-sm mb-1">Nombre:</p>
                  <p className="text-white font-medium">{name}</p>
                </div>
                
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-white/60 text-sm mb-1">Versión de Minecraft:</p>
                  <p className="text-white font-medium">{selectedMinecraftVersion}</p>
                </div>
                
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-white/60 text-sm mb-1">Mod Loader:</p>
                  <div className="flex items-center gap-3">
                    <img
                      src={modLoaderIconSrc(modLoaderType)}
                      alt=""
                      className={
                        modLoaderIconInvertFilter(modLoaderType)
                          ? 'h-10 w-10 max-w-[min(100%,10rem)] shrink-0 object-contain brightness-0 invert opacity-90'
                          : 'h-10 w-10 max-w-[min(100%,10rem)] shrink-0 object-contain'
                      }
                    />
                    <p className="text-white font-medium">
                      {modLoaderType === 'vanilla' ? 'Vanilla (sin mods)' : 
                       modLoaderType === 'fabric' ? 'Fabric' : 
                       modLoaderType === 'forge' ? 'Forge' : 'NeoForge'}
                      {modLoaderType !== 'vanilla' && ` ${selectedModLoaderVersion}`}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 flex items-center justify-between gap-4">
          <button
            onClick={onClose}
            disabled={isCreating}
            className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          
          <div className="flex gap-4">
            {step > 1 && step < 5 && (
              <button
                onClick={handleBack}
                disabled={isCreating || isLoadingVersions}
                className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Atrás
              </button>
            )}
            
            {step < 5 ? (
              <button
                onClick={handleNext}
                disabled={
                  isLoadingVersions || 
                  (step === 1 && !name.trim()) || 
                  (step === 2 && !selectedMinecraftVersion) ||
                  (step === 4 && modLoaderType !== 'vanilla' && !selectedModLoaderVersion)
                }
                className="px-6 py-3 rounded-xl bg-[#00ffff]/20 border-2 border-[#00ffff] text-white hover:bg-[#00ffff]/30 transition-all duration-200 neon-glow-cyan-hover disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Siguiente
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="min-w-[200px] justify-center px-8 py-3 rounded-xl bg-[#00ffff]/20 border-2 border-[#00ffff] text-white hover:bg-[#00ffff]/30 transition-all duration-200 neon-glow-cyan-hover disabled:opacity-90 disabled:cursor-not-allowed font-bold inline-flex items-center gap-3"
              >
                {isCreating ? (
                  <>
                    <span className="relative flex h-6 w-6 items-center justify-center">
                      <span
                        className="absolute inset-0 rounded-full border-2 border-white/30"
                        aria-hidden
                      />
                      <Loader2 className="relative h-5 w-5 animate-spin text-white" strokeWidth={2.5} aria-hidden />
                    </span>
                    <span className="flex flex-col items-start text-left leading-tight">
                      <span>Creando instancia</span>
                      <span className="text-xs font-normal text-white/70">Descargando archivos…</span>
                    </span>
                  </>
                ) : (
                  'Crear Instancia'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateLocalInstanceModal;
