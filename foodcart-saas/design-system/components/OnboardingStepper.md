# OnboardingStepper

Shows progress through the five-step publish flow and lets users jump back to completed steps.

## Usage

Steps:
1. Business identity
2. Connect presence
3. Brand assets
4. Template match
5. Preview & publish

## Anatomy

```
  ●─────●─────○─────○─────○
 Step 1  Step2  Step3 Step4 Step5
```

1. **Step indicator** — numbered circle.
2. **Connector** — horizontal line between steps.
3. **Label** — step name below indicator.

## Tokens

| Element | Token | Default value |
|---|---|---|
| Step size | `component.onboardingStepper.stepSize` | `2rem` |
| Connector height | `component.onboardingStepper.connectorHeight` | `2px` |
| Connector color | `component.onboardingStepper.connectorColor` | `semantic.color.border-default` |
| Connector active | `component.onboardingStepper.connectorActiveColor` | `semantic.color.interactive-default` |
| Active step bg | `component.onboardingStepper.stepActive.background` | `interactive-default` |
| Complete step bg | `component.onboardingStepper.stepComplete.background` | `interactive-default` |
| Inactive step bg | `component.onboardingStepper.stepInactive.background` | `surface-default` |
| Active label | `component.onboardingStepper.labelActive` | `text-primary` |
| Inactive label | `component.onboardingStepper.labelInactive` | `text-secondary` |

## Behavior

- Completed steps are clickable (navigation back).
- Current step is highlighted.
- Future steps are disabled.
- On small screens labels may collapse to a single "Step X of 5" string.

## Accessibility

- Use `<nav aria-label="Onboarding steps">`.
- Each step button has `aria-current="step"` for the active step and `aria-disabled="true"` for unavailable future steps.
- Visually hidden text for completion status (e.g., "completed").

## Reference implementation

```tsx
type Step = { id: string; label: string }
type Status = 'complete' | 'current' | 'upcoming'

interface OnboardingStepperProps {
  steps: Step[]
  current: number
  onChange?: (index: number) => void
}

export function OnboardingStepper({ steps, current, onChange }: OnboardingStepperProps) {
  return (
    <nav aria-label="Onboarding steps">
      <ol className="flex items-center w-full">
        {steps.map((step, i) => {
          const status: Status = i < current ? 'complete' : i === current ? 'current' : 'upcoming'
          return (
            <li key={step.id} className="flex-1 flex flex-col items-center gap-2">
              <button
                aria-current={status === 'current' ? 'step' : undefined}
                aria-disabled={status === 'upcoming'}
                onClick={() => status !== 'upcoming' && onChange?.(i)}
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                  ${status === 'complete' || status === 'current'
                    ? 'bg-cobalt-600 text-white'
                    : 'bg-white border-2 border-neutral-300 text-neutral-500'}
                `}
              >
                {status === 'complete' ? '✓' : i + 1}
              </button>
              <span className={`text-xs ${status === 'current' ? 'text-neutral-950 font-medium' : 'text-neutral-500'}`}>
                {step.label}
              </span>
              {i < steps.length - 1 && (
                <div
                  className={`hidden sm:block h-0.5 flex-1 -mt-8 ${
                    i < current ? 'bg-cobalt-600' : 'bg-neutral-200'
                  }`}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
```

## Motion

- Step transition: color fill animates over `200ms`.
- Connector fills from left to right when a step completes.
