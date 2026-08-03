
export interface SkinData {
  id: string;
  name: string;
  file?: File;
  fileData?: ArrayBuffer;
  url: string;
  textureId: string;
  variant: 'classic' | 'slim';
  uploadedAt: Date;
  isActive: boolean;
  isMojangSynced?: boolean; // Indica si la skin proviene de Mojang
  // True for a skin that is currently active on Mojang but isn't saved in the local
  // library (e.g. changed from minecraft.net or another launcher). Synthesized on the
  // fly from the Mojang profile response, never persisted as-is.
  isExternal?: boolean;
}

export interface CapeData {
  id: string;
  state: 'ACTIVE' | 'INACTIVE' | string;
  url: string;
  alias: string;
}

export type SkinModel = 'classic' | 'slim';
