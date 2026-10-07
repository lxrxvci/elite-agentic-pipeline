import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * K2: the in-house SOP recorder's state machine - idle -> recording ->
 * paused/resumed -> preview -> upload -> registered - against mocked capture
 * APIs (jsdom has no getDisplayMedia/MediaRecorder) and mocked server actions.
 */

const registerSopVideoAction = vi.fn()
const deleteSopVideoAction = vi.fn()
const sopVideoUploadModeAction = vi.fn()

vi.mock('@/server/actions/sop-videos', () => ({
  registerSopVideoAction: (...args: unknown[]) => registerSopVideoAction(...args),
  deleteSopVideoAction: (...args: unknown[]) => deleteSopVideoAction(...args),
  sopVideoUploadModeAction: (...args: unknown[]) => sopVideoUploadModeAction(...args),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import {
  extensionForMime,
  formatVideoSize,
  pickRecorderMimeType,
  SopRecorderDialog,
  SopVideoList,
} from '../sop-recorder'

// ── Capture API fakes ─────────────────────────────────────────────────────

class FakeTrack {
  onended: (() => void) | null = null
  stop = vi.fn()
  kind: string
  constructor(kind: string) {
    this.kind = kind
  }
}

class FakeStream {
  private tracks: FakeTrack[]
  constructor(kinds: string[]) {
    this.tracks = kinds.map((k) => new FakeTrack(k))
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }
  getTracks() {
    return this.tracks
  }
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = (t: string) => t.startsWith('video/webm')
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType = 'video/webm;codecs=vp9,opus'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(public stream: unknown, public opts?: { mimeType?: string }) {
    if (opts?.mimeType) this.mimeType = opts.mimeType
    FakeMediaRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['webm-bytes'], { type: 'video/webm' }) })
    this.onstop?.()
  }
}

const realCreateObjectURL = URL.createObjectURL

beforeEach(() => {
  FakeMediaRecorder.instances = []
  registerSopVideoAction.mockReset()
  deleteSopVideoAction.mockReset()
  sopVideoUploadModeAction.mockReset()
  sopVideoUploadModeAction.mockResolvedValue({ ok: true, data: { mode: 'local', maxBytes: 500 * 1024 * 1024 } })
  registerSopVideoAction.mockResolvedValue({ ok: true, data: { id: 55, title: 'WEX walkthrough' } })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  // jsdom has no MediaStream either - the component only constructs it.
  vi.stubGlobal('MediaStream', class {
    constructor(public tracks: unknown[] = []) {}
  })
  const display = vi.fn(async () => new FakeStream(['video']))
  const user = vi.fn(async () => {
    throw new Error('no mic in jsdom')
  })
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: { getDisplayMedia: display, getUserMedia: user },
  })
  URL.createObjectURL = vi.fn(() => 'blob:fake-preview')
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ storedPath: 'sop-videos/7/1-walkthrough.webm', sizeBytes: 10 }),
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  URL.createObjectURL = realCreateObjectURL
})

