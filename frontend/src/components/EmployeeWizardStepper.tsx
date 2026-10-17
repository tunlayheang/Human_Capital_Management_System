import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CHAT_WIDGET_ROOT_ID } from '../utils/overlayPortal';
import { useCompactLayout } from '../hooks/useCompactLayout';
import { useHorizontalScrollOverflow } from '../hooks/useHorizontalScrollOverflow';
import { HorizontalScrollArrow } from './ui/HorizontalScrollArrow';

function getWizardRailPortalRoot(): HTMLElement {
    return document.getElementById(CHAT_WIDGET_ROOT_ID) ?? document.body;
}

export interface WizardStep {
    id: string;
    label: string;
    description?: string;
    icon: React.ElementType;
}

interface StepperProps {
    steps: WizardStep[];
    currentStep: number;
    onStepChange: (index: number) => void;
    /** When set, allows clicking any step up to this index (for resume-style wizards). */
    maxReachableStep?: number;
    /** Show short description under the active step label. */
    showActiveDescription?: boolean;
}

function stepCircleClass(isCompleted: boolean, isCurrent: boolean, compact = false): string {
    const ring = compact
        ? 'ring-2 ring-primary-100 dark:ring-primary-900/40'
        : 'ring-2 sm:ring-4 ring-primary-100 dark:ring-primary-900/40';

    if (isCompleted) {
        return 'border-primary-600 bg-primary-50 text-primary-600 dark:bg-slate-900 dark:text-primary-400';
    }
    if (isCurrent) {
        return `border-primary-600 bg-white dark:bg-slate-900 text-primary-600 ${ring}`;
    }
    return 'border-slate-300 bg-white dark:bg-slate-900 text-slate-400 dark:border-slate-600';
}

function stepLabelClass(isCurrent: boolean, isCompleted: boolean): string {
    if (isCurrent || isCompleted) {
        return 'text-slate-900 dark:text-white';
    }
    return 'text-slate-500 dark:text-slate-400';
}

type StepRailLabelPopupProps = {
    anchor: HTMLElement | null;
    label: string;
    stepNumber: number;
    description?: string;
    visible: boolean;
    tone?: 'current' | 'completed' | 'upcoming';
};

function StepRailLabelPopup({
    anchor,
    label,
    stepNumber,
    description,
    visible,
    tone = 'current',
}: StepRailLabelPopupProps) {
    const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

    useLayoutEffect(() => {
        if (!visible || !anchor) {
            setCoords(null);
            return;
        }

        const updatePosition = () => {
            const rect = anchor.getBoundingClientRect();
            setCoords({
                top: rect.top + rect.height / 2,
                left: rect.left - 8,
            });
        };

        updatePosition();

        const scrollParent = anchor.closest('main');
        scrollParent?.addEventListener('scroll', updatePosition, { passive: true });
        window.addEventListener('resize', updatePosition, { passive: true });
        window.addEventListener('scroll', updatePosition, { passive: true });

        return () => {
            scrollParent?.removeEventListener('scroll', updatePosition);
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition);
        };
    }, [anchor, label, stepNumber, description, visible]);

    if (!visible || !coords || typeof document === 'undefined') return null;

    const textTone =
        tone === 'upcoming'
            ? 'text-slate-500 dark:text-slate-400'
            : 'text-primary-600 dark:text-primary-400';

    return createPortal(
        <div
            role="tooltip"
            className="fixed z-[285] pointer-events-none max-w-[12rem] animate-in fade-in slide-in-from-right-1 duration-200"
            style={{
                top: coords.top,
                left: coords.left,
                transform: 'translate(-100%, -50%)',
            }}
        >
            <div className="glass-panel px-3 py-2 rounded-lg shadow-lg">
                <p className={`text-sm font-medium leading-snug whitespace-nowrap ${textTone}`}>
                    {label}: {stepNumber}
                </p>
                {description ? (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-snug whitespace-normal">
                        {description}
                    </p>
                ) : null}
            </div>
        </div>,
        document.body
    );
}

