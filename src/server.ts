import { randomBytes, randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { deriveActivity, deriveActivityResult } from "./activity.js";
import { config } from "./config.js";
import type { ActivityImportResult, ActivityVideo, Fartlek, HudTimeline, Job, MappedGameEvent, PersistedActivity, WorldFartlek } from "./domain.js";
import { UserInputError } from "./errors.js";
import { parseFitTrack, parseFitMetadata } from "./fit.js";
import { extractGps5Times, mapToVideoSecond } from "./gpmf.js";
import {
  assessSynchronization,
  withEventAvailability,
  SynchronizationError
} from "./synchronization.js";
import { createHudTimeline, loadHudTimeline, saveHudTimeline } from "./hud/timeline.js";
import { ActivityRepository } from "./persistence/activityRepository.js";
import { CollectibleRepository } from "./persistence/collectibleRepository.js";
import { FartlekRepository } from "./persistence/fartlekRepository.js";
import { FartlekCompletionRepository } from "./persistence/fartlekCompletionRepository.js";
import { QuestNotFoundError, QuestRepository } from "./persistence/questRepository.js";
import { createDatabasePool } from "./persistence/database.js";
import { migrate } from "./persistence/migrate.js";
import { buildClipIntervals, gpmfStreamIndex, probeDuration, renderSelectedClips } from "./video.js";
import { getRelevantCollectibles, getRelevantFartleks, parseBoundsParameter } from "./worldQuery.js";
import { toWorldFartlek } from "./fartlek.js";
import { createWorldSnapshot } from "./world.js";
import { getBasemapConfig, getBasemapOrigins } from "./basemap.js";
import {
  createQuestRouteSnapshot,
  parseQuestInput,
  suggestQuestTitle
} from "./quest.js";
import { AuthService, EmailSender, type SessionUser } from "./auth.js";
import { translateLandingTemplate } from "./landing/locales.js";

interface UploadRequest extends Request {
  job?: Job;
  jobDir?: string;
  user?: SessionUser;
  sessionToken?: string;
}

let busy = false;

if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");
const databasePool = createDatabasePool(config.databaseUrl);
await migrate(databasePool);
const activityRepository = new ActivityRepository(databasePool);
const collectibleRepository = new CollectibleRepository(databasePool);
const fartlekRepository = new FartlekRepository(databasePool);
const fartlekCompletionRepository = new FartlekCompletionRepository(databasePool);
const questRepository = new QuestRepository(databasePool);
const smtpConfig = config.smtpHost && config.smtpUser && config.smtpPassword && config.mailFrom
  ? {
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      user: config.smtpUser,
      password: config.smtpPassword,
      from: config.mailFrom
    }
  : undefined;
const authService = new AuthService(databasePool, {
  rpId: config.webauthnRpId,
  rpName: config.webauthnRpName,
  origin: config.webauthnOrigin,
  production: config.nodeEnv === "production"
}, new EmailSender(config.nodeEnv === "production", smtpConfig));
await activityRepository.markInterruptedActivityVideos();

const jobFile = (directory: string): string => path.join(directory, "job.json");

const saveJob = async (directory: string, job: Job): Promise<void> => {
  job.updatedAt = new Date().toISOString();
  const file = jobFile(directory);
  const temporaryFile = `${file}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(job, null, 2));
  await rename(temporaryFile, file);
};

const validToken = (token: string): boolean => /^[a-f0-9]{48}$/.test(token);

const loadJob = async (token: string, playerId: string): Promise<{ job: Job; directory: string }> => {
  if (!validToken(token)) throw new UserInputError("Unknown job.");
  const directory = path.join(config.dataDir, token);
  try {
    const job = JSON.parse(await readFile(jobFile(directory), "utf8")) as Job;
    if (job.playerId !== playerId) throw new UserInputError("Unknown or expired job.");
    return { job, directory };
  } catch {
    throw new UserInputError("Unknown or expired job.");
  }
};

const storage = multer.diskStorage({
  destination: (request, _file, callback) => callback(null, (request as UploadRequest).jobDir ?? ""),
  filename: (_request, file, callback) => {
    callback(null, file.fieldname === "fit" ? "track.fit" : "video.mp4");
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 2 },
  fileFilter: (_request, file, callback) => {
    if (file.fieldname === "fit" || file.fieldname === "video") callback(null, true);
    else callback(new UserInputError("Only fit and video upload fields are supported."));
  }
});
const lateVideoUpload = multer({
  dest: config.dataDir,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (file.fieldname === "video") callback(null, true);
    else callback(new UserInputError("Only the video upload field is supported."));
  }
});
const importUpload = multer({
  dest: config.dataDir,
  limits: { fileSize: config.maxUploadBytes, files: 2 },
  fileFilter: (_request, file, callback) => {
    if (file.fieldname === "fit" || file.fieldname === "video") callback(null, true);
    else callback(new UserInputError("Only fit and video upload fields are supported."));
  }
});

const reserveJob = async (request: UploadRequest, response: Response, next: NextFunction): Promise<void> => {
  if (busy) {
    response.status(429).json({ error: "The renderer is busy. Try again after the current job finishes." });
    return;
  }
  busy = true;
  const token = randomBytes(24).toString("hex");
  const directory = path.join(config.dataDir, token);
  const job: Job = {
    token,
    playerId: request.user!.playerId,
    state: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  try {
    await mkdir(directory, { recursive: false });
    await saveJob(directory, job);
    request.job = job;
    request.jobDir = directory;
    next();
  } catch (error) {
    busy = false;
    next(error);
  }
};

const cleanupReservation = async (request: UploadRequest): Promise<void> => {
  busy = false;
  if (request.jobDir) await rm(request.jobDir, { recursive: true, force: true });
};

const processDetection = async (
  directory: string,
  job: Job,
  hasVideo: boolean,
  repository: ActivityRepository,
  playerId: string
): Promise<void> => {
  try {
    const [collectibles, fartleks] = await Promise.all([
      collectibleRepository.listAll(),
      fartlekRepository.listPublished()
    ]);
    const fit = path.join(directory, "track.fit");
    const [track, metadata] = await Promise.all([parseFitTrack(fit), parseFitMetadata(fit)]);
    const activity = deriveActivity(job.token, track, "unknown", metadata);
    const relevantCollectibles = getRelevantCollectibles(collectibles, track, config.worldQueryPaddingMeters);
    const relevantFartleks = getRelevantFartleks(fartleks, track, config.worldQueryPaddingMeters);
    const activityResult = deriveActivityResult(activity, relevantCollectibles, relevantFartleks);
    job.activity = activity;
    job.activityResult = activityResult;
    job.world = {
      totalCollectibles: collectibles.length,
      relevantCollectibles: relevantCollectibles.length
    };
    job.resultMode = hasVideo ? "video" : "activity";
    await repository.persistCompletedActivity(playerId, activity, activityResult);

    if (!hasVideo) {
      job.state = "succeeded";
      return;
    }

    const video = path.join(directory, "video.mp4");
    const sourceDuration = await probeDuration(video, config.processTimeoutMs);
    const streamIndex = await gpmfStreamIndex(video, config.processTimeoutMs);
    const samples = await extractGps5Times(
      video,
      path.join(directory, "metadata.gpmf"),
      streamIndex,
      config.processTimeoutMs
    );
    const assessment = assessSynchronization(
      track,
      samples,
      sourceDuration,
      config.fitSampleGapWarningSeconds
    );
    const mappedEvents: MappedGameEvent[] = [];
    for (const event of activityResult.events) {
      const videoSecond = mapToVideoSecond(event.activityTimestamp, samples);
      if (videoSecond < 0 || videoSecond > sourceDuration) continue;
      mappedEvents.push({
        ...event,
        videoSecond: Number(videoSecond.toFixed(3))
      });
    }
    if (mappedEvents.length === 0) {
      job.synchronization = withEventAvailability(
        assessment,
        activityResult.events.map((event) => event.activityTimestamp)
      );
      throw new UserInputError("No configured coin passage maps to a time within the video.");
    }
    const allEvents = mappedEvents.sort((left, right) => left.videoSecond - right.videoSecond);
    await saveHudTimeline(
      path.join(directory, "hud-timeline.json"),
      createHudTimeline(track, activityResult.collectibles, allEvents, samples, sourceDuration)
    );
    job.state = "awaiting_selection";
    job.sourceDuration = sourceDuration;
    job.mappedEvents = allEvents;
    job.synchronization = withEventAvailability(
      assessment,
      activityResult.events.map((event) => event.activityTimestamp)
    );
  } catch (error) {
    job.state = "failed";
    job.error = error instanceof Error ? error.message : "Unexpected processing failure.";
    if (error instanceof SynchronizationError) {
      job.synchronization = error.summary;
    }
    console.error(`Job ${job.token} failed:`, error);
  } finally {
    try {
      await saveJob(directory, job);
    } finally {
      busy = false;
    }
  }
};

const renderSelection = async (
  directory: string,
  job: Job,
  events: MappedGameEvent[],
  repository: ActivityRepository,
  playerId: string
): Promise<void> => {
  try {
    if (job.sourceDuration === undefined) throw new UserInputError("Job has no source video duration.");
    const hudTimeline: HudTimeline | undefined = config.hudEnabled && !config.showLegacyCoinOverlay
      ? await loadHudTimeline(path.join(directory, "hud-timeline.json"))
      : undefined;
    const outputFile = "clip.mp4";
    job.render = await renderSelectedClips(
      path.join(directory, "video.mp4"),
      path.join(directory, outputFile),
      events,
      job.sourceDuration,
      directory,
      config.processTimeoutMs,
      hudTimeline
    );
    await repository.markActivityHasVideo(playerId, job.token);
    job.state = "succeeded";
    job.outputFile = outputFile;
  } catch (error) {
    job.state = "failed";
    job.error = error instanceof Error ? error.message : "Unexpected rendering failure.";
    console.error(`Job ${job.token} rendering failed:`, error);
  } finally {
    try {
      await saveJob(directory, job);
    } finally {
      busy = false;
    }
  }
};

const selectedEvents = (job: Job, value: unknown): MappedGameEvent[] => {
  if (!Array.isArray(value) || value.length === 0 || !value.every((id) => typeof id === "string")) {
    throw new UserInputError("Select at least one detected collectible id.");
  }
  if (value.length > config.maxSelectedCoins) {
    throw new UserInputError(`Select no more than ${config.maxSelectedCoins} collectibles.`);
  }
  const ids = new Set(value);
  if (ids.size !== value.length) throw new UserInputError("Selected collectible ids must be unique.");
  const knownEvents = new Map((job.mappedEvents ?? []).map((event) => [event.sourceId, event]));
  const events = value.map((id) => knownEvents.get(id));
  if (events.some((event) => event === undefined)) {
    throw new UserInputError("Selection contains an unknown detected collectible.");
  }
  return (events as MappedGameEvent[]).sort(
    (left, right) => left.videoSecond - right.videoSecond
  );
};

const selectedMappedEvents = (mappedEvents: MappedGameEvent[] | undefined, value: unknown): MappedGameEvent[] => {
  if (!Array.isArray(value) || value.length === 0 || !value.every((id) => typeof id === "string")) {
    throw new UserInputError("Select at least one detected collectible id.");
  }
  if (value.length > config.maxSelectedCoins) {
    throw new UserInputError(`Select no more than ${config.maxSelectedCoins} collectibles.`);
  }
  const ids = new Set(value);
  if (ids.size !== value.length) throw new UserInputError("Selected collectible ids must be unique.");
  const knownEvents = new Map((mappedEvents ?? []).map((event) => [event.sourceId, event]));
  const events = value.map((id) => knownEvents.get(id));
  if (events.some((event) => event === undefined)) throw new UserInputError("Selection contains an unknown detected collectible.");
  return (events as MappedGameEvent[]).sort((left, right) => left.videoSecond - right.videoSecond);
};

const activityMediaDirectory = (activityId: string, mediaId: string): string =>
  path.join(config.mediaDir, activityId, mediaId);

const attachVideoUrls = (activity: PersistedActivity): PersistedActivity => {
  if (!activity.video) return activity;
  const video = activity.video;
  return {
    ...activity,
    video: {
      ...video,
      ...(video.state === "succeeded" ? {
        previewUrl: `/api/activities/${encodeURIComponent(activity.id)}/video/preview`,
        downloadUrl: `/api/activities/${encodeURIComponent(activity.id)}/video/download`
      } : {})
    }
  };
};

const processAttachedVideo = async (
  playerId: string,
  activity: PersistedActivity,
  mediaId: string,
  mediaDirectory: string
): Promise<void> => {
  const video = activity.video;
  const replay = activity.replay;
  if (!video || !replay) return;
  try {
    const sourcePath = path.join(mediaDirectory, "source.mp4");
    const sourceDuration = await probeDuration(sourcePath, config.processTimeoutMs);
    const streamIndex = await gpmfStreamIndex(sourcePath, config.processTimeoutMs);
    const samples = await extractGps5Times(sourcePath, path.join(mediaDirectory, "metadata.gpmf"), streamIndex, config.processTimeoutMs);
    const assessment = assessSynchronization(replay.activity.route, samples, sourceDuration, config.fitSampleGapWarningSeconds);
    const mappedEvents = replay.activityResult.events.flatMap((event) => {
      const videoSecond = mapToVideoSecond(event.activityTimestamp, samples);
      return videoSecond < 0 || videoSecond > sourceDuration ? [] : [{ ...event, videoSecond: Number(videoSecond.toFixed(3)) }];
    }).sort((left, right) => left.videoSecond - right.videoSecond);
    const synchronization = withEventAvailability(assessment, replay.activityResult.events.map((event) => event.activityTimestamp));
    if (mappedEvents.length === 0) {
      await activityRepository.updateActivityVideo(playerId, activity.id, {
        ...video, mediaId, state: "no_highlights", sourceDuration, synchronization, events: []
      });
      return;
    }
    await saveHudTimeline(
      path.join(mediaDirectory, "hud-timeline.json"),
      createHudTimeline(replay.activity.route, replay.activityResult.collectibles, mappedEvents, samples, sourceDuration)
    );
    await activityRepository.updateActivityVideo(playerId, activity.id, {
      ...video, mediaId, state: "awaiting_selection", sourceDuration, synchronization, events: mappedEvents
    });
  } catch (error) {
    const synchronization = error instanceof SynchronizationError ? error.summary : undefined;
    await activityRepository.updateActivityVideo(playerId, activity.id, {
      ...video, mediaId, state: "sync_failed", synchronization,
      error: error instanceof Error ? error.message : "Unexpected video synchronization failure."
    });
    console.error(`Activity video ${mediaId} synchronization failed:`, error);
  } finally {
    busy = false;
  }
};

const attachUploadedVideo = async (
  playerId: string,
  activity: PersistedActivity,
  uploaded: Express.Multer.File
): Promise<{ video?: ActivityVideo; videoError?: string }> => {
  const mediaId = randomUUID();
  const directory = activityMediaDirectory(activity.id, mediaId);
  const sourcePath = path.join(directory, "source.mp4");
  await mkdir(directory, { recursive: true });
  try {
    await rename(uploaded.path, sourcePath);
    const video = await activityRepository.createActivityVideo(playerId, activity.id, mediaId, uploaded.originalname, sourcePath);
    if (busy) {
      const videoError = "Video processing is busy. Attach this video again after the current processing finishes.";
      await activityRepository.updateActivityVideo(playerId, activity.id, { ...video, state: "sync_failed", error: videoError });
      return { video: { ...video, state: "sync_failed", error: videoError }, videoError };
    }
    busy = true;
    void processAttachedVideo(playerId, { ...activity, video }, mediaId, directory);
    return { video: { ...video, state: "syncing" } };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};

const importActivity = async (
  playerId: string,
  importKey: string,
  fit: Express.Multer.File,
  uploadedVideo?: Express.Multer.File
): Promise<ActivityImportResult> => {
  const existing = await activityRepository.getActivityByImportKey(playerId, importKey);
  if (existing) {
    await Promise.all([rm(fit.path, { force: true }), uploadedVideo ? rm(uploadedVideo.path, { force: true }) : Promise.resolve()]);
    return { activity: attachVideoUrls(existing), inserted: false };
  }

  try {
    const [collectibles, fartleks, track, metadata] = await Promise.all([
      collectibleRepository.listAll(),
      fartlekRepository.listPublished(),
      parseFitTrack(fit.path),
      parseFitMetadata(fit.path)
    ]);
    const activity = deriveActivity(randomUUID(), track, "unknown", metadata);
    const relevantCollectibles = getRelevantCollectibles(collectibles, track, config.worldQueryPaddingMeters);
    const relevantFartleks = getRelevantFartleks(fartleks, track, config.worldQueryPaddingMeters);
    const activityResult = deriveActivityResult(activity, relevantCollectibles, relevantFartleks);
    const persisted = await activityRepository.persistCompletedActivity(playerId, activity, activityResult, importKey);
    let importedActivity = persisted.activity;
    let videoError: string | undefined;
    if (persisted.inserted && uploadedVideo) {
      try {
        const attachment = await attachUploadedVideo(playerId, importedActivity, uploadedVideo);
        if (attachment.video) importedActivity = { ...importedActivity, video: attachment.video };
        videoError = attachment.videoError;
      } catch (error) {
        videoError = error instanceof Error ? error.message : "Video could not be attached.";
        console.error(`Could not attach video to imported activity ${importedActivity.id}:`, error);
      }
    } else if (uploadedVideo) {
      await rm(uploadedVideo.path, { force: true });
    }
    return { activity: attachVideoUrls(importedActivity), inserted: persisted.inserted, ...(videoError ? { videoError } : {}) };
  } finally {
    await rm(fit.path, { force: true });
  }
};

const renderAttachedVideo = async (playerId: string, activity: PersistedActivity, events: MappedGameEvent[]): Promise<void> => {
  const video = activity.video;
  if (!video) return;
  const mediaDirectory = activityMediaDirectory(activity.id, video.mediaId);
  try {
    if (video.sourceDuration === undefined) throw new UserInputError("Video has no source duration.");
    const hudTimeline: HudTimeline | undefined = config.hudEnabled && !config.showLegacyCoinOverlay
      ? await loadHudTimeline(path.join(mediaDirectory, "hud-timeline.json"))
      : undefined;
    const outputPath = path.join(mediaDirectory, "highlights.mp4");
    const render = await renderSelectedClips(
      path.join(mediaDirectory, "source.mp4"), outputPath, events, video.sourceDuration, mediaDirectory,
      config.processTimeoutMs, hudTimeline
    );
    await activityRepository.updateActivityVideo(playerId, activity.id, {
      ...video, state: "succeeded", selectedSourceIds: events.map((event) => event.sourceId), render
    }, undefined, outputPath);
    await activityRepository.markActivityHasVideo(playerId, activity.id);
  } catch (error) {
    await activityRepository.updateActivityVideo(playerId, activity.id, {
      ...video, state: "render_failed", error: error instanceof Error ? error.message : "Unexpected highlight rendering failure."
    });
    console.error(`Activity video ${video.mediaId} rendering failed:`, error);
  } finally {
    busy = false;
  }
};

const cleanExpiredJobs = async (): Promise<void> => {
  const { readdir } = await import("node:fs/promises");
  let entries: string[];
  try {
    entries = await readdir(config.dataDir);
  } catch (error) {
    console.error("Could not scan expired jobs:", error);
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const directory = path.join(config.dataDir, entry);
      try {
        const info = await stat(directory);
        if (!info.isDirectory()) return;
        let expired = Date.now() - info.mtimeMs > config.jobTtlMs;
        try {
          const job = JSON.parse(await readFile(jobFile(directory), "utf8")) as Job;
          const updatedAt = new Date(job.updatedAt).getTime();
          const ttl = job.state === "awaiting_selection" ? config.selectionTtlMs : config.jobTtlMs;
          expired = !Number.isFinite(updatedAt) || Date.now() - updatedAt > ttl;
        } catch {
          // The directory-mtime fallback removes incomplete or corrupt job directories.
        }
        if (expired) {
          await rm(directory, { recursive: true, force: true });
        }
      } catch (error) {
        console.error(`Could not clean job directory ${entry}:`, error);
      }
    })
  );
};

await Promise.all([mkdir(config.dataDir, { recursive: true }), mkdir(config.mediaDir, { recursive: true })]);
await cleanExpiredJobs();
setInterval(() => void cleanExpiredJobs(), Math.min(config.jobTtlMs, 60_000)).unref();

const app = express();
app.set("trust proxy", 1);
const basemapOrigins = getBasemapOrigins();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", ...basemapOrigins],
      connectSrc: ["'self'", ...basemapOrigins],
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: config.nodeEnv === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  referrerPolicy: { policy: "same-origin" }
}));
app.use(express.json({ limit: "16kb" }));

const cookieValue = (request: Request, name: string): string | undefined => {
  const encoded = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return encoded ? decodeURIComponent(encoded) : undefined;
};
const sessionCookieName = config.nodeEnv === "production" ? "__Host-session" : "session";
const expectedOrigin = config.webauthnOrigin ?? "http://localhost:3000";
const setSession = (response: Response, value: string): void => {
  response.cookie(sessionCookieName, value, {
    httpOnly: true, secure: config.nodeEnv === "production", sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 * 1000
  });
};
const clearSession = (response: Response): void => {
  response.clearCookie(sessionCookieName, {
    httpOnly: true, secure: config.nodeEnv === "production", sameSite: "lax", path: "/"
  });
};
const optionalUser = async (request: UploadRequest, _response: Response, next: NextFunction): Promise<void> => {
  try {
    request.sessionToken = cookieValue(request, sessionCookieName);
    request.user = await authService.getSessionUser(request.sessionToken);
    next();
  } catch (error) {
    next(error);
  }
};
const requireUser = (request: UploadRequest, response: Response, next: NextFunction): void => {
  if (!request.user) {
    response.status(401).json({ error: "Sign in is required." });
    return;
  }
  next();
};
const requirePlayer = requireUser;
const requireCsrf = (request: UploadRequest, response: Response, next: NextFunction): void => {
  if (!request.user || request.header("X-CSRF-Token") !== request.user.csrfToken || request.header("Origin") !== expectedOrigin) {
    response.status(403).json({ error: "The request could not be verified." });
    return;
  }
  next();
};
const authLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });

app.post("/api/auth/register/code", authLimiter, async (request, response, next) => {
  try {
    await authService.requestEmailCode(request.body?.email, "register");
    response.status(202).json({ message: "If the address can receive a code, it will arrive shortly." });
  } catch (error) { next(error); }
});
app.post("/api/auth/register/verify", authLimiter, async (request, response, next) => {
  try {
    const session = await authService.register(request.body?.email, request.body?.code);
    setSession(response, session.sessionToken);
    response.status(201).json({ user: { email: session.user.email, emailVerified: session.user.emailVerified }, csrfToken: session.user.csrfToken, passkeySetupRequired: true });
  } catch (error) { next(error); }
});
app.post("/api/auth/email-code/request", authLimiter, async (request, response, next) => {
  try {
    await authService.requestEmailCode(request.body?.email, "login");
    response.status(202).json({ message: "If the address can receive a code, it will arrive shortly." });
  } catch (error) { next(error); }
});
app.post("/api/auth/email-code/verify", authLimiter, async (request, response, next) => {
  try {
    const session = await authService.emailLogin(request.body?.email, request.body?.code);
    if (session.sessionToken && session.user) setSession(response, session.sessionToken);
    response.json(session.user ? {
      authenticated: true,
      user: { email: session.user.email, emailVerified: session.user.emailVerified },
      csrfToken: session.user.csrfToken
    } : { authenticated: false });
  } catch (error) { next(error); }
});
app.post("/api/auth/passkeys/login/options", authLimiter, async (_request, response, next) => {
  try { response.json(await authService.loginOptions()); } catch (error) { next(error); }
});
app.post("/api/auth/passkeys/login/verify", authLimiter, async (request, response, next) => {
  try {
    const session = await authService.verifyLogin(request.body as AuthenticationResponseJSON);
    setSession(response, session.sessionToken);
    response.json({ user: { email: session.user.email, emailVerified: session.user.emailVerified }, csrfToken: session.user.csrfToken });
  } catch (error) { next(error); }
});
app.use("/api", optionalUser);
app.get("/api/auth/session", (request: UploadRequest, response) => {
  response.json(request.user ? {
    authenticated: true,
    user: { email: request.user.email, emailVerified: request.user.emailVerified },
    csrfToken: request.user.csrfToken
  } : { authenticated: false });
});
app.post("/api/auth/logout", requireUser, requireCsrf, async (request: UploadRequest, response, next) => {
  try { await authService.logout(request.sessionToken); clearSession(response); response.status(204).end(); } catch (error) { next(error); }
});
app.post("/api/auth/logout-all", requireUser, requireCsrf, async (request: UploadRequest, response, next) => {
  try { await authService.logoutAll(request.user!.id); clearSession(response); response.status(204).end(); } catch (error) { next(error); }
});
app.post("/api/auth/passkeys/register/options", requireUser, requireCsrf, async (request: UploadRequest, response, next) => {
  try { response.json(await authService.registrationOptions(request.user!)); } catch (error) { next(error); }
});
app.post("/api/auth/passkeys/register/verify", requireUser, requireCsrf, async (request: UploadRequest, response, next) => {
  try { await authService.verifyRegistration(request.user!, request.body as RegistrationResponseJSON, request.body?.name); response.status(204).end(); } catch (error) { next(error); }
});
app.get("/api/auth/passkeys", requireUser, async (request: UploadRequest, response, next) => {
  try { response.json(await authService.listPasskeys(request.user!.id)); } catch (error) { next(error); }
});
app.delete("/api/auth/passkeys/:id", requireUser, requireCsrf, async (request: UploadRequest, response, next) => {
  try { await authService.deletePasskey(request.user!, String(request.params.id)); response.status(204).end(); } catch (error) { next(error); }
});
app.post("/api/auth/step-up/email/request", requireUser, requireCsrf, authLimiter, async (request: UploadRequest, response, next) => {
  try {
    await authService.requestEmailCode(request.user!.email, "step_up");
    response.status(202).json({ message: "A verification code has been sent." });
  } catch (error) { next(error); }
});
app.post("/api/auth/step-up/email/verify", requireUser, requireCsrf, authLimiter, async (request: UploadRequest, response, next) => {
  try {
    await authService.verifyStepUp(request.user!, request.sessionToken!, request.body?.code);
    response.status(204).end();
  } catch (error) { next(error); }
});
app.get("/api/account/export", requireUser, async (request: UploadRequest, response, next) => {
  try {
    if (!authService.isFreshStepUp(request.user!)) throw new UserInputError("Recent step-up authentication is required.");
    response.attachment("staza-account-export.json").json(await authService.exportAccount(request.user!));
  } catch (error) { next(error); }
});
app.post("/api/account/deletion-intent", requireUser, requireCsrf, async (request: UploadRequest, response, next) => {
  try { response.status(201).json(await authService.createDeletionIntent(request.user!)); } catch (error) { next(error); }
});
app.post("/api/account/delete", requireUser, requireCsrf, async (request: UploadRequest, response, next) => {
  try {
    const paths = await authService.confirmDeletion(request.user!, request.body?.confirmationToken);
    await Promise.all(paths.map((mediaPath) => rm(path.dirname(mediaPath), { recursive: true, force: true })));
    clearSession(response);
    response.status(204).end();
  } catch (error) { next(error); }
});
app.get("/shared/progression.js", (_request, response) => {
  response.sendFile(path.resolve("dist/progression.js"));
});
app.use("/shared/webauthn", express.static(path.resolve("node_modules/@simplewebauthn/browser/esm")));
app.use("/shared/maplibre", express.static(path.resolve("node_modules/maplibre-gl/dist")));

const landingDocument = path.resolve("public/landing/index.html");
const appDocument = path.resolve("public/index.html");
const landingTemplate = await readFile(landingDocument, "utf8");
app.get("/", (_request, response) => {
  response.type("html").send(translateLandingTemplate(landingTemplate, "en"));
});
app.get(["/de", "/de/"], (_request, response) => {
  response.type("html").send(translateLandingTemplate(landingTemplate, "de"));
});
app.get(["/app", "/sign-in"], (_request, response) => {
  response.sendFile(appDocument);
});
app.get(/^\/(?:en|de)(?:\/.*)?$/, (_request, response) => {
  response.sendFile(appDocument);
});

app.use(express.static(path.resolve("public")));

app.post(
  "/api/activities/import",
  requirePlayer,
  requireCsrf,
  importUpload.fields([{ name: "fit", maxCount: 1 }, { name: "video", maxCount: 1 }]),
  async (request: UploadRequest, response, next) => {
    const files = request.files as Record<string, Express.Multer.File[]> | undefined;
    const fit = files?.fit?.[0];
    const video = files?.video?.[0];
    const importKey = request.header("Idempotency-Key");
    if (!fit) {
      response.status(400).json({ error: "One FIT file is required." });
      return;
    }
    if (!importKey || !/^[a-zA-Z0-9-]{16,128}$/.test(importKey)) {
      await Promise.all([rm(fit.path, { force: true }), video ? rm(video.path, { force: true }) : Promise.resolve()]);
      response.status(400).json({ error: "A valid Idempotency-Key is required for activity import." });
      return;
    }
    try {
      response.status(201).json(await importActivity(request.user!.playerId, importKey, fit, video));
    } catch (error) {
      await Promise.all([rm(fit.path, { force: true }), video ? rm(video.path, { force: true }) : Promise.resolve()]);
      next(error);
    }
  }
);

app.post(
  "/api/jobs",
  requirePlayer,
  requireCsrf,
  reserveJob,
  upload.fields([{ name: "fit", maxCount: 1 }, { name: "video", maxCount: 1 }]),
  async (request: UploadRequest, response, next) => {
    const files = request.files as Record<string, Express.Multer.File[]> | undefined;
    if (!request.job || !request.jobDir || !files?.fit?.[0]) {
      await cleanupReservation(request);
      response.status(400).json({ error: "One FIT file is required." });
      return;
    }
    void processDetection(request.jobDir, request.job, Boolean(files.video?.[0]), activityRepository, request.user!.playerId);
    response.status(202).json({ token: request.job.token });
    next();
  }
);

app.post("/api/activities/:id/video", requirePlayer, requireCsrf, lateVideoUpload.single("video"), async (request: UploadRequest, response, next) => {
  const uploaded = request.file;
  try {
    if (!uploaded) throw new UserInputError("One video file is required.");
    if (busy) {
      response.status(429).json({ error: "The renderer is busy. Try again after the current job finishes." });
      await rm(uploaded.path, { force: true });
      return;
    }
    const activity = await activityRepository.getActivity(request.user!.playerId, String(request.params.id));
    if (!activity) {
      await rm(uploaded.path, { force: true });
      response.status(404).json({ error: "Activity not found." });
      return;
    }
    if (activity.video) {
      await rm(uploaded.path, { force: true });
      response.status(409).json({ error: "A video is already attached to this activity. Replacing it is not supported." });
      return;
    }
    const mediaId = randomUUID();
    const directory = activityMediaDirectory(activity.id, mediaId);
    const sourcePath = path.join(directory, "source.mp4");
    await mkdir(directory, { recursive: true });
    await rename(uploaded.path, sourcePath);
    const video = await activityRepository.createActivityVideo(request.user!.playerId, activity.id, mediaId, uploaded.originalname, sourcePath);
    busy = true;
    void processAttachedVideo(request.user!.playerId, { ...activity, video }, mediaId, directory);
    response.status(202).json({ activityId: activity.id, video: { ...video, state: "syncing" } });
  } catch (error) {
    if (uploaded) await rm(uploaded.path, { force: true });
    if (error instanceof Error && error.message === "A video is already attached to this activity. Replacing it is not supported.") {
      response.status(409).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.get("/api/activities", requirePlayer, async (request: UploadRequest, response, next) => {
  try {
    response.json(await activityRepository.listActivities(request.user!.playerId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/world/basemap", requirePlayer, (_request: UploadRequest, response) => {
  response.json(getBasemapConfig());
});

const worldFartleksForPlayer = async (playerId: string, fartleks: Fartlek[]): Promise<WorldFartlek[]> => {
  const stats = await fartlekCompletionRepository.statsForPlayer(playerId, fartleks.map((fartlek) => fartlek.id));
  return fartleks.map((fartlek) => toWorldFartlek(fartlek, stats.get(fartlek.id)));
};

app.get("/api/world", requirePlayer, async (request: UploadRequest, response, next) => {
  try {
    const playerId = request.user!.playerId;
    const bounds = parseBoundsParameter(request.query.bbox);
    const discoveredSourceIds = await activityRepository.listDiscoveredCollectibleSourceIds(playerId);
    if (!bounds) {
      const stats = await collectibleRepository.worldStats(discoveredSourceIds);
      response.json({ collectibles: [], stats, quests: [], truncated: false, fartleks: [] });
      return;
    }
    const [viewport, quests, fartlekCandidates] = await Promise.all([
      collectibleRepository.listWithinBounds(bounds, config.worldViewportLimit),
      questRepository.listWithinBounds(playerId, bounds, discoveredSourceIds, config.worldViewportLimit),
      fartlekRepository.listWithinBounds(bounds)
    ]);
    const fartleks = await worldFartleksForPlayer(playerId, fartlekCandidates);
    response.json({
      ...createWorldSnapshot(viewport.collectibles, discoveredSourceIds),
      quests,
      truncated: viewport.truncated,
      fartleks
    });
  } catch (error) {
    next(error);
  }
});

const loadCollectedIds = (playerId: string): Promise<string[]> =>
  activityRepository.listDiscoveredCollectibleSourceIds(playerId);

const assertKnownCollectibles = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return;
  const known = await collectibleRepository.listByIds(ids);
  if (known.length !== ids.length) {
    throw new UserInputError("A quest can only contain collectibles from the Staza catalog.");
  }
};

const questRouteFromActivity = (activity: PersistedActivity): ReturnType<typeof createQuestRouteSnapshot> => {
  const replay = activity.replay;
  if (replay?.version !== 1 || !Array.isArray(replay.activity?.route)) return undefined;
  return createQuestRouteSnapshot(replay.activity, config.questRouteMaxPoints);
};

const handleQuestError = (error: unknown, response: Response, next: NextFunction): void => {
  if (error instanceof QuestNotFoundError) {
    response.status(404).json({ error: "Quest not found." });
    return;
  }
  next(error);
};

app.get("/api/activities/:id/quest-draft", requirePlayer, async (request: UploadRequest, response, next) => {
  try {
    const playerId = request.user!.playerId;
    const activity = await activityRepository.getActivity(playerId, String(request.params.id));
    if (!activity) {
      response.status(404).json({ error: "Activity not found." });
      return;
    }
    const route = questRouteFromActivity(activity);
    if (!route) {
      response.status(409).json({ error: "This activity has no route that can become a quest." });
      return;
    }
    const [collected, encountered] = await Promise.all([
      loadCollectedIds(playerId),
      collectibleRepository.listByIds([...new Set(activity.events.map((event) => event.sourceId))])
    ]);
    const collectedIds = new Set(collected);
    response.json({
      sourceActivityId: activity.id,
      title: suggestQuestTitle(activity.type, activity.startedAt),
      description: "",
      activityType: activity.type,
      ...(activity.distanceMeters === undefined ? {} : { distanceMeters: activity.distanceMeters }),
      route,
      collectibles: encountered.map((collectible) => ({
        ...collectible,
        found: collectedIds.has(collectible.id),
        visibility: "visible" as const
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/quests", requirePlayer, async (request: UploadRequest, response, next) => {
  try {
    const playerId = request.user!.playerId;
    const collected = await loadCollectedIds(playerId);
    response.json(await questRepository.listByCreator(playerId, collected));
  } catch (error) {
    next(error);
  }
});

app.post("/api/quests", requirePlayer, requireCsrf, async (request: UploadRequest, response, next) => {
  try {
    const playerId = request.user!.playerId;
    const input = parseQuestInput(request.body, { requireTitle: true });
    await assertKnownCollectibles(input.collectibleIds);
    let route;
    if (input.sourceActivityId) {
      const activity = await activityRepository.getActivity(playerId, input.sourceActivityId);
      if (!activity) {
        response.status(404).json({ error: "Activity not found." });
        return;
      }
      route = questRouteFromActivity(activity);
      if (!route) {
        response.status(409).json({ error: "This activity has no route that can become a quest." });
        return;
      }
    }
    const id = await questRepository.create(playerId, {
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.sourceActivityId === undefined ? {} : { sourceActivityId: input.sourceActivityId }),
      collectibleIds: input.collectibleIds,
      ...(route === undefined ? {} : { route })
    });
    const collected = await loadCollectedIds(playerId);
    response.status(201).json(await questRepository.get(playerId, id, collected));
  } catch (error) {
    handleQuestError(error, response, next);
  }
});

app.get("/api/quests/:id", requirePlayer, async (request: UploadRequest, response, next) => {
  try {
    const playerId = request.user!.playerId;
    const collected = await loadCollectedIds(playerId);
    response.json(await questRepository.get(playerId, String(request.params.id), collected));
  } catch (error) {
    handleQuestError(error, response, next);
  }
});

app.patch("/api/quests/:id", requirePlayer, requireCsrf, async (request: UploadRequest, response, next) => {
  try {
    const playerId = request.user!.playerId;
    const input = parseQuestInput(request.body, { requireTitle: false });
    const collectibleIdsProvided = Array.isArray((request.body as Record<string, unknown>)?.collectibleIds);
    if (collectibleIdsProvided) await assertKnownCollectibles(input.collectibleIds);
    await questRepository.update(playerId, String(request.params.id), {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(collectibleIdsProvided ? { collectibleIds: input.collectibleIds } : {})
    });
    const collected = await loadCollectedIds(playerId);
    response.json(await questRepository.get(playerId, String(request.params.id), collected));
  } catch (error) {
    handleQuestError(error, response, next);
  }
});

app.post("/api/quests/:id/publish", requirePlayer, requireCsrf, async (request: UploadRequest, response, next) => {
  try {
    const playerId = request.user!.playerId;
    const questId = String(request.params.id);
    const collected = await loadCollectedIds(playerId);
    const quest = await questRepository.get(playerId, questId, collected);
    if (!quest.isOwner) throw new QuestNotFoundError();
    if (quest.collectibleCount === 0 && !quest.hasRoute) {
      throw new UserInputError("A quest needs at least one collectible or a route before publishing.");
    }
    await questRepository.setStatus(playerId, questId, "published");
    response.json(await questRepository.get(playerId, questId, collected));
  } catch (error) {
    handleQuestError(error, response, next);
  }
});

app.post("/api/quests/:id/unpublish", requirePlayer, requireCsrf, async (request: UploadRequest, response, next) => {
  try {
    const playerId = request.user!.playerId;
    const questId = String(request.params.id);
    await questRepository.setStatus(playerId, questId, "draft");
    const collected = await loadCollectedIds(playerId);
    response.json(await questRepository.get(playerId, questId, collected));
  } catch (error) {
    handleQuestError(error, response, next);
  }
});

app.delete("/api/quests/:id", requirePlayer, requireCsrf, async (request: UploadRequest, response, next) => {
  try {
    await questRepository.remove(request.user!.playerId, String(request.params.id));
    response.status(204).end();
  } catch (error) {
    handleQuestError(error, response, next);
  }
});

app.get("/api/activities/:id", requirePlayer, async (request: UploadRequest, response, next) => {
  try {
    const activity = await activityRepository.getActivity(request.user!.playerId, String(request.params.id));
    if (!activity) {
      response.status(404).json({ error: "Activity not found." });
      return;
    }
    response.json(attachVideoUrls(activity));
  } catch (error) {
    next(error);
  }
});

app.post("/api/activities/:id/video/render", requirePlayer, requireCsrf, async (request: UploadRequest, response) => {
  try {
    const activity = await activityRepository.getActivity(request.user!.playerId, String(request.params.id));
    if (!activity?.video) {
      response.status(404).json({ error: "Activity video not found." });
      return;
    }
    if (activity.video.state !== "awaiting_selection") {
      response.status(409).json({ error: "This video is not ready for highlight selection." });
      return;
    }
    if (busy) {
      response.status(429).json({ error: "The renderer is busy. Try again after the current job finishes." });
      return;
    }
    const events = selectedMappedEvents(activity.video.events, request.body?.sourceIds);
    if (activity.video.sourceDuration === undefined) throw new UserInputError("Video has no source duration.");
    const totalDuration = buildClipIntervals(events, activity.video.sourceDuration).reduce(
      (total, interval) => total + interval.end - interval.start, 0
    );
    if (totalDuration > config.maxOutputDurationSeconds) {
      throw new UserInputError(`Selected clips exceed the ${config.maxOutputDurationSeconds}-second output limit.`);
    }
    busy = true;
    const video = { ...activity.video, state: "rendering" as const, selectedSourceIds: events.map((event) => event.sourceId) };
    await activityRepository.updateActivityVideo(request.user!.playerId, activity.id, video);
    void renderAttachedVideo(request.user!.playerId, { ...activity, video }, events);
    response.status(202).json({ activityId: activity.id, video });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not render selected clips.";
    response.status(error instanceof UserInputError ? 400 : 500).json({ error: message });
  }
});

app.delete("/api/activities/:id/video", requirePlayer, requireCsrf, async (request: UploadRequest, response, next) => {
  try {
    const sourcePath = await activityRepository.removeRetryableActivityVideo(request.user!.playerId, String(request.params.id));
    if (!sourcePath) {
      response.status(409).json({ error: "Only an unavailable video can be cleared for another upload." });
      return;
    }
    await rm(path.dirname(sourcePath), { recursive: true, force: true });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/activities/:id/video/preview", requirePlayer, async (request: UploadRequest, response) => {
  try {
    const paths = await activityRepository.getActivityVideoPaths(request.user!.playerId, String(request.params.id));
    if (!paths?.outputPath) {
      response.status(409).json({ error: "Highlights are not ready." });
      return;
    }
    await access(paths.outputPath);
    response.sendFile(path.resolve(paths.outputPath));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Video unavailable." });
  }
});

app.get("/api/activities/:id/video/download", requirePlayer, async (request: UploadRequest, response) => {
  try {
    const paths = await activityRepository.getActivityVideoPaths(request.user!.playerId, String(request.params.id));
    if (!paths?.outputPath) {
      response.status(409).json({ error: "Highlights are not ready." });
      return;
    }
    await access(paths.outputPath);
    response.download(paths.outputPath, "staza-highlights.mp4");
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Video unavailable." });
  }
});

app.get("/api/player/progress", requirePlayer, async (request: UploadRequest, response, next) => {
  try {
    response.json(await activityRepository.getProgress(request.user!.playerId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/player/progress-dashboard", requirePlayer, async (request: UploadRequest, response, next) => {
  try {
    response.json(await activityRepository.getProgressDashboard(request.user!.playerId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/player/profile", requirePlayer, async (request: UploadRequest, response, next) => {
  try {
    const [profile, collectibles, discoveredSourceIds] = await Promise.all([
      activityRepository.getProfileOverview(request.user!.playerId),
      collectibleRepository.listAll(),
      activityRepository.listDiscoveredCollectibleSourceIds(request.user!.playerId)
    ]);
    const world = createWorldSnapshot(collectibles, discoveredSourceIds);
    response.json({ ...profile, collectibles: world.stats });
  } catch (error) {
    next(error);
  }
});

app.get("/api/jobs/:token", requirePlayer, async (request: UploadRequest, response) => {
  try {
    const { job } = await loadJob(String(request.params.token), request.user!.playerId);
    response.json({
      token: job.token,
      state: job.state,
      error: job.error,
      resultMode: job.resultMode,
      activityReady: Boolean(job.activity && job.activityResult),
      events: job.mappedEvents,
      render: job.render,
      synchronization: job.synchronization,
      world: job.world,
      downloadUrl: job.state === "succeeded" && job.outputFile ? `/api/jobs/${job.token}/download` : undefined
    });
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Unknown job." });
  }
});

app.get("/api/jobs/:token/activity", requirePlayer, async (request: UploadRequest, response) => {
  try {
    const { job } = await loadJob(String(request.params.token), request.user!.playerId);
    if (!job.activity || !job.activityResult || job.state === "processing") {
      response.status(409).json({ error: "Activity results are not ready." });
      return;
    }
    response.json({ activity: job.activity, activityResult: job.activityResult });
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Activity unavailable." });
  }
});

app.post("/api/jobs/:token/render", requirePlayer, requireCsrf, async (request: UploadRequest, response) => {
  try {
    const { job, directory } = await loadJob(String(request.params.token), request.user!.playerId);
    if (job.state !== "awaiting_selection") {
      response.status(409).json({ error: "This job is not ready for selection rendering." });
      return;
    }
    if (busy) {
      response.status(429).json({ error: "The renderer is busy. Try again after the current job finishes." });
      return;
    }
    const events = selectedEvents(job, request.body?.sourceIds ?? request.body?.coinIds);
    if (job.sourceDuration === undefined) throw new UserInputError("Job has no source video duration.");
    const totalDuration = buildClipIntervals(events, job.sourceDuration).reduce(
      (total, interval) => total + interval.end - interval.start,
      0
    );
    if (totalDuration > config.maxOutputDurationSeconds) {
      throw new UserInputError(
        `Selected clips exceed the ${config.maxOutputDurationSeconds}-second output limit.`
      );
    }
    busy = true;
    job.state = "rendering";
    try {
      await saveJob(directory, job);
    } catch (error) {
      busy = false;
      throw error;
    }
    void renderSelection(directory, job, events, activityRepository, request.user!.playerId);
    response.status(202).json({ token: job.token, state: job.state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not render the selected clips.";
    response.status(error instanceof UserInputError ? 400 : 500).json({ error: message });
  }
});

app.get("/api/jobs/:token/download", requirePlayer, async (request: UploadRequest, response) => {
  try {
    const { job, directory } = await loadJob(String(request.params.token), request.user!.playerId);
    if (job.state !== "succeeded" || !job.outputFile) {
      response.status(409).json({ error: "The clip is not ready." });
      return;
    }
    await access(path.join(directory, job.outputFile));
    response.download(path.join(directory, job.outputFile), "coin-clip.mp4");
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Clip unavailable." });
  }
});

app.use((error: Error, request: UploadRequest, response: Response, _next: NextFunction) => {
  console.error("Request failed:", error);
  if (request.jobDir) void cleanupReservation(request);
  const isInputError = error instanceof multer.MulterError || error instanceof UserInputError;
  response.status(isInputError ? 400 : 500).json({
    error: error instanceof multer.MulterError ? `Upload rejected: ${error.message}` : error.message
  });
});

app.listen(config.port, () => {
  console.log(`Post-ride AR POC listening on port ${config.port}`);
});
