import type { ComponentType } from "react";
import { PetStatusScenario } from "./PetStatusScenario";

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  component: ComponentType;
}

export const scenarios: ScenarioDefinition[] = [
  {
    id: "pet-status",
    name: "Pet Status",
    description: "Switch between all pet statuses for visual testing",
    icon: "\u{1F43E}",
    component: PetStatusScenario,
  },
];
