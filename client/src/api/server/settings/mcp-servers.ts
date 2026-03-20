import axios from 'axios';
import { ApiError } from '../../errors/ApiError';
import { handleApiError } from '../../errors/handleApiError';
import {
  GetMcpServersResponseSchema,
  GetMcpToolsResponseSchema,
  UpdateMcpServersResponseSchema
} from './schemas';
import type {
  GetMcpServersResponse,
  GetMcpToolsResponse,
  McpServersConfig,
  UpdateMcpServersResponse
} from './schemas';

export async function getMcpServers(): Promise<GetMcpServersResponse> {
  try {
    const response = await axios.get('/api/settings/mcp-servers');
    return GetMcpServersResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function getMcpTools(): Promise<GetMcpToolsResponse> {
  try {
    const response = await axios.get('/api/settings/mcp-tools');
    return GetMcpToolsResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function updateMcpServers(
  mcpServers: McpServersConfig
): Promise<UpdateMcpServersResponse> {
  try {
    const response = await axios.put('/api/settings/mcp-servers', {
      mcpServers
    });
    return UpdateMcpServersResponseSchema.parse(response.data);
  } catch (error) {
    // Prioritize the detail field (per API spec)
    if (axios.isAxiosError(error)) {
      throw new ApiError(
        error.response?.data?.detail || error.response?.data?.message || null,
        error.response?.status || null
      );
    }
    handleApiError(error);
  }
}
