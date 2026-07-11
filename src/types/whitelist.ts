export interface WhitelistEntry {
  minecraft_username: string;
  global_access: boolean;
  allowed_instances: string[] | null;
}

export interface AccessCheck {
  has_access: boolean;
  allowed_instances: string[];
  global_access: boolean;
}
