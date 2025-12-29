import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Context } from 'aidk';

/**
 * Guard that ensures execution context is available.
 * Use this if you need to verify context before handler execution.
 */
@Injectable()
export class EngineContextGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    const ctx = Context.get();
    return !!ctx;
  }
}

