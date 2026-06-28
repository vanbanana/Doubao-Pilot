import { getToolDescriptor } from './registry';
import type { ToolCall, ToolResult } from './types';
import { executeBrowserTool } from './browser-control';
import { executeShellTool } from './shell';

/**
 * Routes a tool call to its execution domain. Unknown tools fail fast with a
 * descriptive message so the model can recover.
 */
export async function dispatchToolCall(call: ToolCall): Promise<ToolResult> {
  const descriptor = getToolDescriptor(call.name);
  if (!descriptor) {
    return { callId: call.id, name: call.name, ok: false, output: `未知工具: ${call.name}`, error: 'unknown_tool' };
  }
  switch (descriptor.domain) {
    case 'browser':
      return executeBrowserTool(call);
    case 'shell':
      return executeShellTool(call);
    default:
      return { callId: call.id, name: call.name, ok: false, output: `工具 ${call.name} 暂不支持`, error: 'unsupported' };
  }
}
