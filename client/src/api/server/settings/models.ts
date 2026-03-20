import axios from 'axios';
import { z } from 'zod';
import { handleApiError } from '../../errors/handleApiError';
import {
  ModelSchema,
  GetModelsResponseSchema,
  GetAvailableModelsResponseSchema
} from './schemas';
import type {
  Model,
  GetModelsResponse,
  AddModelRequest,
  AvailableModel
} from './schemas';

export async function getModels(): Promise<GetModelsResponse> {
  try {
    const response = await axios.get('/api/settings/models');
    return GetModelsResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function addModel(data: AddModelRequest): Promise<Model> {
  try {
    const response = await axios.post('/api/settings/models', data);
    const validated = z.object({ model: ModelSchema }).parse(response.data);
    return validated.model;
  } catch (error) {
    handleApiError(error);
  }
}

export async function deleteModel(id: string): Promise<void> {
  try {
    await axios.delete(`/api/settings/models/${id}`);
  } catch (error) {
    handleApiError(error);
  }
}

export async function setActiveModel(activeId: string): Promise<void> {
  try {
    await axios.patch('/api/settings/models/active', { activeId });
  } catch (error) {
    handleApiError(error);
  }
}

export async function getAvailableModels(
  baseUrl: string,
  token?: string
): Promise<AvailableModel[]> {
  try {
    const params: Record<string, string> = { baseUrl };
    if (token) params.token = token;
    const response = await axios.get('/api/settings/models/available', {
      params
    });
    const validated = GetAvailableModelsResponseSchema.parse(response.data);
    return validated.models;
  } catch (error) {
    handleApiError(error);
  }
}
