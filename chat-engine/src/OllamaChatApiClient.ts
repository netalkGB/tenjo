import { LocalChatApiClient } from './LocalChatApiClient';

// --- Ollama API types (GET /api/ps) ---

interface OllamaPsResponse {
  models: OllamaPsEntry[];
}

interface OllamaPsEntry {
  name: string;
  model: string;
  context_length: number;
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
  stream: false;
  options: {
    num_ctx: number;
  };
}

export class OllamaChatApiClient extends LocalChatApiClient {
  private modelLoaded = false;
  private modelLoadPromise: Promise<void> | null = null;

  /**
   * Fetch the max context length from Ollama's /api/show endpoint.
   */
  async getMaxContextLength(): Promise<number | null> {
    const url = `${this.apiBaseUrl}/api/show`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
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

  protected override async getChatCompletionRequestOptions(): Promise<
    Record<string, unknown>
  > {
    await this.ensureModelLoaded();
    return {};
  }

  private async ensureModelLoaded(): Promise<void> {
    if (this.modelLoaded) return;
    if (this.modelLoadPromise) {
      await this.modelLoadPromise;
      return;
    }

    const load = this.loadModelIfNeeded().then(() => {
      this.modelLoaded = true;
    });
    this.modelLoadPromise = load;
    try {
      await load;
    } finally {
      if (this.modelLoadPromise === load) {
        this.modelLoadPromise = null;
      }
    }
  }

  private async loadModelIfNeeded(): Promise<void> {
    const contextLength = await this.getMaxContextLength();
    if (!contextLength || contextLength <= 0) return;

    const running = await this.findRunningModel();
    if (!running || running.context_length < contextLength) {
      await this.loadWithContext(contextLength);
    }
  }

  private async findRunningModel(): Promise<OllamaPsEntry | null> {
    const url = `${this.apiBaseUrl}/api/ps`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
    if (!response.ok) return null;

    const json = (await response.json()) as OllamaPsResponse;
    return (
      json.models.find(
        (entry) => entry.name === this.model || entry.model === this.model
      ) ?? null
    );
  }

  private async loadWithContext(contextLength: number): Promise<void> {
    const url = `${this.apiBaseUrl}/api/generate`;
    const request: OllamaGenerateRequest = {
      model: this.model,
      stream: false,
      options: { num_ctx: contextLength },
    };
    await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
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
