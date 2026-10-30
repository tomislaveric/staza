import path from "node:path";

/** Returns the media directory for a stored file, refusing anything outside the media root. */
export const mediaDirectoryFor = (sourcePath: string, mediaRoot: string): string => {
  const directory = path.resolve(path.dirname(sourcePath));
  const relative = path.relative(path.resolve(mediaRoot), directory);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Activity video is outside MEDIA_DIR; refusing to remove it: ${sourcePath}`);
  }
  return directory;
};
