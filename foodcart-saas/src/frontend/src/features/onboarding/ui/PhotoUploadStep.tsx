'use client'

import { useCallback, useRef, useState } from 'react'
import { Button, Card } from '@/shared/ui'
import { usePresignedUpload } from '../api/usePresignedUpload'
import { compressImage } from '../lib/compressImage'
import { uploadImageToStorage } from '../lib/uploadImage'
import { trackUploadStep } from '@/shared/lib/telemetry'

interface PhotoUploadStepProps {
  onPhotoUploaded: (imageId: string, previewUrl: string) => void
  onSkip: () => void
}

type UploadStatus = 'idle' | 'compressing' | 'uploading' | 'success' | 'error'

export function PhotoUploadStep({ onPhotoUploaded, onSkip }: PhotoUploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const presignedUpload = usePresignedUpload()

  const handleSkip = useCallback(() => {
    trackUploadStep('skipped')
    onSkip()
  }, [onSkip])

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      setStatus('compressing')

      const compressionStart = Date.now()
      trackUploadStep('compression_started')

      let compressed: { blob: Blob; contentType: string }
      try {
        compressed = await compressImage(file)
      } catch {
        // Fall back to original file if compression fails.
        compressed = { blob: file, contentType: file.type }
      }

      trackUploadStep('compression_finished', Date.now() - compressionStart, {
        contentType: compressed.contentType,
        sizeBytes: compressed.blob.size,
      })

      const objectUrl = URL.createObjectURL(compressed.blob)
      setPreviewUrl(objectUrl)
      setStatus('uploading')

      const uploadStart = Date.now()
      trackUploadStep('upload_started')

      try {
        const presigned = await presignedUpload.mutateAsync({
          content_type: compressed.contentType,
          size_bytes: compressed.blob.size,
        })

        const { imageId, publicUrl } = await uploadImageToStorage(compressed.blob, presigned)
        trackUploadStep('upload_succeeded', Date.now() - uploadStart, { imageId })
        setStatus('success')
        onPhotoUploaded(imageId, publicUrl)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        trackUploadStep('upload_failed', Date.now() - uploadStart, { message })
        setStatus('error')
        setError(message)
      }
    },
    [onPhotoUploaded, presignedUpload]
  )

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    void handleFile(file)
    // Reset input so the same file can be selected again.
    event.target.value = ''
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file?.type.startsWith('image/')) {
      void handleFile(file)
    }
  }

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  const triggerFileInput = () => {
    inputRef.current?.click()
  }

  return (
    <div className="space-y-6">
      <p className="text-fc-text-secondary">
        Snap or upload a photo of your food cart. We&apos;ll use it to look up your business details and set it as your hero image.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onInputChange}
        data-testid="photo-file-input"
      />

      {!previewUrl && (
        <div className="space-y-4">
          <Card
            variant="dashed"
            className="p-8 text-center cursor-pointer hover:border-fc-cobalt-600 transition-colors"
            onClick={triggerFileInput}
            onDrop={onDrop}
            onDragOver={onDragOver}
            role="button"
            aria-label="Upload or drop a photo"
          >
            <div className="text-fc-text-secondary">
              <p className="font-medium">Click or drop a photo here</p>
              <p className="text-sm mt-1">JPEG, PNG, WebP, or HEIC up to 5 MB</p>
            </div>
          </Card>
          <div className="flex justify-center">
            <Button variant="ghost" onClick={handleSkip}>
              Skip this step
            </Button>
          </div>
        </div>
      )}

      {previewUrl && (
        <div className="space-y-4">
          <div className="relative aspect-video rounded-xl overflow-hidden bg-fc-neutral-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Preview of your food cart"
              className="w-full h-full object-contain"
            />
          </div>

          {status === 'compressing' && <p className="text-sm text-fc-text-secondary">Compressing...</p>}
          {status === 'uploading' && <p className="text-sm text-fc-text-secondary">Uploading...</p>}
          {status === 'success' && <p className="text-sm text-fc-success-text">Photo uploaded successfully.</p>}
          {error && <p className="text-sm text-fc-danger-text" role="alert">{error}</p>}

          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={triggerFileInput} disabled={status === 'uploading' || status === 'compressing'}>
              {status === 'success' ? 'Use a different photo' : 'Choose another photo'}
            </Button>
            {status !== 'success' && (
              <Button variant="ghost" onClick={handleSkip} disabled={status === 'uploading' || status === 'compressing'}>
                Skip this step
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