describe('recorder MIME + formatting helpers', () => {
  it('picks the first supported candidate and maps the extension', () => {
    expect(pickRecorderMimeType(() => true)).toBe('video/webm;codecs=vp9,opus')
    expect(pickRecorderMimeType((t) => t === 'video/mp4')).toBe('video/mp4')
    expect(pickRecorderMimeType(() => false)).toBe('')
    expect(extensionForMime('video/webm;codecs=vp9,opus')).toBe('webm')
    expect(extensionForMime('video/mp4')).toBe('mp4')
    expect(formatVideoSize(2048)).toBe('2 KB')
    expect(formatVideoSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('SopRecorderDialog state machine', () => {
  it('recorder_requires_canEditSops flow: record -> pause -> resume -> stop -> preview -> upload -> registered', async () => {
    const onRegistered = vi.fn()
    render(
      <SopRecorderDialog sopTemplateId={7} sopTitle="WEX close" open onClose={() => {}} onRegistered={onRegistered} />,
    )

    // Idle: title input + the start affordance.
    fireEvent.change(screen.getByTestId('sop-video-title'), { target: { value: 'WEX walkthrough' } })
    fireEvent.click(screen.getByTestId('sop-record-start'))

    // Recording: the timer chrome and controls appear.
    expect(await screen.findByTestId('sop-record-elapsed')).toBeInTheDocument()
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    const recorder = FakeMediaRecorder.instances[0]

    // Pause/resume round trip.
    fireEvent.click(screen.getByTestId('sop-record-pause'))
    expect(recorder.state).toBe('paused')
    fireEvent.click(screen.getByTestId('sop-record-pause'))
    expect(recorder.state).toBe('recording')

    // Stop lands on the preview.
    fireEvent.click(screen.getByTestId('sop-record-stop'))
    expect(await screen.findByTestId('sop-record-preview')).toBeInTheDocument()

    // Use this video: local mode posts to the upload route, then registers.
    fireEvent.click(screen.getByTestId('sop-record-use'))
    await waitFor(() => expect(registerSopVideoAction).toHaveBeenCalled())
    const input = registerSopVideoAction.mock.calls[0][0]
    expect(input).toMatchObject({
      sopTemplateId: 7,
      title: 'WEX walkthrough',
      storedPath: 'sop-videos/7/1-walkthrough.webm',
      sizeBytes: 10,
    })
    expect(input.mimeType).toContain('video/webm')
    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith({ id: 55, title: 'WEX walkthrough' }))
  })

  it('a denied screen share lands an explanatory error, never a crash', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getDisplayMedia: vi.fn(async () => {
          throw new DOMException('denied', 'NotAllowedError')
        }),
        getUserMedia: vi.fn(),
      },
    })
    render(<SopRecorderDialog sopTemplateId={7} sopTitle="WEX close" open onClose={() => {}} onRegistered={() => {}} />)
    fireEvent.click(screen.getByTestId('sop-record-start'))
    expect(await screen.findByTestId('sop-record-error')).toHaveTextContent(/Screen sharing was not allowed/)
  })

  it('restart discards the capture and returns to idle', async () => {
    render(<SopRecorderDialog sopTemplateId={7} sopTitle="WEX close" open onClose={() => {}} onRegistered={() => {}} />)
    fireEvent.click(screen.getByTestId('sop-record-start'))
    expect(await screen.findByTestId('sop-record-elapsed')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sop-record-restart'))
    expect(await screen.findByTestId('sop-record-start')).toBeInTheDocument()
  })
})

describe('SopVideoList playback + delete', () => {
  const videos = [
    { id: 9, title: 'Portal walkthrough', durationSecs: 65, sizeBytes: 2 * 1024 * 1024 },
    { id: 10, title: 'Reconcile quirk', durationSecs: null, sizeBytes: 512 * 1024 },
  ]

  it('renders embedded players with duration/size; delete calls the action', async () => {
    deleteSopVideoAction.mockResolvedValue({ ok: true, data: { deleted: true } })
    const onDeleted = vi.fn()
    render(<SopVideoList videos={videos} canEdit onDeleted={onDeleted} />)

    const players = document.querySelectorAll('video')
    expect(players).toHaveLength(2)
    expect(players[0]).toHaveAttribute('src', '/api/sop-videos/9')
    expect(screen.getByTestId('sop-video-9')).toHaveTextContent('01:05')
    expect(screen.getByTestId('sop-video-9')).toHaveTextContent('2.0 MB')

    fireEvent.click(screen.getByTestId('sop-video-delete-9'))
    // L1 (H4): the delete confirms first - the action only fires from the dialog.
    expect(deleteSopVideoAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))
    await waitFor(() => expect(deleteSopVideoAction).toHaveBeenCalledWith(9))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(9))
  })

  it('hides delete affordances without the edit flag', () => {
    render(<SopVideoList videos={videos} canEdit={false} onDeleted={() => {}} />)
    expect(screen.queryByTestId('sop-video-delete-9')).toBeNull()
  })
})
