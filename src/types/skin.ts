
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
}

export interface SkinUploadResponse {
  success: boolean;
  textureId?: string;
  url?: string;
  error?: string;
}

export interface SkinPreviewProps {
  skinUrl?: string;
  variant?: 'classic' | 'slim';
  className?: string;
}

export interface SkinManagerProps {
  currentUser: any; // AuthSession
  onSkinChange?: (skinData: SkinData) => void;
}

export interface SkinUploaderProps {
  onUploadSuccess: (skinData: SkinData) => void;
  onUploadError: (error: string) => void;
  acceptedVariants?: ('classic' | 'slim')[];
}

export interface SkinSelectorProps {
  skins: SkinData[];
  currentSkin?: SkinData;
  onSkinSelect: (skin: SkinData) => void;
  onSkinDelete: (skinId: string) => void;
}

export type SkinModel = 'classic' | 'slim';

export interface MineSkinUploadRequest {
  file: string; // Base64 
  variant?: SkinModel;
}

export interface MineSkinUploadResponse {
  id: number;
  name: string;
  data: {
    texture: {
      value: string;
      signature: string;
      url: string;
    };
  };
}
