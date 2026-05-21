let activeSimulationTicks = 0;

export function beginSimulationTick(): () => void {
  activeSimulationTicks += 1;
  let finished = false;

  return () => {
    if (finished) return;
    finished = true;
    activeSimulationTicks = Math.max(0, activeSimulationTicks - 1);
  };
}

export function getActiveSimulationTicks(): number {
  return activeSimulationTicks;
}

export function isSimulationBusy(): boolean {
  return activeSimulationTicks > 0;
}

export function getSimulationBusyMessage(): string {
  return "Simulation tick is still finishing. Please wait until the world is fully paused.";
}
