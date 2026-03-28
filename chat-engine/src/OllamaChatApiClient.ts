import { LocalChatApiClient } from './LocalChatApiClient';

// --- Ollama API types (GET /api/ps) ---

interface OllamaPsResponse {
  models: OllamaPsEntry[];
}

interface OllamaPsEntry {
  name: string;
  model: string;
  size: number;
  digest: string;
  details: OllamaPsDetails;
  expires_at: string;
  size_vram: number;
  context_length: number;
}

interface OllamaPsDetails {
  parent_model: string;
  format: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization_level: string;
}

// --- Ollama API types (POST /api/show) ---

interface OllamaShowResponse {
  parameters: string;
  license: string;
  modified_at: string;
  template: string;
  details: OllamaShowDetails;
  model_info: OllamaModelInfoMap;
  capabilities: string[];
}

interface OllamaShowDetails {
  parent_model: string;
  format: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization_level: string;
}

/**
 * Dynamic key-value map from Ollama's model_info.
 * Keys follow the pattern "<architecture>.<property>" (e.g. "gemma3.context_length").
 * Values are strings or numbers depending on the property.
 */
interface OllamaModelInfoMap {
  [key: string]: string | number;
}

// --- Ollama API types (POST /api/generate) ---

interface OllamaGenerateRequest {
  model: string;
  prompt?: string;
  stream?: boolean;
  options?: OllamaModelOptions;
  keep_alive?: string | number;
}

interface OllamaModelOptions {
  num_ctx?: number;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  seed?: number;
  num_predict?: number;
  stop?: string | string[];
}

// ---

export class OllamaChatApiClient extends LocalChatApiClient {
  /**
   * Fetch the max context length from Ollama's /api/show endpoint.
   */
  async getMaxContextLength(): Promise<number | null> {
    const url = `${this.apiBaseUrl}/api/show`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model }),
    });
    if (!response.ok) return null;

    const json = (await response.json()) as OllamaShowResponse;
    const modelInfo = json.model_info;
    if (!modelInfo) return null;

    for (const [key, value] of Object.entries(modelInfo)) {
      if (key.endsWith('.context_length') && typeof value === 'number') {
        return value;
      }
    }
    return null;
  }

  /**
   * Ensure the model is loaded with max context length.
   * Pre-loads via POST /api/generate so that subsequent requests
   * through /v1/chat/completions use the already-loaded model
   * with the correct context size.
   */
  protected override async loadModelIfNeeded(): Promise<void> {
    const maxContext = await this.getMaxContextLength();
    if (!maxContext || maxContext <= 0) return;

    const running = await this.findRunningModel();
    if (running && running.context_length >= maxContext) return;

    // Not running, or running below max — (re)load with max context
    await this.loadWithContext(maxContext);
  }

  private async findRunningModel(): Promise<OllamaPsEntry | null> {
    const url = `${this.apiBaseUrl}/api/ps`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) return null;

    const json = (await response.json()) as OllamaPsResponse;
    return (
      json.models.find(
        (m) => m.name === this.model || m.model === this.model
      ) ?? null
    );
  }

  /**
   * Load the model with the specified context length.
   * Uses POST /api/generate with model + options only (no prompt).
   */
  private async loadWithContext(numCtx: number): Promise<void> {
    const url = `${this.apiBaseUrl}/api/generate`;
    const request: OllamaGenerateRequest = {
      model: this.model,
      stream: false,
      options: { num_ctx: numCtx },
    };
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
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
