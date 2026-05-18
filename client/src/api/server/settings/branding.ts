import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import { BrandingResponseSchema } from './schemas';
import type { BrandingResponse, UpdateBrandingRequest } from './schemas';
import { detectBrandingMimeType } from './brandingImageUtils';

export async function getBranding(): Promise<BrandingResponse> {
  try {
    const response = await axios.get('/api/settings/branding');
    return BrandingResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function updateBranding(
  data: UpdateBrandingRequest
): Promise<BrandingResponse> {
  try {
    const response = await axios.put('/api/settings/branding', data);
    return BrandingResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

async function putBrandingAsset(
  target: 'logo' | 'favicon',
  file: File
): Promise<BrandingResponse> {
  const mimeType = await detectBrandingMimeType(file);
  try {
    const buffer = await file.arrayBuffer();
    const response = await axios.put(
      `/api/settings/branding/${target}`,
      buffer,
      { headers: { 'Content-Type': mimeType } }
    );
    return BrandingResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

async function deleteBrandingAsset(
  target: 'logo' | 'favicon'
): Promise<BrandingResponse> {
  try {
    const response = await axios.delete(`/api/settings/branding/${target}`);
    return BrandingResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export function uploadBrandingLogo(file: File): Promise<BrandingResponse> {
  return putBrandingAsset('logo', file);
}

export function resetBrandingLogo(): Promise<BrandingResponse> {
  return deleteBrandingAsset('logo');
}

export function uploadBrandingFavicon(file: File): Promise<BrandingResponse> {
  return putBrandingAsset('favicon', file);
}

export function resetBrandingFavicon(): Promise<BrandingResponse> {
  return deleteBrandingAsset('favicon');
}
