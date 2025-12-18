/**
 * MCP (Model Context Protocol) Module
 * 
 * Provides integration with MCP servers for external tool execution.
 */

export * from './types';
export * from './client';
export * from './service';
export * from './tool';
export { MCPToolComponent, MCPTool } from './component';
export { 
  createMCPTool, 
  createMCPToolFromDefinition, 
  discoverMCPTools,
  normalizeMCPConfig,
  mergeMCPConfig,
} from './create-mcp-tool';
export type {
  CreateMCPToolOptions,
  CreateMCPToolFromDefinitionOptions,
  DiscoverMCPToolsOptions,
} from './create-mcp-tool';