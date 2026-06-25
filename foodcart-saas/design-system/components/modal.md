# Modal

## Purpose

Displays focused, interruptive content such as confirmation dialogs, AI change previews, and onboarding tips.

## Anatomy

```
[Modal]
├── overlay (backdrop)
├── dialog
│   ├── header
│   │   ├── title
│   │   └── close button
│   ├── body
│   └── optional footer
└── focus trap
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `open` | `boolean` | — | Controlled visibility |
| `onClose` | `() => void` | — | Close callback |
| `title` | `string` | — | Dialog title |
| `children` | `ReactNode` | — | Body content |
| `footer` | `ReactNode` | — | Action buttons |

## Tokens

- Overlay: `component.modal.overlay`
- Background: `component.modal.background`
- Radius: `component.modal.radius`
- Shadow: `component.modal.shadow`
- Padding: `component.modal.padding`

## Accessibility

- Uses native `<dialog>` with `.showModal()` for built-in focus trapping.
- `aria-modal="true"` and `aria-labelledby` reference the title.
- Closes on `Escape` key and overlay click.
- Focus returns to the trigger element on close.
- Scroll behind the dialog is prevented while open.

## Usage examples

```tsx
<Modal open={showPreview} onClose={() => setShowPreview(false)} title="AI suggested changes">
  <p>The assistant wants to add a Vegan section to your menu.</p>
  <div slot="footer">
    <Button variant="secondary" onClick={() => setShowPreview(false)}>Cancel</Button>
    <Button onClick={applyChanges}>Apply</Button>
  </div>
</Modal>
```
