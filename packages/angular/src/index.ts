/**
 * Angular bindings for Engine Client
 * 
 * @example
 * ```typescript
 * // main.ts
 * import { provideEngine } from '@shared/angular';
 * 
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     provideEngine(),
 *   ],
 * });
 * 
 * // app.component.ts
 * import { EngineService, ExecutionService, ChannelsService } from '@shared/angular';
 * 
 * @Component({ ... })
 * export class AppComponent implements OnInit {
 *   constructor(
 *     private engineService: EngineService,
 *     private ngZone: NgZone,
 *   ) {}
 *   
 *   ngOnInit() {
 *     this.engineService.updateConfig({ userId: 'user-123' });
 *   }
 * }
 * ```
 */

export { provideEngine } from './engine.module';
export { EngineService } from './engine.service';
export { ExecutionService } from './execution.service';
export { ChannelsService } from './channels.service';

// Content block components
export {
  ContentBlockComponent,
  TextBlockComponent,
  ReasoningBlockComponent,
  ToolUseBlockComponent,
  ToolResultBlockComponent,
  ImageBlockComponent,
  CodeBlockComponent,
  PlaceholderBlockComponent,
} from './blocks';

// Re-export types from client for convenience
export type {
  EngineInput,
  ExecutionResult,
  EngineStreamEvent,
  ChannelEvent,
  Message,
  ContentBlock,
  TimelineEntry,
  EngineClientConfig,
} from 'aidk-client';
