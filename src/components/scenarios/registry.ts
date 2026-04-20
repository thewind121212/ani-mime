import type { ComponentType } from "react";
import { PetStatusScenario } from "./PetStatusScenario";
import { DialogPreviewScenario } from "./DialogPreviewScenario";
import { VisitorScenario } from "./VisitorScenario";

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
  {
    id: "visitor",
    name: "Visitors",
    description: "Simulate friends visiting — preview multi-pet layout",
    icon: "\u{1F415}",
    component: VisitorScenario,
  },
  {
    id: "dialog-preview",
    name: "Dialog Preview",
    description: "Preview all native dialogs and speech bubbles",
    icon: "\u{1F4AC}",
    component: DialogPreviewScenario,
  },
];
