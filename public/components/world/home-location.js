export const HOME_LOCATION_STORAGE_KEY = "staza.world.home-location";

export const isValidHomeLocation = (location) =>
  Number.isFinite(location?.latitude)
  && location.latitude >= -90
  && location.latitude <= 90
  && Number.isFinite(location?.longitude)
  && location.longitude >= -180
  && location.longitude <= 180;

export const readHomeLocation = (storage = globalThis.localStorage) => {
  if (!storage) return undefined;
  const serialized = storage.getItem(HOME_LOCATION_STORAGE_KEY);
  if (serialized === null) return undefined;

  let location;
  try {
    location = JSON.parse(serialized);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }

  return isValidHomeLocation(location)
    ? { latitude: location.latitude, longitude: location.longitude }
    : undefined;
};

export const saveHomeLocation = (location, storage = globalThis.localStorage) => {
  if (!isValidHomeLocation(location)) {
    throw new TypeError("A valid latitude and longitude are required to save the home location.");
  }
  if (!storage) throw new Error("Browser local storage is unavailable.");
  storage.setItem(HOME_LOCATION_STORAGE_KEY, JSON.stringify({
    latitude: location.latitude,
    longitude: location.longitude
  }));
};
