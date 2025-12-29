// This import makes the file a module, enabling proper module augmentation
// Without it, `declare module` creates an ambient module that REPLACES the real one
import 'aidk';

declare module "aidk" {
  interface UserContext {
    userId: string;
    tenantId: string;
    request_id: string;
    auth_token?: string;
    ip_address?: string;
  }

  interface EngineContextMetadata {
    threadId?: string;
    userId?: string;
  }

}