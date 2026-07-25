import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import valthorneLogo from '@/assets/valthorne.png';
import { logger } from '@/utils/logger';

const SERVER_IP = 'playvalthorne.com';

interface ServerStatus {
  online: boolean;
  players_online: number;
  players_max: number;
  version_name: string | null;
}

interface HomeScreenProps {
  instanceName: string;
  onPlay: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ instanceName, onPlay, addToast }) => {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [logoVisible, setLogoVisible] = useState(false);

  useEffect(() => {
    setLogoVisible(false);
    const timer = setTimeout(() => setLogoVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const result = await invoke<ServerStatus>('get_valthorne_server_status');
        if (!cancelled) {
          setStatus(result);
        }
      } catch (error) {
        void logger.error('Error fetching server status', error, 'HomeScreen');
        if (!cancelled) {
          setStatus({ online: false, players_online: 0, players_max: 0, version_name: null });
        }
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleCopyIp = async () => {
    try {
      await navigator.clipboard.writeText(SERVER_IP);
      addToast('IP copiada al portapapeles', 'success', 2000);
    } catch (error) {
      void logger.error('Error copying server IP', error, 'HomeScreen');
      addToast('No se pudo copiar la IP', 'error');
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Background — piedra oscura + cielo morado de atardecer, inspirado en la ambientación dark fantasy de Valthorne */}
      <div className="absolute inset-0 z-0">
        <div
          className="w-full h-full"
          style={{
            background: 'linear-gradient(160deg, #1a1108 0%, #2b1d33 45%, #0d0a08 100%)',
          }}
        />
      </div>

      {/* Acentos ambientales: bruma dorada y morada */}
      <div className="absolute inset-0 z-5 opacity-20">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#d4af37] rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#7c4dbd] rounded-full blur-3xl"></div>
      </div>

      <div className="absolute inset-0 bg-black/50 z-10" />

      {/* Content */}
      <div className="relative z-20 h-full flex flex-col items-center justify-center gap-8 p-8">
        <div
          className={`transition-all duration-500 ease-out ${
            logoVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'
          }`}
        >
          <img
            src={valthorneLogo}
            alt="Valthorne"
            className="w-48 h-48 object-contain mx-auto select-none drop-shadow-[0_0_40px_rgba(124,77,189,0.35)]"
          />
          <h1 className="font-display text-4xl tracking-[0.2em] text-center mt-4 text-[#e8dcc0] drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
            VALTHORNE
          </h1>
        </div>

        <div
          className={`flex flex-col items-center gap-4 transition-all duration-500 delay-150 ease-out ${
            logoVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {/* Server IP with copy button */}
          <button
            onClick={handleCopyIp}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-[#d4af37]/20 hover:bg-white/10 hover:border-[#d4af37]/50 transition-all duration-200 group"
          >
            <span className="text-[#e8dcc0]/90 font-mono text-sm">{SERVER_IP}</span>
            <svg
              className="w-4 h-4 text-white/50 group-hover:text-[#d4af37] transition-colors"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </button>

          {/* Player count */}
          <div className="text-sm">
            {status === null ? (
              <span className="text-white/40">Consultando servidor...</span>
            ) : status.online ? (
              <span className="text-white/70">
                <span className="text-[#d4af37] font-semibold">{status.players_online}</span>
                {' / '}
                <span className="font-semibold">{status.players_max}</span>
                {' jugadores online'}
              </span>
            ) : (
              <span className="text-white/40">Servidor offline</span>
            )}
          </div>

          {/* Play button */}
          <button
            onClick={onPlay}
            className="mt-4 relative glass-light hover:bg-white/10 text-[#e8dcc0] border-2 border-[#d4af37]/30 hover:border-[#d4af37]/70
                     rounded-2xl px-16 py-6 text-2xl font-heading tracking-wide transition-all duration-300 ease-out
                     shadow-2xl hover:shadow-[0_0_30px_rgba(212,175,55,0.35)] group overflow-hidden min-w-[280px]
                     cursor-pointer hover:scale-105 neon-glow-cyan-hover"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#d4af37]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <span className="relative z-10">Jugar {instanceName ? `a ${instanceName}` : ''}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default HomeScreen;
