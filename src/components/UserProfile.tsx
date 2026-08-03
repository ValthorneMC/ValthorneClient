import React from 'react';
import { useTranslation } from 'react-i18next';
import { LogOut, Plus } from 'lucide-react';
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
  const { t } = useTranslation('common');

  return (
    <div className="flex items-center space-x-2 glass-card rounded-2xl px-4 py-2 border border-white/10 select-none backdrop-blur-md">
      
      <div className="flex items-center space-x-2">
        {accounts.map((account) => (
          <div key={account.id} className="relative">
            <Tooltip content={account.user.username} side="top">
              <div
                className={`w-8 h-8 rounded-xl border-2 cursor-pointer transition-all duration-300 ease-out select-none overflow-hidden ${
                  account.id === currentAccount?.id
                    ? 'border-[#d4af37] shadow-lg neon-glow-cyan scale-110'
                    : 'border-white/20 hover:border-[#d4af37]/50 hover:scale-105'
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
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-[#d4af37] rounded-full border-2 border-black shadow-lg neon-glow-cyan"></div>
            )}
          </div>
        ))}
      </div>

      
      <Tooltip content={t('account.add')} side="top">
        <Button
          onClick={onAddAccount}
          size="sm"
          variant="ghost"
          className="w-8 h-8 p-0 text-white/60 hover:text-white glass-light hover:bg-white/10 rounded-xl border border-white/10 hover:border-[#d4af37]/30 cursor-pointer select-none transition-all duration-300 ease-out hover:scale-105"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </Tooltip>

      
      <Tooltip content={t('account.logout')} side="top">
        <Button
          onClick={() => currentAccount && onLogoutAccount(currentAccount.id)}
          size="sm"
          variant="ghost"
          className="w-8 h-8 p-0 text-white/60 hover:text-[#7c4dbd] glass-light hover:bg-[#7c4dbd]/10 rounded-xl border border-white/10 hover:border-[#7c4dbd]/30 cursor-pointer select-none transition-all duration-300 ease-out hover:scale-105 neon-glow-magenta-hover"
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </Tooltip>
    </div>
  );
};

export default UserProfile;
