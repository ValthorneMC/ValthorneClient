import fabricIcon from '@/assets/icons/fabricmc.svg';
import forgeIcon from '@/assets/icons/forge.svg';
import neoforgeIcon from '@/assets/icons/neoforge.svg';
import vanillaIcon from '@/assets/icons/minecraft.svg';

const BY_TYPE: Record<string, string> = {
  fabric: fabricIcon,
  forge: forgeIcon,
  neoforge: neoforgeIcon,
  vanilla: vanillaIcon,
};

export function modLoaderIconSrc(type: string | undefined | null): string {
  if (!type) return vanillaIcon;
  const key = type.toLowerCase();
  return BY_TYPE[key] ?? vanillaIcon;
}

/** Forge logo is full-color (MinecraftForge repo); Fabric/NeoForge assets here are black SVGs. */
export function modLoaderIconInvertFilter(type: string | undefined | null): boolean {
  return (type?.toLowerCase() ?? '') !== 'forge';
}
