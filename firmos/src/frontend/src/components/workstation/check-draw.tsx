/**
 * The completion dopamine hit (FIRMOS-VISUAL-ELITE-PLAN Wave 3): a
 * circle-check whose strokes draw themselves. The circle draws in 150ms and
 * the check follows in 275ms - pure garnish on top of an instant state
 * change, never a perceived delay.
 *
 * Reduced motion: the draw animation only exists under the motion-safe
 * variant (prefers-reduced-motion: no-preference). The resting state of both
 * strokes is fully drawn (dashoffset 0), so with the animation absent the
 * icon simply renders complete - a strict no-op, same final picture.
 */

interface CheckDrawProps {
  className?: string
}

export function CheckDraw({ className }: CheckDrawProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      data-testid="check-draw"
      className={className}
    >
      <style>{`
        @keyframes firmos-check-draw-circle {
          from { stroke-dashoffset: 54; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes firmos-check-draw-check {
          from { stroke-dashoffset: 12; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>
      <circle
        cx="10"
        cy="10"
        r="8.25"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeDasharray="54"
        strokeDashoffset="0"
        strokeLinecap="round"
        className="motion-safe:animate-[firmos-check-draw-circle_150ms_ease-out_forwards]"
      />
      <path
        d="M6.2 10.4l2.6 2.6 5-5.6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeDasharray="12"
        strokeDashoffset="0"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="motion-safe:animate-[firmos-check-draw-check_275ms_ease-out_100ms_both]"
      />
    </svg>
  )
}
