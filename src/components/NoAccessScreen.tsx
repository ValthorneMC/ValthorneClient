import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface NoAccessScreenProps {
  onLogout: () => void;
  username?: string;
}

const NoAccessScreen: React.FC<NoAccessScreenProps> = ({ onLogout, username }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-black via-[#0a0a0a] to-black">
      {/* Content */}
      <div className="relative z-20 h-full flex items-center justify-center p-6">
        <div className={`w-full max-w-lg transition-all duration-500 ease-out ${
          isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'
        }`}>
          
          {/* Glass Card */}
          <div className="glass-card rounded-3xl p-12 text-center space-y-8 animate-slide-up">
            {/* Icon/Title */}
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#ff00ff]/20 to-[#00ffff]/20 border-2 border-[#ff00ff]/30 flex items-center justify-center">
                  <svg 
                    className="w-10 h-10 text-[#ff00ff]" 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={2} 
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
                    />
                  </svg>
                </div>
              </div>
              
              <h1 className="text-4xl font-bold text-white tracking-tight">
                Sin Acceso
              </h1>
            </div>

            {/* Message */}
            <div className="space-y-3">
              <p className="text-gray-300 text-lg leading-relaxed">
                El acceso a las instancias está restringido en este momento.
              </p>
              <p className="text-gray-400 text-sm">
                Si estás esperando participar en un evento, proporciona tu nombre de usuario de Minecraft 
                al organizador del evento a través del canal de Discord apropiado.
              </p>
              {username && (
                <p className="text-gray-500 text-sm mt-4">
                  Estás actualmente conectado como <span className="text-gray-300 font-medium">"{username}"</span>.
                </p>
              )}
            </div>

            {/* Logout Button */}
            <div className="pt-4">
              <Button
                onClick={onLogout}
                className="bg-gradient-to-r from-[#ff00ff]/20 to-[#ff0080]/20 hover:from-[#ff00ff]/30 hover:to-[#ff0080]/30 
                         text-white border-2 border-[#ff00ff]/40 hover:border-[#ff00ff]/60 
                         rounded-xl px-8 py-3 text-base font-semibold 
                         transition-all duration-300 ease-out
                         hover:scale-105 neon-glow-magenta-hover
                         shadow-lg"
              >
                Cerrar Sesión
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NoAccessScreen;
