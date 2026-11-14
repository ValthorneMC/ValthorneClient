import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('common');
  const [avatarUrl, setAvatarUrl] = useState<string>(createAvatarPlaceholder(username, size));
  const [isLoading, setIsLoading] = useState(true);

  const generation = useRef(0);
  const failedUrls = useRef(new Set<string>());

  useEffect(() => {
    generation.current++;
    failedUrls.current.clear();
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
      generation.current++;
    };
  }, [uuid, username, size, overlay]);

  return (
    <img
      src={avatarUrl}
      onError={async () => {
        if (avatarUrl.startsWith('data:')) return;
        const current = generation.current;
        if (failedUrls.current.size || failedUrls.current.has(avatarUrl)) {
          setAvatarUrl(createAvatarPlaceholder(username, size));
          return;
        }
        failedUrls.current.add(avatarUrl);
        const next = await loadAvatarWithFallback(uuid, username, size, overlay, avatarUrl);
        if (current === generation.current) setAvatarUrl(next);
      }}
      alt={alt || t('account.avatarAlt', { username })}
      className={className}
      style={{ opacity: isLoading ? 0.8 : 1 }}
    />
  );
};