/** Horizontal step bar — lg and up (compact/mobile uses the vertical rail). */
export const EmployeeWizardStepper: React.FC<StepperProps> = ({
    steps,
    currentStep,
    onStepChange,
    maxReachableStep,
    showActiveDescription = false,
}) => {
    const jumpLimit = maxReachableStep ?? currentStep;
    const progressPct =
        steps.length > 1 ? (currentStep / (steps.length - 1)) * 100 : 0;
    const stripRef = useRef<HTMLDivElement>(null);
    const { hasOverflow, canScrollLeft, canScrollRight, scrollByPage, scrollChildIntoView } =
        useHorizontalScrollOverflow(stripRef, [steps.length, currentStep]);

    useLayoutEffect(() => {
        const current = stripRef.current?.querySelector<HTMLElement>('[aria-current="step"]');
        scrollChildIntoView(current, 'smooth');
    }, [currentStep, scrollChildIntoView, steps.length]);

    return (
        <div className="relative flex w-full min-w-0 items-center">
            {hasOverflow ? (
                <HorizontalScrollArrow
                    direction="left"
                    variant="neutral"
                    disabled={!canScrollLeft}
                    onClick={() => scrollByPage(-1)}
                    className="mr-0.5"
                />
            ) : null}
            <div ref={stripRef} className="min-w-0 flex-1 overflow-x-scroll hcms-scrollbar-hidden pb-1 px-0.5">
            <div className="flex items-start justify-between relative isolate min-w-max w-full px-0.5">
                <div
                    className="absolute left-5 right-5 top-5 z-0 h-0.5 bg-slate-200 dark:bg-slate-700"
                    aria-hidden
                />
                <div
                    className="absolute left-5 top-5 z-0 h-0.5 bg-primary-500 dark:bg-primary-400 transition-all duration-500 ease-out"
                    style={{ width: `calc((100% - 2.5rem) * ${progressPct / 100})` }}
                    aria-hidden
                />
                {steps.map((step, index) => {
                    const isCompleted = index < currentStep;
                    const isCurrent = index === currentStep;
                    const canJump = index <= jumpLimit;
                    const Icon = step.icon;

                    return (
                        <button
                            key={step.id}
                            type="button"
                            disabled={!canJump}
                            onClick={() => canJump && onStepChange(index)}
                            className={`relative z-10 flex flex-col items-center flex-1 min-w-0 group ${
                                canJump ? 'cursor-pointer' : 'cursor-default opacity-50'
                            }`}
                            aria-current={isCurrent ? 'step' : undefined}
                            aria-label={step.label}
                        >
                            <div
                                className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${stepCircleClass(
                                    isCompleted,
                                    isCurrent
                                )}`}
                            >
                                <Icon className="w-5 h-5 shrink-0" aria-hidden />
                            </div>
                            <p
                                className={`mt-2 text-center text-xs font-semibold leading-tight px-0.5 ${stepLabelClass(
                                    isCurrent,
                                    isCompleted
                                )}`}
                            >
                                {step.label}
                            </p>
                            {showActiveDescription && isCurrent && step.description ? (
                                <p className="mt-1 text-center text-[10px] text-slate-500 dark:text-slate-400 leading-snug px-1 max-w-[11rem]">
                                    {step.description}
                                </p>
                            ) : null}
                        </button>
                    );
                })}
            </div>
            </div>
            {hasOverflow ? (
                <HorizontalScrollArrow
                    direction="right"
                    variant="neutral"
                    disabled={!canScrollRight}
                    onClick={() => scrollByPage(1)}
                    className="ml-0.5"
                />
            ) : null}
        </div>
    );
};

function StepRailConnector({ active }: { active: boolean }) {
    return (
        <div
            className={`w-0.5 h-2.5 shrink-0 rounded-full transition-colors duration-300 ${
                active
                    ? 'bg-primary-500 dark:bg-primary-400'
                    : 'bg-slate-200 dark:bg-slate-700'
            }`}
            aria-hidden
        />
    );
}

/** Compact vertical icon rail — mobile only, fixed strip on the right. */
export const EmployeeWizardStepRail: React.FC<StepperProps> = ({
    steps,
    currentStep,
    onStepChange,
    maxReachableStep,
    showActiveDescription = false,
}) => {
    const jumpLimit = maxReachableStep ?? currentStep;
    const stepRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const [peekIndex, setPeekIndex] = useState<number | null>(null);
    const isCompact = useCompactLayout();
    const [mounted, setMounted] = useState(false);

    const labelIndex = peekIndex ?? currentStep;
    const labelStep = steps[labelIndex];
    const [labelAnchor, setLabelAnchor] = useState<HTMLElement | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        stepRefs.current.length = steps.length;
    }, [steps.length]);

    useLayoutEffect(() => {
        setLabelAnchor(stepRefs.current[labelIndex] ?? null);
    }, [labelIndex, currentStep, steps.length, mounted]);

    if (!mounted || !isCompact) return null;

    return createPortal(
        <>
            <nav
                className="lg:hidden fixed z-[281] right-0 top-1/2 -translate-y-1/2 flex flex-col items-center py-2.5 px-1.5 w-11 max-h-[min(72dvh,calc(100dvh-var(--hcms-header-offset,3.25rem)-var(--hcms-wizard-footer-height,3rem)-1.5rem))] overflow-y-auto overflow-x-visible border border-r-0 border-slate-200/90 dark:border-slate-600/80 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-lg shadow-slate-900/10 dark:shadow-black/40 rounded-l-2xl pointer-events-auto"
                aria-label="Wizard progress"
            >
                {steps.map((step, index) => {
                    const isCompleted = index < currentStep;
                    const isCurrent = index === currentStep;
                    const canJump = index <= jumpLimit;
                    const Icon = step.icon;

                    return (
                        <React.Fragment key={step.id}>
                            {index > 0 ? (
                                <StepRailConnector active={index <= currentStep} />
                            ) : null}
                            <div className="relative z-10 shrink-0">
                            <button
                                ref={(el) => {
                                    stepRefs.current[index] = el;
                                }}
                                type="button"
                                aria-disabled={!canJump}
                                tabIndex={canJump ? 0 : -1}
                                onClick={() => canJump && onStepChange(index)}
                                onPointerEnter={() => setPeekIndex(index)}
                                onPointerLeave={() =>
                                    setPeekIndex((prev) => (prev === index ? null : prev))
                                }
                                onFocus={() => setPeekIndex(index)}
                                onBlur={() =>
                                    setPeekIndex((prev) => (prev === index ? null : prev))
                                }
                                className={`relative flex items-center justify-center transition-transform ${
                                    canJump
                                        ? 'cursor-pointer hover:scale-110 focus-visible:scale-110'
                                        : 'cursor-default opacity-45 hover:opacity-70'
                                }`}
                                aria-current={isCurrent ? 'step' : undefined}
                                aria-label={`${step.label}${isCurrent ? ' (current)' : ''}`}
                            >
                                <div
                                    className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all duration-300 bg-white dark:bg-slate-900 ${stepCircleClass(
                                        isCompleted,
                                        isCurrent,
                                        true
                                    )}`}
                                >
                                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                                </div>
                            </button>
                            </div>
                        </React.Fragment>
                    );
                })}
            </nav>

            {labelStep ? (
                <StepRailLabelPopup
                    anchor={labelAnchor}
                    label={labelStep.label}
                    stepNumber={labelIndex + 1}
                    visible={Boolean(labelAnchor)}
                    tone={
                        labelIndex === currentStep
                            ? 'current'
                            : labelIndex < currentStep
                              ? 'completed'
                              : 'upcoming'
                    }
                    description={
                        showActiveDescription && labelIndex === currentStep
                            ? labelStep.description
                            : undefined
                    }
                />
            ) : null}
        </>,
        getWizardRailPortalRoot()
    );
};
