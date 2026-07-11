import React from 'react';
import { Button } from '@/components/ui/button';
import Tooltip from '@/components/ui/Tooltip';
import { Avatar } from '@/components/Avatar';

interface AuthSession {
  access_token: string;
  username: string;
  uuid: string;
  user_type: string;
  expires_at?: number;
  refresh_token?: string;
}

interface Account {
  id: string;
  user: AuthSession;
  isActive: boolean;
}

interface UserProfileProps {
  accounts: Account[];
  currentAccount: Account | null;
  onSwitchAccount: (account: Account) => void;
  onLogoutAccount: (accountId: string) => void;
  onAddAccount: () => void;
}

const UserProfile: React.FC<UserProfileProps> = ({
  accounts,
  currentAccount,
  onSwitchAccount,
  onLogoutAccount,
  onAddAccount
}) => {

  return (
    <div className="flex items-center space-x-2 glass-card rounded-2xl px-4 py-2 border border-white/10 select-none backdrop-blur-md">
      
      <div className="flex items-center space-x-2">
        {accounts.map((account) => (
          <div key={account.id} className="relative">
            <Tooltip content={account.user.username} side="top">
              <div
                className={`w-8 h-8 rounded-xl border-2 cursor-pointer transition-all duration-300 ease-out select-none overflow-hidden ${
                  account.id === currentAccount?.id
                    ? 'border-[#00ffff] shadow-lg neon-glow-cyan scale-110'
                    : 'border-white/20 hover:border-[#00ffff]/50 hover:scale-105'
                }`}
                onClick={() => onSwitchAccount(account)}
              >
                <Avatar
                  uuid={account.user.uuid}
                  username={account.user.username}
                  size={32}
                  overlay={true}
                  className="w-full h-full object-cover"
                />
              </div>
            </Tooltip>
            
            {account.id === currentAccount?.id && (
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-[#00ffff] rounded-full border-2 border-black shadow-lg neon-glow-cyan"></div>
            )}
          </div>
        ))}
      </div>

      
      <Tooltip content="Añadir cuenta" side="top">
        <Button
          onClick={onAddAccount}
          size="sm"
          variant="ghost"
          className="w-8 h-8 p-0 text-white/60 hover:text-white glass-light hover:bg-white/10 rounded-xl border border-white/10 hover:border-[#00ffff]/30 cursor-pointer select-none transition-all duration-300 ease-out hover:scale-105"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </Button>
      </Tooltip>

      
      <Tooltip content="Cerrar sesión" side="top">
        <Button
          onClick={() => currentAccount && onLogoutAccount(currentAccount.id)}
          size="sm"
          variant="ghost"
          className="w-8 h-8 p-0 text-white/60 hover:text-[#ff00ff] glass-light hover:bg-[#ff00ff]/10 rounded-xl border border-white/10 hover:border-[#ff00ff]/30 cursor-pointer select-none transition-all duration-300 ease-out hover:scale-105 neon-glow-magenta-hover"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </Button>
      </Tooltip>
    </div>
  );
};

export default UserProfile;
