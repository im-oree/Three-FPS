/**
 * registerCapabilities.ts — the one place capability ids become real.
 *
 * Adding an ability is: write the module, add a line here, add the id to a
 * loadout. Nothing in Perception, Planner, AgentController, AISystem or
 * Navigation changes — they all iterate whatever the agent was given.
 *
 * Importing this file is a side effect by design; it is imported once by
 * GameServer so that every server, in-process or hosted, has the same set.
 */
import { CapabilityRegistry } from './Capability';
import {
  EngageCapability, HuntCapability, ReloadCapability,
} from './capabilities/CombatCapabilities';
import {
  EnterVehicleCapability, PatrolCapability, RetreatCapability,
} from './capabilities/MovementCapabilities';

let registered = false;

export function registerBuiltinCapabilities(): void {
  if (registered) return;
  registered = true;

  CapabilityRegistry.register('Engage', () => new EngageCapability());
  CapabilityRegistry.register('Hunt', () => new HuntCapability());
  CapabilityRegistry.register('Reload', () => new ReloadCapability());
  CapabilityRegistry.register('Retreat', () => new RetreatCapability());
  CapabilityRegistry.register('Patrol', () => new PatrolCapability());
  CapabilityRegistry.register('EnterVehicle', () => new EnterVehicleCapability());
}
