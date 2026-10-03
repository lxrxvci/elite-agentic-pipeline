'use client'

import * as React from 'react'
import { Circle, Loader2, Pause, Play, Square, Trash2, UploadCloud, Video } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { SopVideoRow } from '@/server/sop-videos'
// Server actions load dynamically inside the handlers (the same seam the
// drawer uses) so jsdom tests render without a database.
import { cn } from '@/shared/lib/utils'

/**
 * K2 (meeting 09_30, 01:16:00): the in-house recorder - "the task pops up,
 * they should be able to click record SOP and it should just pop up a
 * recorder that says let's start recording." getDisplayMedia captures the
 * screen (the browser's own picker: whole screen, window, or tab), the mic
 * mixes in via AudioContext, and MediaRecorder encodes webm (mp4 fallback
 * for Safari). Pause/resume/restart mid-stream, preview before committing,
 * then upload (client-direct to the blob store in prod, multipart POST in
 * dev) and register against the SOP.
 */

type Stage = 'idle' | 'recording' | 'paused' | 'preview' | 'uploading'

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
] as const

/** First recorder MIME the browser supports; exported for tests. */
export function pickRecorderMimeType(isSupported: (t: string) => boolean): string {
  for (const t of MIME_CANDIDATES) {
    if (isSupported(t)) return t
  }
  return ''
}

/** Extension matching the negotiated MIME (register/validation need it). */
export function extensionForMime(mimeType: string): 'webm' | 'mp4' {
  return mimeType.includes('mp4') ? 'mp4' : 'webm'
}

function formatElapsed(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60)
  const s = totalSecs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatVideoSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export interface SopRecorderDialogProps {
  sopTemplateId: number
  sopTitle: string
  open: boolean
  onClose: () => void
  onRegistered: (row: SopVideoRow) => void
}

