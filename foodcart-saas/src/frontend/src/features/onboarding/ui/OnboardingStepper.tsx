interface OnboardingStepperProps {
  steps: string[]
  current: number
}

export function OnboardingStepper({ steps, current }: OnboardingStepperProps) {
  return (
    <nav aria-label="Onboarding progress">
      <ol className="flex items-center gap-2">
        {steps.map((label, idx) => {
          const isActive = idx === current
          const isComplete = idx < current
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-current={isActive ? 'step' : undefined}
                className={`
                  flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold
                  ${isActive ? 'bg-fc-cobalt-600 text-white' : isComplete ? 'bg-fc-cobalt-600 text-white' : 'bg-fc-neutral-100 text-fc-text-secondary'}
                `}
              >
                {isComplete ? '✓' : idx + 1}
              </span>
              <span className={`text-sm hidden sm:block ${isActive ? 'text-fc-text-primary font-semibold' : 'text-fc-text-secondary'}`}>
                {label}
              </span>
              {idx < steps.length - 1 && <span className="w-6 h-0.5 bg-fc-neutral-200 hidden sm:block" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
