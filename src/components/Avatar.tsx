import React, { useState, useEffect } from 'react';
import { loadAvatarWithFallback, createAvatarPlaceholder } from '@/services/avatarService';

interface AvatarProps {
  uuid: string;
  username: string;
  size?: number;
  overlay?: boolean;
  className?: string;
  alt?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  uuid,
  username,
  size = 64,
  overlay = true,
  className = '',
  alt
}) => {
  const [avatarUrl, setAvatarUrl] = useState<string>(createAvatarPlaceholder(username, size));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadAvatar = async () => {
      setIsLoading(true);
      setAvatarUrl(createAvatarPlaceholder(username, size));
      
      try {
        const url = await loadAvatarWithFallback(uuid, username, size, overlay);
        if (!cancelled) {
          setAvatarUrl(url);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setAvatarUrl(createAvatarPlaceholder(username, size));
          setIsLoading(false);
        }
      }
    };

    loadAvatar();

    return () => {
      cancelled = true;
    };
  }, [uuid, username, size, overlay]);

  return (
    <img
      src={avatarUrl}
      alt={alt || `${username}'s avatar`}
      className={className}
      style={{ opacity: isLoading ? 0.8 : 1 }}
    />
  );
};

