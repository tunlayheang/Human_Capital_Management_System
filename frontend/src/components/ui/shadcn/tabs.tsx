import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { useReducedMotion } from "framer-motion"

import { cn } from "@/lib/utils"
import { useHorizontalScrollOverflow } from "@/hooks/useHorizontalScrollOverflow"
import { HorizontalScrollArrow } from "@/components/ui/HorizontalScrollArrow"
import {
  pillSegmentTabsScrollClass,
  pillSegmentTabsTrackClass,
  pillSegmentTabTriggerBaseClass,
} from "../page/PillSegmentTabs"

const INDICATOR_CLASS =
  "absolute left-0 top-0 rounded-full glass-pill-active pointer-events-none z-0 will-change-transform"

type IndicatorRect = { left: number; top: number; width: number; height: number }

function readIndicatorRect(list: HTMLElement, btn: HTMLElement): IndicatorRect {
  if (btn.offsetParent === list || btn.parentElement === list) {
    return {
      left: Math.round(btn.offsetLeft),
      top: Math.round(btn.offsetTop),
      width: Math.round(btn.offsetWidth),
      height: Math.round(btn.offsetHeight),
    }
  }
  const listRect = list.getBoundingClientRect()
  const btnRect = btn.getBoundingClientRect()
  return {
    left: Math.round(btnRect.left - listRect.left + list.scrollLeft),
    top: Math.round(btnRect.top - listRect.top + list.scrollTop),
    width: Math.round(btnRect.width),
    height: Math.round(btnRect.height),
  }
}

function useRadixTabIndicator(listRef: React.RefObject<HTMLDivElement | null>) {
  const [indicator, setIndicator] = React.useState<IndicatorRect | null>(null)
  const reduceMotion = useReducedMotion()
  const rafRef = React.useRef<number | null>(null)

  const measure = React.useCallback(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
    if (!active) return
    const next = readIndicatorRect(list, active)
    if (next.width <= 0 || next.height <= 0) return
    setIndicator((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next
    )
  }, [listRef])

  const measureSoon = React.useCallback(() => {
    measure()
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      measure()
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        measure()
      })
    })
  }, [measure])

  React.useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    measureSoon()

    const ro = new ResizeObserver(measureSoon)
    ro.observe(list)

    const mo = new MutationObserver(measureSoon)
    mo.observe(list, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-state", "class"],
      childList: true,
    })

    const onScrollEnd = () => measure()
    window.addEventListener("resize", measureSoon)
    list.addEventListener("scrollend", onScrollEnd)
    const fontsReady = document.fonts?.ready
    if (fontsReady) void fontsReady.then(measureSoon)

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener("resize", measureSoon)
      list.removeEventListener("scrollend", onScrollEnd)
    }
  }, [listRef, measure, measureSoon])

  const indicatorTransition = reduceMotion
    ? "none"
    : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), width 220ms cubic-bezier(0.22, 1, 0.36, 1), height 220ms cubic-bezier(0.22, 1, 0.36, 1)"

  return { indicator, indicatorTransition, measure: measureSoon }
}

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement>(null)
  const { indicator, indicatorTransition, measure } = useRadixTabIndicator(listRef)
  const isFullWidth = /\bw-full\b/.test(String(className ?? ""))
  const { canScrollLeft, canScrollRight, scrollByPage } = useHorizontalScrollOverflow(listRef, [
    children,
  ])

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )

  return (
    <div
      className={cn(
        pillSegmentTabsTrackClass,
        isFullWidth ? "flex w-full" : "w-fit max-w-full",
        "h-auto"
      )}
    >
      {canScrollLeft ? (
        <HorizontalScrollArrow direction="left" onClick={() => scrollByPage(-1)} variant="pill" />
      ) : null}

      <TabsPrimitive.List
        ref={setRefs}
        className={cn(
          pillSegmentTabsScrollClass,
          isFullWidth ? "flex w-full [&>[role=tab]]:flex-1 [&>[role=tab]]:min-w-0" : "",
          className
        )}
        onClick={() => requestAnimationFrame(measure)}
        {...props}
      >
        {indicator && indicator.width > 0 ? (
          <span
            aria-hidden
            className={INDICATOR_CLASS}
            style={{
              width: indicator.width,
              height: indicator.height,
              transform: `translate(${indicator.left}px, ${indicator.top}px)`,
              transition: indicatorTransition,
            }}
          />
        ) : null}
        {children}
      </TabsPrimitive.List>

      {canScrollRight ? (
        <HorizontalScrollArrow direction="right" onClick={() => scrollByPage(1)} variant="pill" />
      ) : null}
    </div>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      pillSegmentTabTriggerBaseClass,
      "group relative z-10 shrink-0 min-w-[8.5rem] sm:min-w-[9.5rem]",
      "px-3 py-1.5 text-xs min-h-[32px] sm:px-4 sm:py-2 sm:text-sm sm:min-h-[36px] md:min-h-[40px]",
      "text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100",
      "hover:bg-white/45 dark:hover:bg-white/5",
      "[&_svg]:w-3.5 [&_svg]:h-3.5 sm:[&_svg]:w-4 sm:[&_svg]:h-4 [&_svg]:shrink-0",
      "[&_svg]:text-slate-500 dark:[&_svg]:text-slate-400 group-hover:[&_svg]:text-slate-600 dark:group-hover:[&_svg]:text-slate-200",
      "[&_svg]:transition-colors [&_svg]:duration-200",
      "focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-primary-400/40 dark:focus-visible:ring-offset-slate-900",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:text-white data-[state=active]:font-semibold",
      "data-[state=active]:[&_svg]:text-white",
      "data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:hover:bg-transparent",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-3 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
