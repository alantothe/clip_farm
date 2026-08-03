import type { StoredImage } from '../types'
import { request } from './client'

export const listStoredImages = () => request<StoredImage[]>('/api/storage/images')

export const uploadStoredImage = (image: File) => {
  const body = new FormData()
  body.append('image', image)
  return request<StoredImage>('/api/storage/images', { method: 'POST', body })
}

export const deleteStoredImage = (imageId: string) =>
  request<{ deleted: number }>(`/api/storage/images/${imageId}`, { method: 'DELETE' })
