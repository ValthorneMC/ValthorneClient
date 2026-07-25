import React from 'react';
import { Avatar } from '@/components/Avatar';
import valthorneLogo from '@/assets/valthorne.png';

interface AuthSession {
  access_token: string;
  username: string;
  uuid: string;
  user_type: string;
  expires_at?: number;
  refresh_token?: string;
}

interface SidebarProps {
  onHomeSelect: () => void;
  handleSettingsToggle: () => void;
  handleSkinToggle: () => void;
  currentUser?: AuthSession | null;
  settingsOpen?: boolean;
  isHome?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  onHomeSelect,
  handleSettingsToggle,
  handleSkinToggle,
  currentUser,
  settingsOpen = false,
  isHome = false,
}) => {
  return (
    <div className="fixed left-0 top-0 h-full w-20 glass border-r border-white/10 z-40">
      <div className="h-full flex flex-col relative p-2">
        {/* Home / logo button */}
        <div className="relative group flex items-center justify-center mb-4">
          <div
            onClick={() => onHomeSelect()}
            className={`w-14 h-14 rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 ease-out hover:scale-105 ${
              isHome ? 'ring-2 ring-[#d4af37]' : 'ring-1 ring-white/10 hover:ring-white/20'
            }`}
            style={
              isHome
                ? { boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.5), 0 0 20px rgba(212, 175, 55, 0.6)' }
                : {}
            }
          >
            <img src={valthorneLogo} alt="Valthorne" className="w-full h-full object-cover select-none" />
          </div>
          <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50">
            <div className="glass-card text-white text-xs px-2 py-1 rounded-xl whitespace-nowrap shadow-lg border border-white/10">Inicio</div>
          </div>
        </div>

        <div className="flex-1" />

        {/* Bottom buttons */}
        <div className="space-y-3">
          {/* Skin Management Button */}
          {currentUser && (
            <div className="relative group flex items-center justify-center">
              <div
                onClick={() => handleSkinToggle()}
                className="cursor-pointer transition-all duration-300 ease-out hover:scale-105"
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
              <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50">
                <div className="glass-card text-white text-xs px-2 py-1 rounded-xl whitespace-nowrap shadow-lg border border-white/10">Cambiar Skin</div>
              </div>
            </div>
          )}

          <div className="relative group flex items-center justify-center">
            <svg
              onClick={() => handleSettingsToggle()}
              className={`w-12 h-12 cursor-pointer transition-[transform,color,filter] duration-500 ease-in-out ${
                settingsOpen ? 'text-white' : 'text-white/70 hover:text-white'
              } ${settingsOpen ? '' : 'hover:scale-110'}`}
              style={{
                transformOrigin: 'center center',
                filter: settingsOpen
                  ? 'drop-shadow(0 0 8px rgba(212, 175, 55, 0.6)) drop-shadow(0 0 16px rgba(212, 175, 55, 0.4))'
                  : 'drop-shadow(0 0 0 rgba(212, 175, 55, 0))',
                transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.3s ease-out, filter 0.3s ease-out',
              }}
              onMouseEnter={(e) => {
                if (!settingsOpen) {
                  e.currentTarget.style.filter = 'drop-shadow(0 0 8px rgba(212, 175, 55, 0.6)) drop-shadow(0 0 16px rgba(212, 175, 55, 0.4))';
                  e.currentTarget.style.transform = 'scale(1.1) rotate(15deg)';
                }
              }}
              onMouseLeave={(e) => {
                if (!settingsOpen) {
                  e.currentTarget.style.filter = 'drop-shadow(0 0 0 rgba(212, 175, 55, 0))';
                  e.currentTarget.style.transform = 'scale(1) rotate(0deg)';
                } else {
                  e.currentTarget.style.filter = 'drop-shadow(0 0 8px rgba(212, 175, 55, 0.6)) drop-shadow(0 0 16px rgba(212, 175, 55, 0.4))';
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
  );
};

export default Sidebar;
