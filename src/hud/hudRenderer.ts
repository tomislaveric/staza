import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { HudTimeline } from "../domain.js";
import { circle, createCanvas, fillRect, line, text, writePng } from "./raster.js";
import { deriveHudState } from "./state.js";

export interface HudSettings {
  minimapEnabled: boolean;
  eventFeedEnabled: boolean;
  nextItemEnabled: boolean;
  mapRangeMeters: number;
  eventFeedDurationSeconds: number;
  eventFeedMaxItems: number;
  frameRate: number;
}

export interface HudFrames {
  mapPattern?: string;
  feedPattern?: string;
}

const drawMap = (
  width: number,
  height: number,
  timeline: HudTimeline,
  time: number,
  intervalStart: number,
  intervalEnd: number,
  settings: HudSettings
): ReturnType<typeof createCanvas> => {
  const canvas = createCanvas(width, height);
  const state = deriveHudState(
    timeline,
    time,
    settings.mapRangeMeters,
    settings.eventFeedDurationSeconds,
    settings.eventFeedMaxItems,
    { start: intervalStart, end: intervalEnd }
  );
  const mapSize = Math.min(width - 16, Math.floor(height * 0.68));
  const mapX = Math.floor((width - mapSize) / 2);
  const mapY = 8;
  fillRect(canvas, 0, 0, width, height, [10, 18, 30, 190]);
  if (settings.minimapEnabled) {
    fillRect(canvas, mapX, mapY, mapSize, mapSize, [18, 32, 50, 220]);
    const mapPoints = [...state.route, state.riderPoint];
    const minX = Math.min(...mapPoints.map((point) => point.x));
    const maxX = Math.max(...mapPoints.map((point) => point.x));
    const minY = Math.min(...mapPoints.map((point) => point.y));
    const maxY = Math.max(...mapPoints.map((point) => point.y));
    const span = Math.max(maxX - minX, maxY - minY, 20);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const toScreen = (point: { x: number; y: number }) => ({
      x: mapX + mapSize / 2 + ((point.x - centerX) / span) * mapSize * 0.84,
      y: mapY + mapSize / 2 + ((point.y - centerY) / span) * mapSize * 0.84
    });
    const pixelsPerMeter = (mapSize * 0.84) / span;
    for (let index = 1; index < state.route.length; index += 1) {
      const before = toScreen(state.route[index - 1]);
      const after = toScreen(state.route[index]);
      line(canvas, before.x, before.y, after.x, after.y, [75, 170, 235, 220]);
    }
    for (const item of state.items) {
      const point = toScreen(item);
      circle(canvas, point.x, point.y, 4, [255, 207, 55, 255]);
    }
    const rider = toScreen(state.riderPoint);
    const riderX = rider.x;
    const riderY = rider.y;
    const direction = state.riderDirection;
    const tipX = riderX + direction.x * 12;
    const tipY = riderY + direction.y * 12;
    const leftX = riderX - direction.x * 7 - direction.y * 5;
    const leftY = riderY - direction.y * 7 + direction.x * 5;
    const rightX = riderX - direction.x * 7 + direction.y * 5;
    const rightY = riderY - direction.y * 7 - direction.x * 5;
    line(canvas, leftX, leftY, tipX, tipY, [40, 200, 255, 255]);
    line(canvas, rightX, rightY, tipX, tipY, [40, 200, 255, 255]);
    line(canvas, leftX, leftY, rightX, rightY, [40, 200, 255, 255]);

    const compassX = mapX + mapSize - 16;
    const compassY = mapY + 19;
    const northX = state.northDirection.x * 7;
    const northY = state.northDirection.y * 7;
    line(canvas, compassX, compassY, compassX + northX, compassY + northY, [200, 215, 230, 210]);
    circle(canvas, compassX, compassY, 2, [200, 215, 230, 210]);
    text(canvas, "N", compassX - 3, compassY - 16, 2, [200, 215, 230, 210]);
  }
  if (settings.nextItemEnabled && state.next) {
    text(canvas, "NEXT", 10, mapSize + 17, 2, [160, 190, 215, 255]);
    text(canvas, `${state.next.event.collectible.name} ${Math.round(state.next.distanceMeters)}M +${state.next.event.value}`, 10, mapSize + 35, 2, [255, 255, 255, 255]);
  }
  if (state.feedback) {
    const alpha = Math.round(255 * (1 - (time - state.feedback.videoSecond)));
    text(canvas, `${state.feedback.collectible.name} +${state.feedback.value}`, 8, 8, 2, [255, 220, 80, Math.max(0, alpha)]);
  }
  return canvas;
};

const drawFeed = (width: number, height: number, timeline: HudTimeline, time: number, settings: HudSettings): ReturnType<typeof createCanvas> => {
  const canvas = createCanvas(width, height);
  const state = deriveHudState(timeline, time, settings.mapRangeMeters, settings.eventFeedDurationSeconds, settings.eventFeedMaxItems);
  for (const [index, event] of state.recentEvents.entries()) {
    const age = time - event.videoSecond;
    const alpha = Math.round(220 * (1 - age / settings.eventFeedDurationSeconds));
    const y = 8 + index * 30;
    fillRect(canvas, 0, y, width, 25, [10, 18, 30, Math.max(0, alpha)]);
    text(canvas, `${event.collectible.name} +${event.value}`, 8, y + 6, 2, [255, 230, 120, Math.max(0, alpha)]);
  }
  return canvas;
};

export const renderHudFrames = async (
  directory: string,
  intervalStart: number,
  intervalEnd: number,
  videoWidth: number,
  videoHeight: number,
  timeline: HudTimeline,
  settings: HudSettings
): Promise<HudFrames> => {
  const mapWidth = Math.max(180, Math.min(360, Math.round(videoWidth * 0.22)));
  const mapHeight = Math.round(mapWidth * 1.22);
  const feedWidth = Math.max(160, Math.min(300, Math.round(videoWidth * 0.2)));
  const feedHeight = Math.max(40, settings.eventFeedMaxItems * 30 + 10);
  const frameCount = Math.max(1, Math.ceil((intervalEnd - intervalStart) * settings.frameRate));
  const mapDirectory = path.join(directory, "hud-map");
  const feedDirectory = path.join(directory, "hud-feed");
  if (settings.minimapEnabled || settings.nextItemEnabled) await mkdir(mapDirectory, { recursive: true });
  if (settings.eventFeedEnabled) await mkdir(feedDirectory, { recursive: true });
  for (let index = 0; index < frameCount; index += 1) {
    const time = intervalStart + index / settings.frameRate;
    const filename = `${String(index).padStart(5, "0")}.png`;
    const writes: Promise<void>[] = [];
    if (settings.minimapEnabled || settings.nextItemEnabled) writes.push(writePng(path.join(mapDirectory, filename), drawMap(mapWidth, mapHeight, timeline, time, intervalStart, intervalEnd, settings)));
    if (settings.eventFeedEnabled) writes.push(writePng(path.join(feedDirectory, filename), drawFeed(feedWidth, feedHeight, timeline, time, settings)));
    await Promise.all(writes);
  }
  return {
    mapPattern: settings.minimapEnabled || settings.nextItemEnabled ? path.join(mapDirectory, "%05d.png") : undefined,
    feedPattern: settings.eventFeedEnabled ? path.join(feedDirectory, "%05d.png") : undefined
  };
};
