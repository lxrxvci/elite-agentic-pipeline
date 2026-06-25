# PreviewFrame

Embeds the generated site inside the admin dashboard with device-width toggles (mobile / desktop).

## Usage

- Always visible on the admin preview tab.
- Re-renders when the owner changes template, content, or hours.
- Mobile view is `375px` wide; desktop view is fluid.

## Anatomy

```
┌─────────────────────────────────────────────────┐
│ ← Preview    [Mobile] [Desktop]   [Publish ▼]  │  ← toolbar
├─────────────────────────────────────────────────┤
│                                                 │
│    ┌──────────────────────────┐                 │
│    │   Generated site         │                 │
│    │   (device viewport)      │                 │
│    └──────────────────────────┘                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Tokens

| Element | Token | Default value |
|---|---|---|
| Toolbar height | `component.previewFrame.toolbarHeight` | `3.5rem` |
| Toolbar background | `component.previewFrame.toolbarBackground` | `surface-default` |
| Toolbar border | `component.previewFrame.toolbarBorder` | `border-default` |
| Viewport background | `component.previewFrame.viewportBackground` | `background-subtle` |
| Mobile width | `component.previewFrame.deviceMobile` | `375px` |
| Desktop width | `component.previewFrame.deviceDesktop` | `100%` |
| Frame shadow | `component.previewFrame.frameShadow` | `elevated` |
| Frame radius | `component.previewFrame.frameRadius` | `panel` |

## Behavior

- Device toggle updates the iframe/container width with a smooth transition.
- The preview is sandboxed (`sandbox="allow-scripts"`) when rendering untrusted content.
- Loading state shows a skeleton of the toolbar + viewport.

## Accessibility

- Toolbar controls are a `role="toolbar"` with `aria-label="Preview controls"`.
- Device toggles are a `role="radiogroup"`; active device has `aria-pressed="true"`.
- The preview iframe has a `title` describing the tenant site.

## Reference implementation

```tsx
export function PreviewFrame({ url }: { url: string }) {
  const [mode, setMode] = useState<'mobile' | 'desktop'>('desktop')
  return (
    <div className="flex flex-col h-full bg-neutral-50 rounded-2xl overflow-hidden shadow-elevated">
      <div
        role="toolbar"
        aria-label="Preview controls"
        className="h-14 flex items-center justify-between px-4 border-b border-neutral-200 bg-white"
      >
        <span className="font-semibold text-neutral-950">Preview</span>
        <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
          <button
            aria-pressed={mode === 'mobile'}
            onClick={() => setMode('mobile')}
            className={`px-3 py-1.5 rounded-md text-sm ${mode === 'mobile' ? 'bg-white shadow-sm' : 'text-neutral-500'}`}
          >
            Mobile
          </button>
          <button
            aria-pressed={mode === 'desktop'}
            onClick={() => setMode('desktop')}
            className={`px-3 py-1.5 rounded-md text-sm ${mode === 'desktop' ? 'bg-white shadow-sm' : 'text-neutral-500'}`}
          >
            Desktop
          </button>
        </div>
      </div>
      <div className="flex-1 flex justify-center p-6 overflow-auto">
        <div
          className="transition-all duration-300 bg-white shadow-xl rounded-xl overflow-hidden"
          style={{ width: mode === 'mobile' ? '375px' : '100%', height: '100%' }}
        >
          <iframe src={url} title="Generated site preview" className="w-full h-full border-0" sandbox="allow-scripts" />
        </div>
      </div>
    </div>
  )
}
```

## Motion

- Width transition between devices: `300ms` ease-out.
- Frame shadow fades in on load.
