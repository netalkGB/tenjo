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

interface LmStudioLoadModelRequest {
  model: string;
  context_length?: number;
}

export class LmStudioChatApiClient extends LocalChatApiClient {
  private modelLoaded = false;
  private modelLoadPromise: Promise<void> | null = null;

  /**
   * Fetch the max context length from LM Studio's /api/v0/models endpoint.
   */
  async getMaxContextLength(): Promise<number | null> {
    const models = await this.fetchModels();
    const entry = models?.find((m) => m.id === this.model);
    return entry?.max_context_length ?? null;
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
    const entry = await this.getModelEntry();
    if (!entry) return;

    if (entry.state === 'not-loaded') {
      await this.loadModel({
        model: entry.id,
        context_length: entry.max_context_length,
      });
    }
  }

  private async fetchModels(): Promise<LmStudioV0ModelEntry[] | null> {
    const url = `${this.apiBaseUrl}/api/v0/models`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
    if (!response.ok) return null;

    const json = (await response.json()) as LmStudioV0ModelsResponse;
    return json.data ?? null;
  }

  private async getModelEntry(): Promise<LmStudioV0ModelEntry | null> {
    const models = await this.fetchModels();
    return models?.find((m) => m.id === this.model) ?? null;
  }

  private async loadModel(request: LmStudioLoadModelRequest): Promise<void> {
    const url = `${this.apiBaseUrl}/api/v1/models/load`;
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
