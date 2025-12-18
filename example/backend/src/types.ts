// This import makes the file a module, enabling proper module augmentation
// Without it, `declare module` creates an ambient module that REPLACES the real one
import 'aidk';

declare module "aidk" {
  interface UserContext {
    user_id: string;
    tenant_id: string;
    request_id: string;
    auth_token?: string;
    ip_address?: string;
  }

  interface EngineContextMetadata {
    thread_id?: string;
    user_id?: string;
  }

}