export function SopRecorderDialog({ sopTemplateId, sopTitle, open, onClose, onRegistered }: SopRecorderDialogProps) {
  const [stage, setStage] = React.useState<Stage>('idle')
  const [title, setTitle] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [elapsed, setElapsed] = React.useState(0)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)

  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamsRef = React.useRef<MediaStream[]>([])
  const audioCtxRef = React.useRef<AudioContext | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const blobRef = React.useRef<Blob | null>(null)
  const mimeRef = React.useRef<string>('video/webm')
  const elapsedRef = React.useRef(0)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const releaseStreams = React.useCallback(() => {
    for (const s of streamsRef.current) s.getTracks().forEach((t) => t.stop())
    streamsRef.current = []
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
  }, [])

  const reset = React.useCallback(() => {
    stopTimer()
    recorderRef.current = null
    chunksRef.current = []
    blobRef.current = null
    releaseStreams()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setElapsed(0)
    elapsedRef.current = 0
    setError(null)
    setStage('idle')
  }, [previewUrl, releaseStreams])

  // Closing the dialog mid-recording releases the capture.
  React.useEffect(() => {
    if (!open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const startTimer = () => {
    stopTimer()
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1
      setElapsed(elapsedRef.current)
    }, 1000)
  }

  const start = async () => {
    setError(null)
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: true,
      })
      let mic: MediaStream | null = null
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        mic = null // mic is nice-to-have; screen audio still records
      }
      streamsRef.current = mic ? [display, mic] : [display]

      const videoTrack = display.getVideoTracks()[0]
      const audioTracks: MediaStreamTrack[] = [
        ...display.getAudioTracks(),
        ...(mic ? mic.getAudioTracks() : []),
      ]
      let mixed: MediaStream
      if (audioTracks.length > 1 && typeof AudioContext !== 'undefined') {
        const ctx = new AudioContext()
        audioCtxRef.current = ctx
        const dest = ctx.createMediaStreamDestination()
        for (const stream of streamsRef.current) {
          if (stream.getAudioTracks().length > 0) ctx.createMediaStreamSource(stream).connect(dest)
        }
        mixed = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()])
      } else {
        mixed = new MediaStream([videoTrack, ...audioTracks])
      }

      const mime = pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t))
      const recorder = new MediaRecorder(mixed, mime ? { mimeType: mime } : undefined)
      recorderRef.current = recorder
      mimeRef.current = recorder.mimeType || mime || 'video/webm'
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current.split(';')[0] })
        blobRef.current = blob
        setPreviewUrl(URL.createObjectURL(blob))
        setStage('preview')
        releaseStreams()
      }
      // Stopping the share from the browser chrome ends the recording too.
      videoTrack.onended = () => {
        if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
      }
      recorder.start(1000)
      elapsedRef.current = 0
      setElapsed(0)
      setStage('recording')
      startTimer()
    } catch {
      setError('Screen sharing was not allowed - the recorder needs it to capture your screen.')
      releaseStreams()
    }
  }

  const pauseOrResume = () => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === 'recording') {
      recorder.pause()
      stopTimer()
      setStage('paused')
    } else if (recorder.state === 'paused') {
      recorder.resume()
      startTimer()
      setStage('recording')
    }
  }

  const stop = () => {
    stopTimer()
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
  }

  const upload = async () => {
    const blob = blobRef.current
    if (!blob) return
    setStage('uploading')
    setError(null)
    try {
      const ext = extensionForMime(mimeRef.current)
      const fileName = `sop-${sopTemplateId}-${Date.now()}.${ext}`
      const m = await import('@/server/actions/sop-videos')
      const modeRes = await m.sopVideoUploadModeAction()
      if (!modeRes.ok) throw new Error(modeRes.error)
      let storedPath: string
      let sizeBytes = blob.size
      if (modeRes.data.mode === 'vercel-blob') {
        const { upload: clientUpload } = await import('@vercel/blob/client')
        const result = await clientUpload(`sop-videos/${sopTemplateId}/${fileName}`, blob, {
          access: 'private',
          handleUploadUrl: '/api/sop-videos/upload',
          contentType: blob.type,
        })
        storedPath = result.pathname
      } else {
        const form = new FormData()
        form.set('sopTemplateId', String(sopTemplateId))
        form.set('file', new File([blob], fileName, { type: blob.type }))
        const res = await fetch('/api/sop-videos/upload', { method: 'POST', body: form })
        const data = (await res.json()) as { storedPath?: string; sizeBytes?: number; error?: string }
        if (!res.ok || !data.storedPath) throw new Error(data.error ?? 'The upload failed - try again.')
        storedPath = data.storedPath
        sizeBytes = data.sizeBytes ?? blob.size
      }
      const reg = await m.registerSopVideoAction({
        sopTemplateId,
        title: title.trim() || `${sopTitle} walkthrough`,
        storedPath,
        mimeType: blob.type || `video/${ext}`,
        sizeBytes,
        durationSecs: elapsedRef.current > 0 ? elapsedRef.current : null,
      })
      if (!reg.ok) throw new Error(reg.error)
      toast.success('The walkthrough is on the SOP.')
      onRegistered(reg.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload failed - try again.')
      setStage('preview')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl" data-testid="sop-recorder-dialog">
        <DialogHeader>
          <DialogTitle>Record SOP walkthrough</DialogTitle>
          <DialogDescription>
            Records your screen and microphone for &quot;{sopTitle}&quot; - the video lands right on the SOP.
          </DialogDescription>
        </DialogHeader>

        {stage === 'idle' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="sop-video-title" className="mb-1 block text-xs font-medium text-muted-foreground">
                Video title
              </label>
              <input
                id="sop-video-title"
                data-testid="sop-video-title"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                placeholder={`${sopTitle} walkthrough`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <Button type="button" variant="action" onClick={() => void start()} data-testid="sop-record-start" className="w-full">
              <Video className="h-4 w-4" aria-hidden />
              Start recording
            </Button>
            <p className="text-xs text-muted-foreground">
              Your browser asks which screen, window, or tab to share. Stop anytime - you can preview before saving.
            </p>
          </div>
        )}

        {(stage === 'recording' || stage === 'paused') && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2.5 rounded-lg border border-border bg-muted/50 px-4 py-6">
              <span className={cn('relative flex h-3 w-3', stage === 'paused' && 'opacity-40')}>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-overdue opacity-60" />
                <Circle className="relative inline-flex h-3 w-3 fill-status-overdue text-status-overdue" aria-hidden />
              </span>
              <span className="tnum text-lg font-semibold text-foreground" data-testid="sop-record-elapsed">
                {formatElapsed(elapsed)}
              </span>
              {stage === 'paused' && <span className="text-xs font-medium text-muted-foreground">paused</span>}
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button type="button" variant="outline" onClick={pauseOrResume} data-testid="sop-record-pause">
                {stage === 'paused' ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
                {stage === 'paused' ? 'Resume' : 'Pause'}
              </Button>
              <Button type="button" variant="outline" onClick={reset} data-testid="sop-record-restart">
                <Trash2 className="h-4 w-4" aria-hidden />
                Restart
              </Button>
              <Button type="button" variant="action" onClick={stop} data-testid="sop-record-stop">
                <Square className="h-4 w-4" aria-hidden />
                Stop
              </Button>
            </div>
          </div>
        )}

        {(stage === 'preview' || stage === 'uploading') && previewUrl && (
          <div className="space-y-4">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- staff training capture, no caption track */}
            <video
              src={previewUrl}
              controls
              className="w-full rounded-lg border border-border bg-black"
              data-testid="sop-record-preview"
            />
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={reset} disabled={stage === 'uploading'} data-testid="sop-record-rerecord">
                Re-record
              </Button>
              <Button type="button" variant="action" onClick={() => void upload()} disabled={stage === 'uploading'} data-testid="sop-record-use">
                {stage === 'uploading' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Uploading…
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-4 w-4" aria-hidden />
                    Use this video
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm font-medium text-status-overdue" role="alert" data-testid="sop-record-error">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The shape any surface needs to render + manage a video (a subset of the
 *  full SopVideoRow - the drawer's detail read carries exactly this). */
export interface SopVideoSummary {
  id: number
  title: string
  durationSecs: number | null
  sizeBytes: number
}

/**
 * The playback half: a SOP's videos with embedded players. Staff watch
 * anywhere the SOP surfaces; deleting stays behind can_edit_sops (the
 * caller passes canEdit) and is audited server-side.
 */
export function SopVideoList({
  videos,
  canEdit,
  onDeleted,
}: {
  videos: SopVideoSummary[]
  canEdit: boolean
  onDeleted: (videoId: number) => void
}) {
  const [busyId, setBusyId] = React.useState<number | null>(null)

  const remove = async (videoId: number) => {
    setBusyId(videoId)
    const m = await import('@/server/actions/sop-videos')
    const res = await m.deleteSopVideoAction(videoId)
    setBusyId(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('The video was deleted.')
    onDeleted(videoId)
  }

  if (videos.length === 0) return null
  return (
    <ul className="space-y-3" data-testid="sop-video-list">
      {videos.map((v) => (
        <li key={v.id} className="rounded-lg border border-border bg-card p-2.5" data-testid={`sop-video-${v.id}`}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- staff training capture, no caption track */}
          <video
            src={`/api/sop-videos/${v.id}`}
            controls
            preload="metadata"
            className="w-full rounded-md bg-black"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5">
            <span className="min-w-0 truncate text-xs font-medium text-foreground" title={v.title}>
              {v.title}
              <span className="tnum ml-1.5 text-muted-foreground">
                {v.durationSecs != null && `${formatElapsed(v.durationSecs)} · `}
                {formatVideoSize(v.sizeBytes)}
              </span>
            </span>
            {canEdit && (
              <button
                type="button"
                aria-label={`Delete ${v.title}`}
                data-testid={`sop-video-delete-${v.id}`}
                disabled={busyId === v.id}
                onClick={() => void remove(v.id)}
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-status-overdue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
