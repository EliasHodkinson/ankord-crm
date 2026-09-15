import { clientOnboarding, type ProjectTemplate } from "./client-onboarding";
import { websiteBuild } from "./website-build";

export type { ProjectTemplate, TemplatePhase, TemplateStep } from "./client-onboarding";

/** An empty project, for work that does not follow a runbook. */
export const blankProject: ProjectTemplate = {
  key: "blank",
  name: "Blank project",
  description: "Start with nothing and add your own phases and steps as you go.",
  phases: [
    {
      num: "01",
      label: "Phase one",
      description: null,
      accent: "#2e7a78",
      position: 0,
      steps: [],
    },
  ],
};

export const TEMPLATES: ProjectTemplate[] = [
  clientOnboarding,
  websiteBuild,
  blankProject,
];

export function findTemplate(key: string): ProjectTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

/** Steps and phases counted up, for the template picker. */
export function templateSize(template: ProjectTemplate) {
  return {
    phases: template.phases.length,
    steps: template.phases.reduce((n, p) => n + p.steps.length, 0),
  };
}
