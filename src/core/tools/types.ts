export type ToolRiskLevel = 'low' | 'medium' | 'high';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
}

export interface ToolDescriptor {
  name: string;
  /** One-line summary shown to the model. */
  description: string;
  parameters: ToolParameter[];
  risk: ToolRiskLevel;
  /** Execution domain: where the tool runs. */
  domain: 'browser' | 'shell' | 'agent';
}

export interface ToolCall {
  /** Stable id for de-duplication within a turn. */
  id: string;
  name: string;
  /** Parsed JSON arguments. */
  args: Record<string, unknown>;
  /** Raw text of the tool block, for fallback / debugging. */
  raw: string;
}

export interface ToolResult {
  callId: string;
  name: string;
  ok: boolean;
  /** Human/model-readable result text. */
  output: string;
  error?: string;
  /** Optional structured payload (e.g. a DOM snapshot). */
  data?: unknown;
}
