import { ChannelService } from "aidk";
import { createSSETransport } from "aidk-express";

import { todoListChannel } from "./todo-list.channel";
import { scratchpadChannel } from "./scratchpad.channel";

export * from "./scratchpad.channel";
export * from "./todo-list.channel";

export const transport = createSSETransport({
  debug: true, // Enable SSE debug logging
  autoJoinRooms: (metadata: Record<string, unknown>) => {
    console.log(`📡 autoJoinRooms called with metadata:`, metadata);
    const rooms = [
      metadata.userId && `user:${metadata.userId}`,
      metadata.threadId && `thread:${metadata.threadId}`,
    ].filter(Boolean) as string[];
    console.log(`📡 Auto-joining rooms: ${rooms.join(", ") || "(none)"}`);
    return rooms;
  },
});

export const channels = new ChannelService({
  // Create SSE transport with auto-join rooms based on userId and threadId
  transport,
  // Use sessionId from context metadata (set by HTTP route)
  sessionIdGenerator: (ctx) => (ctx.metadata?.["sessionId"] as string) || "default",
  // Register channel routers for handleEvent() dispatch
  routers: [todoListChannel, scratchpadChannel],
});
