export const WINDUP = .19;
export const BITE_WINDOW = .47;
export const HUNT_DURATION = .83;
export const FALL_DURATION = 2.2;
export const CONTACT_REACH = 2.26;

export function canBite(collisions, wolf, prey) {
  if (!prey || prey.health <= 0 || prey.swimming || wolf.swimming || wolf.drinking) return false;
  const dx = prey.x - wolf.x, dz = prey.z - wolf.z;
  const distance = Math.hypot(dx, dz);
  if (distance > CONTACT_REACH + (wolf.sizeTrait ?? 0) * .09) return false;
  const forward = dx * Math.sin(wolf.angle) + dz * Math.cos(wolf.angle);
  return forward >= distance * .70 && collisions.clearLine(wolf.x, wolf.z, prey.x, prey.z);
}
