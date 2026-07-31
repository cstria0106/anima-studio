import {
  onboardingPreferencesSchema,
  onboardingStepIds,
  onboardingUpdateSchema,
  type OnboardingPreferences,
  type OnboardingStatusDto,
} from "@anima/shared";
import { StudioRepository } from "../db/repository";
import { JobSubmissionError } from "./jobs";

const ONBOARDING_SETTING = "onboarding-preferences-v1";

export interface OnboardingEnvironment {
  runtimeReady: boolean;
  runtimeInstalled: boolean;
  modelsAvailable: boolean;
  capabilityIssueCount: number;
}

export class OnboardingService {
  constructor(
    private readonly repository: StudioRepository,
    private readonly environment: () => Promise<OnboardingEnvironment>,
  ) {}

  private preferences(): OnboardingPreferences {
    const raw = this.repository.getSetting<unknown>(ONBOARDING_SETTING);
    const value =
      raw && typeof raw === "object"
        ? (raw as {
            dismissed?: unknown;
            completedSteps?: unknown;
          })
        : {};
    const supportedSteps = new Set<string>(onboardingStepIds);
    return onboardingPreferencesSchema.parse({
      ...value,
      completedSteps: Array.isArray(value.completedSteps)
        ? value.completedSteps.filter(
            (step): step is string =>
              typeof step === "string" && supportedSteps.has(step),
          )
        : [],
    });
  }

  async status(): Promise<OnboardingStatusDto> {
    const preferences = this.preferences();
    const manuallyCompleted = new Set(preferences.completedSteps);
    const environment = await this.environment();
    const steps: OnboardingStatusDto["steps"] = [
      {
        id: "welcome",
        label: "Studio tour",
        complete: manuallyCompleted.has("welcome"),
        blocking: false,
        message: "Review the generation flow and storage locations.",
        actionHref: "/settings?onboarding=welcome",
      },
      {
        id: "runtime",
        label: "ComfyUI runtime",
        complete: environment.runtimeInstalled && environment.runtimeReady,
        blocking: true,
        message: environment.runtimeReady
          ? "ComfyUI is connected and ready."
          : "Install or connect a compatible ComfyUI runtime.",
        actionHref: "/settings?section=runtime",
      },
      {
        id: "models",
        label: "Models and nodes",
        complete:
          environment.modelsAvailable &&
          environment.capabilityIssueCount === 0,
        blocking: true,
        message:
          environment.capabilityIssueCount === 0 &&
          environment.modelsAvailable
            ? "Generation models and required nodes are available."
            : "Select installed models and resolve required node issues.",
        actionHref: "/library",
      },
      {
        id: "test_generation",
        label: "Test generation",
        complete:
          manuallyCompleted.has("test_generation") ||
          this.repository.hasCompletedJobs(),
        blocking: false,
        message: "Run a small base generation to validate the setup.",
        actionHref: "/create",
      },
    ];
    return {
      version: 1,
      dismissed: preferences.dismissed,
      complete: steps.every((step) => step.complete),
      steps,
    };
  }

  async update(raw: unknown): Promise<OnboardingStatusDto> {
    const parsed = onboardingUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new JobSubmissionError(
        "Onboarding preferences are invalid.",
        422,
        parsed.error.flatten(),
      );
    }
    const current = this.preferences();
    this.repository.setSetting(ONBOARDING_SETTING, {
      ...current,
      ...parsed.data,
    });
    return this.status();
  }
}
