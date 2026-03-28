import { LocalChatApiClient } from './LocalChatApiClient';

// --- LM Studio API types (v0: GET /api/v0/models) ---

interface LmStudioV0ModelsResponse {
  object: string;
  data: LmStudioV0ModelEntry[];
}

interface LmStudioV0ModelEntry {
  id: string;
  object: string;
  type: string;
  publisher: string;
  arch: string;
  compatibility_type: string;
  quantization: string;
  state: 'loaded' | 'not-loaded';
  max_context_length: number;
  /** Present only when state is "loaded". */
  loaded_context_length?: number;
  capabilities?: string[];
}

// --- LM Studio API types (v1: POST /api/v1/models/load) ---

interface LmStudioLoadModelRequest {
  model: string;
  context_length?: number;
  eval_batch_size?: number;
  flash_attention?: boolean;
  num_experts?: number;
  offload_kv_cache_to_gpu?: boolean;
  echo_load_config?: boolean;
}

interface LmStudioLoadModelResponse {
  type: 'llm' | 'embedding';
  instance_id: string;
  load_time_seconds: number;
  status: 'loaded';
  load_config?: LmStudioLoadConfig;
}

interface LmStudioLoadConfig {
  context_length: number;
  eval_batch_size?: number;
  flash_attention?: boolean;
  num_experts?: number;
  offload_kv_cache_to_gpu?: boolean;
}

// ---

export class LmStudioChatApiClient extends LocalChatApiClient {
  /**
   * Fetch the max context length from LM Studio's /api/v0/models endpoint.
   */
  async getMaxContextLength(): Promise<number | null> {
    const models = await this.fetchModels();
    const entry = models?.find((m) => m.id === this.model);
    return entry?.max_context_length ?? null;
  }

  protected override async loadModelIfNeeded(): Promise<void> {
    const models = await this.fetchModels();
    const entry = models?.find((m) => m.id === this.model);
    if (!entry) return;

    // Already loaded — use as-is regardless of context length.
    // Calling the load endpoint on an already-loaded model may
    // create a different variant (e.g. "model:2").
    if (entry.state === 'loaded') return;

    // Not loaded — load with max context
    await this.loadModel({
      model: entry.id,
      context_length: entry.max_context_length,
    });
  }

  private async fetchModels(): Promise<LmStudioV0ModelEntry[] | null> {
    const url = `${this.apiBaseUrl}/api/v0/models`;
    const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() });
    if (!response.ok) return null;

    const json = (await response.json()) as LmStudioV0ModelsResponse;
    return json.data ?? null;
  }

  private async loadModel(request: LmStudioLoadModelRequest): Promise<void> {
    const url = `${this.apiBaseUrl}/api/v1/models/load`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(request),
    });
    if (response.ok) {
      (await response.json()) as LmStudioLoadModelResponse;
    }
  }
}

export type {
  Status,
  ChatCompletionMessageRepsonse,
  ToolCallResponse,
  ChatCompletionMessageContent,
  ChatCompletionMessageTextContent,
  ChatCompletionMessageImageContent,
  ChatCompletionMessageRequest,
  ToolDefinitionRequest,
} from './OpenAIChatApiClient';
