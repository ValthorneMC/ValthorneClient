import fabricIcon from '@/assets/icons/fabricmc.svg';
import vanillaIcon from '@/assets/icons/minecraft.svg';

export function modLoaderIconSrc(type: string | undefined | null): string {
  return type?.toLowerCase() === 'fabric' ? fabricIcon : vanillaIcon;
}

/** The Fabric and vanilla assets are black SVGs, so they are inverted on the dark UI. */
export function modLoaderIconInvertFilter(_type: string | undefined | null): boolean {
  return true;
}
