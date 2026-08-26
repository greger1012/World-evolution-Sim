import type { CreatureView } from "@evo-world-sim/core";

export type CreatureDrawStyle = {
  selectedId: number | null;
  tilePx: number;
};

const HERD_LINK = 7.5;
const PACK_LINK = 6.5;

/** Draw faint social bonds between groupmates (herds / packs). */
export function drawSocialLinks(
  ctx: CanvasRenderingContext2D,
  creatures: readonly CreatureView[],
  toWorld: (c: CreatureView) => { wx: number; wy: number },
  tilePx: number,
): void {
  const social = creatures.filter((c) => c.social > 0.35);
  if (social.length < 2) return;

  ctx.save();
  ctx.lineWidth = Math.max(0.04, 0.9 / tilePx);
  for (let i = 0; i < social.length; i++) {
    const a = social[i]!;
    const aw = toWorld(a);
    const maxDist = a.diet >= 0.5 ? PACK_LINK : HERD_LINK;
    const maxDist2 = maxDist * maxDist;
    for (let j = i + 1; j < social.length; j++) {
      const b = social[j]!;
      if (b.speciesId !== a.speciesId) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx * dx + dy * dy > maxDist2) continue;
      const bw = toWorld(b);
      const alpha = 0.08 + Math.min(a.social, b.social) * 0.14;
      ctx.strokeStyle =
        a.diet >= 0.5 ? `rgba(255,120,120,${alpha})` : `rgba(160,220,180,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(aw.wx, aw.wy);
      ctx.lineTo(bw.wx, bw.wy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Trait-driven body shape with facing direction (not plain circles). */
export function drawEvolvedCreature(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  c: CreatureView,
  unit: number,
  style: CreatureDrawStyle,
): void {
  const heading = c.heading;
  const base = Math.max(0.08, c.radius * unit);
  const elongation = 0.85 + c.speed * 0.55;
  const bodyLen = base * elongation * 1.35;
  const bodyWid = base * (1.15 - c.speed * 0.12);
  const predator = c.diet >= 0.5;
  const light = 32 + c.energy * 34;
  const fill = `hsl(${c.hue} 70% ${light}%)`;
  const outline = predator
    ? "#ff5a5a"
    : `hsl(${c.hue} 75% ${Math.min(88, light + 24)}%)`;

  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(heading);

  if (predator) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(bodyLen * 0.95, 0);
    ctx.lineTo(-bodyLen * 0.58, bodyWid * 0.78);
    ctx.lineTo(-bodyLen * 0.42, 0);
    ctx.lineTo(-bodyLen * 0.58, -bodyWid * 0.78);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyLen * 0.62, bodyWid * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bodyLen * 0.42, 0, bodyWid * 0.38, 0, Math.PI * 2);
    ctx.fill();
    if (c.fecundity > 0.66) {
      ctx.fillStyle = `hsl(${c.hue} 55% ${Math.max(28, light - 12)}%)`;
      ctx.beginPath();
      ctx.ellipse(-bodyLen * 0.15, 0, bodyLen * 0.28, bodyWid * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (c.armor > 0.35) {
    ctx.strokeStyle = "rgba(200,210,225,0.75)";
    ctx.lineWidth = Math.max(0.05, 1 / style.tilePx);
    const plates = c.armor > 0.62 ? 3 : 2;
    for (let p = 0; p < plates; p++) {
      const px = -bodyLen * 0.22 + (p * bodyLen * 0.28) / Math.max(1, plates - 1);
      ctx.beginPath();
      ctx.arc(px, 0, bodyWid * 0.34, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(0.05, (predator ? 2 : 1) / style.tilePx);
  if (predator) {
    ctx.beginPath();
    ctx.moveTo(bodyLen * 0.95, 0);
    ctx.lineTo(-bodyLen * 0.58, bodyWid * 0.78);
    ctx.lineTo(-bodyLen * 0.42, 0);
    ctx.lineTo(-bodyLen * 0.58, -bodyWid * 0.78);
    ctx.closePath();
    ctx.stroke();
  } else {
    ctx.stroke();
  }

  if (c.infection > 0.12) {
    ctx.strokeStyle = `rgba(176,108,255,${0.35 + c.infection * 0.55})`;
    ctx.lineWidth = Math.max(0.08, 2 / style.tilePx);
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(bodyLen, bodyWid) + 2 / style.tilePx, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  if (c.id === style.selectedId) {
    const reach = Math.max(bodyLen, bodyWid) + 4 / style.tilePx;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(0.1, 2.5 / style.tilePx);
    ctx.beginPath();
    ctx.arc(wx, wy, reach, 0, Math.PI * 2);
    ctx.stroke();
  }
}
