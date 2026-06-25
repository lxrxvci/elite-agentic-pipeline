'use client'

import { useState } from 'react'

interface PreviewFrameProps {
  url: string
  title?: string
}

export function PreviewFrame({ url, title = 'Site preview' }: PreviewFrameProps) {
  const [mode, setMode] = useState<'mobile' | 'desktop'>('mobile')
  return (
    <div className="flex flex-col h-full rounded-2xl border border-fc-neutral-200 bg-fc-neutral-50 shadow-elevated overflow-hidden">
      <div className="h-14 px-4 flex items-center justify-between border-b border-fc-neutral-200 bg-white" role="toolbar" aria-label="Preview controls">
        <span className="font-semibold text-sm text-fc-text-primary">{title}</span>
        <div className="flex gap-1" role="radiogroup" aria-label="Viewport mode">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'mobile'}
            onClick={() => setMode('mobile')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md ${mode === 'mobile' ? 'bg-fc-cobalt-600 text-white' : 'bg-fc-neutral-100 text-fc-text-secondary'}`}
          >
            Mobile
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'desktop'}
            onClick={() => setMode('desktop')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md ${mode === 'desktop' ? 'bg-fc-cobalt-600 text-white' : 'bg-fc-neutral-100 text-fc-text-secondary'}`}
          >
            Desktop
          </button>
        </div>
      </div>
      <div className="flex-1 p-4 flex justify-center overflow-auto">
        <iframe
          src={url}
          title={title}
          className={`bg-white border border-fc-neutral-200 shadow-card transition-all duration-300 ${
            mode === 'mobile' ? 'w-[375px] h-full rounded-xl' : 'w-full h-full rounded-xl'
          }`}
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  )
}
