export const appRoutes = {
  en: {
    "sign-in": "sign-in",
    register: "register",
    home: "home",
    activities: "activities",
    "activity-detail": "activities",
    world: "world",
    progress: "progress",
    profile: "profile",
    "add-activity": "add-activity"
  },
  de: {
    "sign-in": "anmelden",
    register: "registrieren",
    home: "start",
    activities: "aktivitaeten",
    "activity-detail": "aktivitaeten",
    world: "welt",
    progress: "fortschritt",
    profile: "profil",
    "add-activity": "aktivitaet-hinzufuegen"
  }
};

const screensByRoute = Object.fromEntries(
  Object.entries(appRoutes).map(([locale, routes]) => [
    locale,
    Object.fromEntries(Object.entries(routes).map(([screen, slug]) => [slug, screen]))
  ])
);

export const supportedLocales = ["en", "de"];
export const defaultLocale = "en";
let activeLocale = defaultLocale;

export const setAppLocale = (locale) => {
  activeLocale = supportedLocales.includes(locale) ? locale : defaultLocale;
};

export const getAppLocale = () => activeLocale;

export const resolvePreferredLocale = (languages = []) => {
  for (const language of languages) {
    const locale = String(language).toLowerCase().split(/[-_]/)[0];
    if (supportedLocales.includes(locale)) return locale;
  }
  return defaultLocale;
};

export const appPath = (locale, screen, activityId) => {
  const selectedLocale = supportedLocales.includes(locale) ? locale : defaultLocale;
  const slug = appRoutes[selectedLocale][screen];
  if (!slug) throw new Error(`Unknown app screen: ${screen}`);
  if (screen === "activity-detail" && (activityId === undefined || activityId === null || activityId === "")) {
    throw new Error("An activity ID is required for the activity detail route");
  }
  const suffix = screen === "activity-detail"
    ? `/${encodeURIComponent(String(activityId))}`
    : "";
  return `/${selectedLocale}/${slug}${suffix}`;
};

export const parseAppPath = (pathname, languages = []) => {
  const parts = pathname.split("/").filter(Boolean);
  const explicitLocale = supportedLocales.includes(parts[0]) ? parts[0] : undefined;
  const locale = explicitLocale ?? resolvePreferredLocale(languages);
  const routeIndex = explicitLocale ? 1 : 0;
  const route = parts[routeIndex];
  let screen = screensByRoute[locale][route];
  if (screen === "activity-detail") {
    screen = parts[routeIndex + 1] ? "activity-detail" : "activities";
  }

  if (!explicitLocale && ["app", "sign-in"].includes(route)) {
    return {
      locale,
      screen: "sign-in",
      path: appPath(locale, "sign-in"),
      legacy: true
    };
  }

  if (screen === "activity-detail" && parts[routeIndex + 1]) {
    if (parts.length !== routeIndex + 2) return { locale, screen: "not-found", path: pathname };
    let activityId;
    try {
      activityId = decodeURIComponent(parts[routeIndex + 1]);
    } catch {
      return { locale, screen: "not-found", path: pathname };
    }
    return { locale, screen, activityId, path: appPath(locale, screen, activityId) };
  }

  if (screen && parts.length === routeIndex + 1) {
    return { locale, screen, path: appPath(locale, screen) };
  }

  return { locale, screen: "not-found", path: pathname };
};

const germanCopy = {
  "Staza home": "Staza-Startseite",
  "ADD ACTIVITY": "AKTIVITÄT HINZUFÜGEN",
  Home: "Start",
  Activities: "Aktivitäten",
  Profile: "Profil",
  "Player progress": "Spielerfortschritt",
  "Recent activity": "Letzte Aktivität",
  "RECENT ACTIVITY": "LETZTE AKTIVITÄT",
  "TOTAL XP": "XP GESAMT",
  DISTANCE: "DISTANZ",
  "RARE FINDS": "SELTENE FUNDE",
  COLLECTED: "GESAMMELT",
  "NO COMPLETED ACTIVITIES YET": "NOCH KEINE ABGESCHLOSSENEN AKTIVITÄTEN",
  "Complete a FIT activity to see your latest activity, collectibles, and XP here.": "Schließe eine FIT-Aktivität ab, um hier deine letzte Aktivität, Sammelobjekte und XP zu sehen.",
  "Complete a FIT activity to see your exploration history here.": "Schließe eine FIT-Aktivität ab, um hier deinen Erkundungsverlauf zu sehen.",
  "Your exploration history": "Dein Erkundungsverlauf",
  "View recent activity": "Letzte Aktivität ansehen",
  "No collectibles were recorded on this activity.": "Bei dieser Aktivität wurden keine Sammelobjekte erfasst.",
  "Activity history": "Aktivitätenverlauf",
  "Distance unavailable": "Distanz nicht verfügbar",
  "Duration unavailable": "Dauer nicht verfügbar",
  "Loading Home...": "Startseite wird geladen …",
  "Loading activities...": "Aktivitäten werden geladen …",
  "Loading World...": "Welt wird geladen …",
  "Loading Progress...": "Fortschritt wird geladen …",
  "Unable to load Home: ": "Startseite konnte nicht geladen werden: ",
  "Unable to load World: ": "Welt konnte nicht geladen werden: ",
  "Unable to load Progress: ": "Fortschritt konnte nicht geladen werden: ",
  "World": "Welt",
  "Discover what is worth exploring": "Entdecke, was sich zu erkunden lohnt",
  Discovered: "Entdeckt",
  "World collectibles": "Sammelobjekte der Welt",
  All: "Alle",
  Found: "Gefunden",
  Unfound: "Nicht gefunden",
  Rare: "Selten",
  Epic: "Episch",
  "visited here": "hier besucht",
  "remaining": "übrig",
  "Zoom in to see everything here": "Vergrößere die Karte, um alles hier zu sehen",
  "LOCATE ME": "MEINEN STANDORT",
  "Progress": "Fortschritt",
  "Your exploration journey": "Dein Erkundungsfortschritt",
  "km covered": "km zurückgelegt",
  collectibles: "Sammelobjekte",
  "rare or better": "selten oder besser",
  COMPLETE: "ABGESCHLOSSEN",
  CURRENT: "AKTUELL",
  "needed": "benötigt",
  "to Level ": "bis Level ",
  "RECENT ACTIVITIES": "LETZTE AKTIVITÄTEN",
  "Activity · ": "Aktivität · ",
  " found": " gefunden",
  "Your account": "Dein Konto",
  "Level progress": "Level-Fortschritt",
  "EXPLORER RECORD": "ERKUNDER-STATISTIK",
  "Total XP earned": "XP insgesamt",
  "Activities completed": "Abgeschlossene Aktivitäten",
  "Collectibles found": "Gefundene Sammelobjekte",
  "Rare & epic": "Selten & episch",
  "ACCOUNT & SECURITY": "KONTO & SICHERHEIT",
  "Account email": "Konto-E-Mail",
  "Manage registered passkeys": "Registrierte Passkeys verwalten",
  "Sign out or manage active devices": "Abmelden oder aktive Geräte verwalten",
  "Account & Security": "Konto & Sicherheit",
  "Authentication and account settings": "Anmelde- und Kontoeinstellungen",
  "ACCOUNT EMAIL": "KONTO-E-MAIL",
  Verified: "Bestätigt",
  "Not verified": "Nicht bestätigt",
  PASSKEYS: "PASSKEYS",
  "Manage passkeys": "Passkeys verwalten",
  registered: "registriert",
  "Add passkey": "Passkey hinzufügen",
  "Passkeys use your device to sign in without a password.": "Mit Passkeys meldest du dich ohne Passwort über dein Gerät an.",
  SESSIONS: "SITZUNGEN",
  "Sign out": "Abmelden",
  "Sign out all devices": "Auf allen Geräten abmelden",
  "Ends all active sessions including this one": "Beendet alle aktiven Sitzungen einschließlich dieser",
  "PRIVACY & ACCOUNT": "DATENSCHUTZ & KONTO",
  "Export my data": "Meine Daten exportieren",
  "Download a copy of your account and activity data": "Eine Kopie deiner Konto- und Aktivitätsdaten herunterladen",
  "DANGER ZONE": "GEFAHRENBEREICH",
  "Delete account": "Konto löschen",
  "Permanently removes your account and data": "Entfernt dein Konto und deine Daten dauerhaft",
  "Keep at least one passkey registered. You can still sign in with an email code.": "Behalte mindestens einen Passkey. Du kannst dich weiterhin mit einem E-Mail-Code anmelden.",
  "Delete account.": "Konto löschen.",
  "This permanently removes your account, authentication credentials, and associated data.": "Dadurch werden dein Konto, deine Anmeldedaten und die zugehörigen Daten dauerhaft entfernt.",
  "THIS WILL PERMANENTLY DELETE": "DIES WIRD DAUERHAFT GELÖSCHT",
  "Your account and sign-in credentials": "Dein Konto und deine Anmeldedaten",
  "All activity and exploration data": "Alle Aktivitäts- und Erkundungsdaten",
  "Collectibles and progression history": "Sammelobjekte und Fortschrittsverlauf",
  "Associated passkeys and sessions": "Zugehörige Passkeys und Sitzungen",
  "I understand this action is permanent and cannot be undone.": "Ich verstehe, dass diese Aktion dauerhaft und nicht rückgängig zu machen ist.",
  "Confirm your email": "E-Mail bestätigen",
  "Enter the code sent to your account email to continue.": "Gib den an deine Konto-E-Mail gesendeten Code ein, um fortzufahren.",
  "Verification code": "Bestätigungscode",
  Continue: "Weiter",
  Cancel: "Abbrechen",
  "Loading Profile...": "Profil wird geladen …",
  "Unable to load Profile. Try again.": "Profil konnte nicht geladen werden. Versuche es erneut.",
  "Unable to start verification. Try again.": "Bestätigung konnte nicht gestartet werden. Versuche es erneut.",
  "We couldn't add your passkey. Try again.": "Passkey konnte nicht hinzugefügt werden. Versuche es erneut.",
  "Unable to complete that action. Try again.": "Aktion konnte nicht abgeschlossen werden. Versuche es erneut.",
  "This code is invalid or has expired. Try again.": "Dieser Code ist ungültig oder abgelaufen. Versuche es erneut.",
  "View activity from ": "Aktivität vom ",
  "Add Activity": "Aktivität hinzufügen",
  "Import a FIT file to start discovering": "Importiere eine FIT-Datei, um mit dem Entdecken zu beginnen",
  ACTIVITY: "AKTIVITÄT",
  "Your activity from Garmin, Wahoo, or any FIT-compatible device": "Deine Aktivität von Garmin, Wahoo oder einem FIT-kompatiblen Gerät",
  "PROCESS ACTIVITY": "AKTIVITÄT VERARBEITEN",
  "Choose a FIT activity file before processing.": "Wähle vor der Verarbeitung eine FIT-Aktivitätsdatei aus.",
  "Unable to import activity.": "Aktivität konnte nicht importiert werden.",
  "Activity Ready": "Aktivität bereit",
  "VIEW ACTIVITY": "AKTIVITÄT ANSEHEN",
  "Reading GPS route": "GPS-Route wird gelesen",
  "Matching collectibles": "Sammelobjekte werden abgeglichen",
  "Calculating XP": "XP werden berechnet",
  "Building replay": "Wiedergabe wird erstellt",
  "Processing Activity": "Aktivität wird verarbeitet",
  "Discovering collectibles along your route": "Sammelobjekte entlang deiner Route werden gesucht",
  "Remove ACTIVITY FILE": "AKTIVITÄTSDATEI ENTFERNEN",
  "Remove VIDEO FILE": "VIDEODATEI ENTFERNEN",
  "CREATE QUEST": "QUEST ERSTELLEN",
  BACK: "ZURÜCK",
  "Preparing quest draft...": "Quest-Entwurf wird vorbereitet …",
  COLLECTIBLES: "SAMMELOBJEKTE",
  "NO COLLECTIBLES FOUND": "KEINE SAMMELOBJEKTE GEFUNDEN",
  "No collectible events were recorded on this activity.": "Bei dieser Aktivität wurden keine Sammelobjekte erfasst.",
  "Collected items": "Gesammelte Objekte",
  "Activity route": "Aktivitätsroute",
  "View activity from": "Aktivität vom",
  "Sign in": "Anmelden",
  "Welcome back": "Willkommen zurück",
  "Continue with passkey": "Mit Passkey fortfahren",
  "Use email code": "E-Mail-Code verwenden",
  "Secure, passwordless sign-in": "Sichere Anmeldung ohne Passwort",
  "New to Staza? ": "Neu bei Staza? ",
  "Create an account": "Konto erstellen",
  "Checking your session": "Sitzung wird überprüft",
  "Create your account": "Konto erstellen",
  "Sign in with email": "Mit E-Mail anmelden",
  "We'll send you a one-time code.": "Wir senden dir einen einmaligen Code.",
  Email: "E-Mail",
  "Send code": "Code senden",
  "Sending code…": "Code wird gesendet …",
  "Enter code": "Code eingeben",
  "Check your email.": "Prüfe dein E-Mail-Postfach.",
  "We sent a one-time code to ": "Wir haben einen einmaligen Code an ",
  "Verifying…": "Wird bestätigt …",
  "Verify code": "Code bestätigen",
  "Send a new code": "Neuen Code senden",
  "Secure your account": "Sichere dein Konto",
  "Create a passkey for faster sign-in.": "Erstelle einen Passkey für eine schnellere Anmeldung.",
  "No password needed": "Kein Passwort nötig",
  "Sign in with your device — no credentials to remember.": "Melde dich mit deinem Gerät an – keine Zugangsdaten zum Merken.",
  "Uses device security": "Nutzt die Gerätesicherheit",
  "Face ID, Touch ID, Windows Hello, or your device PIN.": "Face ID, Touch ID, Windows Hello oder die Geräte-PIN.",
  "Private by default": "Standardmäßig privat",
  "Your biometric data never leaves your device.": "Deine biometrischen Daten verlassen niemals dein Gerät.",
  "Creating passkey…": "Passkey wird erstellt …",
  "Create passkey": "Passkey erstellen",
  "Passkey ready": "Passkey bereit",
  "Your account is secured.": "Dein Konto ist jetzt sicher.",
  "You can now sign in instantly with your device.": "Du kannst dich jetzt sofort mit deinem Gerät anmelden.",
  "Continue to Staza": "Weiter zu Staza",
  "Passkey unavailable": "Passkey nicht verfügbar",
  "Passkeys aren't available on this device.": "Passkeys sind auf diesem Gerät nicht verfügbar.",
  "Sign-in issue": "Anmeldeproblem",
  "We couldn't verify your sign-in.": "Deine Anmeldung konnte nicht bestätigt werden.",
  "Try again": "Erneut versuchen",
  "We couldn't send a code. Try again.": "Code konnte nicht gesendet werden. Versuche es erneut.",
  "This code is invalid or has expired. Request a new one.": "Dieser Code ist ungültig oder abgelaufen. Fordere einen neuen an.",
  "Passkey sign-in was cancelled.": "Passkey-Anmeldung wurde abgebrochen.",
  "Use an email code to sign in on this device.": "Melde dich auf diesem Gerät mit einem E-Mail-Code an.",
  "Something went wrong during sign-in. Try again, or use email code.": "Bei der Anmeldung ist ein Fehler aufgetreten. Versuche es erneut oder nutze einen E-Mail-Code.",
  "We couldn't create your passkey. Try again.": "Passkey konnte nicht erstellt werden. Versuche es erneut.",
  "Create a passkey to finish securing your account.": "Erstelle einen Passkey, um dein Konto vollständig zu schützen.",
  "View activity": "Aktivität ansehen",
  "World map": "Weltkarte",
  "Adventurer": "Abenteurer",
  "Pathfinder": "Wegfinder",
  "Trailblazer": "Wegbereiter",
  "Waymaker": "Pionier",
  "Loading activity detail...": "Aktivitätsdetails werden geladen …",
  "Unable to load activity detail.": "Aktivitätsdetails konnten nicht geladen werden.",
  "Unable to load the replay map.": "Wiedergabekarte konnte nicht geladen werden.",
  "Unable to check your session.": "Sitzung konnte nicht überprüft werden.",
  "Activity selected": "Aktivität ausgewählt",
  "Activity detail": "Aktivitätsdetails",
  "Activity Detail": "Aktivitätsdetails",
  "ACTIVITY DETAIL": "AKTIVITÄTSDETAILS",
  "is ready for the Activity Detail experience.": "ist für die Aktivitätsansicht bereit.",
  "Replay data is unavailable for this legacy activity.": "Wiedergabedaten sind für diese ältere Aktivität nicht verfügbar.",
  "Open World to see it.": "Öffne die Welt, um sie anzusehen.",
  "Save draft": "Entwurf speichern",
  "Create route": "Route erstellen",
  "Coming soon": "Demnächst verfügbar",
  "Level": "Level",
  "LEVEL": "LEVEL",
  "POV available": "POV verfügbar",
  "Loading quest...": "Quest wird geladen …",
  "Current level": "Aktuelles Level",
  "Added": "Hinzugefügt",
  "Last used": "Zuletzt verwendet",
  "To Level": "bis Level",
  "Activity progression": "Aktivitätsfortschritt",
  "DISTANCE UNAVAILABLE": "DISTANZ NICHT VERFÜGBAR",
  "DURATION UNAVAILABLE": "DAUER NICHT VERFÜGBAR",
  "XP EARNED": "XP ERHALTEN",
  FOUND: "GEFUNDEN",
  Explorer: "Entdecker",
  REPLAY: "WIEDERGABE",
  VIDEO: "VIDEO",
  "Drop file here or click": "Datei hier ablegen oder klicken",
  ".fit files supported": "FIT-Dateien werden unterstützt",
  "Add video (optional)": "Video hinzufügen (optional)",
  "Attach video": "Video anhängen",
  "Add GoPro footage now or attach it later": "GoPro-Aufnahmen jetzt hinzufügen oder später anhängen",
  "Choose matching GoPro footage": "Passende GoPro-Aufnahmen auswählen",
  "CHOOSE FILE": "DATEI AUSWÄHLEN",
  REMOVE: "ENTFERNEN",
  "NO VIDEO ATTACHED": "KEIN VIDEO ANGEHÄNGT",
  "Add your activity video": "Aktivitätsvideo hinzufügen",
  "No video attached to this activity yet. Video is optional—add your GoPro or action-camera footage to create automatic highlights.": "Für diese Aktivität ist noch kein Video angehängt. Ein Video ist optional – füge GoPro- oder Actionkamera-Aufnahmen hinzu, um automatisch Highlights zu erstellen.",
  "ATTACH VIDEO": "VIDEO ANHÄNGEN",
  "CREATING HIGHLIGHTS": "HIGHLIGHTS WERDEN ERSTELLT",
  "ANALYSING VIDEO": "VIDEO WIRD ANALYSIERT",
  "Rendering selected moments": "Ausgewählte Momente werden gerendert",
  "Analysing Video": "Video wird analysiert",
  "Your selected highlights are rendering.": "Deine ausgewählten Highlights werden gerendert.",
  "Matching footage to your activity data": "Aufnahmen werden deinen Aktivitätsdaten zugeordnet",
  "Reading Video": "Video wird gelesen",
  "Reading FIT File": "FIT-Datei wird gelesen",
  "Searching Collectibles": "Sammelobjekte werden gesucht",
  "HIGHLIGHT FAILED": "HIGHLIGHT FEHLGESCHLAGEN",
  "Your activity and collected items are unchanged.": "Deine Aktivität und gesammelten Objekte bleiben unverändert.",
  "Your source video is preserved.": "Dein Originalvideo bleibt erhalten.",
  "Highlight selection": "Highlight-Auswahl",
  "Select which moments to include in your highlight video": "Wähle aus, welche Momente in deinem Highlight-Video erscheinen sollen",
  "Select All": "Alle auswählen",
  "Clear All": "Auswahl aufheben",
  "GENERATE HIGHLIGHTS": "HIGHLIGHTS ERSTELLEN",
  "NO HIGHLIGHTS FOUND": "KEINE HIGHLIGHTS GEFUNDEN",
  "No collectible moments were found in this video.": "In diesem Video wurden keine Sammelmomente gefunden.",
  "This video could not be matched to the moments collected on this activity.": "Dieses Video konnte den Sammelmomenten dieser Aktivität nicht zugeordnet werden.",
  "Your source video is attached, but none of this activity’s collected events map to its timeline.": "Dein Originalvideo ist angehängt, aber keines der Sammelereignisse dieser Aktivität lässt sich seiner Zeitleiste zuordnen.",
  "TRY AGAIN": "ERNEUT VERSUCHEN",
  CLOSE: "SCHLIESSEN",
  "Auto-generated highlights": "Automatisch erstellte Highlights",
  "Auto-Generated Highlights": "Automatisch erstellte Highlights",
  "DOWNLOAD VIDEO": "VIDEO HERUNTERLADEN",
  Visited: "Besucht",
  Unvisited: "Nicht besucht",
  "Part of": "Teil von",
  Viewpoint: "Aussichtspunkt",
  Peak: "Gipfel",
  Castle: "Burg",
  Waterfall: "Wasserfall",
  Place: "Ort",
  Draft: "Entwurf",
  Complete: "Abgeschlossen",
  "No collectibles yet": "Noch keine Sammelobjekte",
  "No collectibles yet.": "Noch keine Sammelobjekte.",
  Completed: "Abgeschlossen",
  DELETE: "LÖSCHEN",
  "Delete this quest permanently? This removes it for all users and cannot be undone.": "Diese Quest dauerhaft löschen? Sie wird für alle Nutzer entfernt. Dies kann nicht rückgängig gemacht werden.",
  "Nearby miss": "Knapp verpasst",
  "Collection detail": "Sammlungsdetails",
  "This quest has no collectibles yet.": "Diese Quest enthält noch keine Sammelobjekte.",
  "CREATE ROUTE": "ROUTE ERSTELLEN",
  "COMING SOON": "DEMNÄCHST VERFÜGBAR",
  EDIT: "BEARBEITEN",
  UNPUBLISH: "VERÖFFENTLICHUNG AUFHEBEN",
  PUBLISH: "VERÖFFENTLICHEN",
  "Quests nearby": "Quests in der Nähe",
  "Pan or zoom the map to look somewhere else.": "Verschiebe oder zoome die Karte, um andere Orte anzusehen.",
  Route: "Route",
  "Quest detail": "Quest-Details",
  "Edit quest": "Quest bearbeiten",
  "Create quest": "Quest erstellen",
  Title: "Titel",
  Description: "Beschreibung",
  "Collectibles": "Sammelobjekte",
  "selected": "ausgewählt",
  "No collectibles were encountered on this activity.": "Bei dieser Aktivität wurden keine Sammelobjekte gefunden.",
  CANCEL: "ABBRECHEN",
  "SAVE DRAFT": "ENTWURF SPEICHERN",
  "SAVE & KEEP PUBLISHED": "SPEICHERN & VERÖFFENTLICHT LASSEN",
  "Unable to save this quest.": "Quest konnte nicht gespeichert werden.",
  "A quest needs a title.": "Eine Quest benötigt einen Titel.",
  "Nothing curated here yet.": "Hier gibt es noch keine kuratierten Inhalte.",
  "Location is not available in this browser.": "Der Standort ist in diesem Browser nicht verfügbar.",
  "Location permission was denied. Pan and zoom to explore.": "Der Standortzugriff wurde verweigert. Verschiebe und zoome die Karte, um die Umgebung zu erkunden.",
  "Video has no source duration.": "Für das Video ist keine Quelldauer verfügbar.",
  "ACTIVITY FILE": "AKTIVITÄTSDATEI",
  "VIDEO FILE": "VIDEODATEI",
  "Activity video": "Aktivitätsvideo",
  "Route for activity from ": "Route der Aktivität vom ",
  "Route for activity": "Aktivitätsroute",
  "Level ": "Level ",
  " to Level ": " bis Level ",
  " collectibles": " Sammelobjekte",
  "activity · ": "Aktivität · ",
  "activities · ": "Aktivitäten · ",
  "explored ·": "erkundet ·",
  "earned ·": "erhalten ·",
  "collectibles found": "Sammelobjekte gefunden",
  " visited here": " hier besucht",
  " remaining": " übrig",
  " km covered": " km zurückgelegt",
  "No account was found for this email. Create one with a new verification code.": "Für diese E-Mail wurde kein Konto gefunden. Erstelle mit einem neuen Bestätigungscode ein Konto.",
  "Ride complete": "Fahrt abgeschlossen",
  "Run complete": "Lauf abgeschlossen",
  "Hike complete": "Wanderung abgeschlossen",
  "Walk complete": "Spaziergang abgeschlossen",
  "Activity complete": "Aktivität abgeschlossen",
  "Unable to load the map: ": "Karte konnte nicht geladen werden: ",
  "Unable to load activities: ": "Aktivitäten konnten nicht geladen werden: ",
  "Your activity was saved, but video processing could not start: ": "Deine Aktivität wurde gespeichert, aber die Videoverarbeitung konnte nicht gestartet werden: ",
  "We could not synchronize this video (": "Dieses Video konnte nicht synchronisiert werden (",
  "We could not process this video.": "Dieses Video konnte nicht verarbeitet werden.",
  "Unable to update activity video.": "Aktivitätsvideo konnte nicht aktualisiert werden.",
  "Choose a video file before attaching it.": "Wähle vor dem Anhängen eine Videodatei aus.",
  "The world is": "Die Welt ist",
  "Journey": "Weg",
  "by ": "von ",
  " published.": " veröffentlicht.",
  " saved as a draft.": " als Entwurf gespeichert.",
  " Open World to see it.": " Öffne die Welt, um sie anzusehen.",
  "No collectibles on this activity.": "Keine Sammelobjekte bei dieser Aktivität.",
  "Unable to load World data.": "Weltdaten konnten nicht geladen werden.",
  "Unable to load Progress data.": "Fortschrittsdaten konnten nicht geladen werden.",
  "Unable to load Home data.": "Startseitendaten konnten nicht geladen werden.",
  "Sign in to continue exploring.": "Melde dich an, um weiter zu entdecken.",
  "New to Staza?": "Neu bei Staza?",
  "Six digit verification code": "Sechsstelliger Bestätigungscode",
  "Back": "Zurück",
  "Authentication": "Anmeldung",
  "Close": "Schließen",
  "Source: ": "Quelle: ",
  "Remove": "Entfernen",
  "Create account": "Konto erstellen",
  "Profile navigation": "Profilnavigation",
  "Primary navigation": "Hauptnavigation",
  "Level journey": "Level-Fortschritt",
  "Show collectibles": "Sammelobjekte anzeigen",
  "Play replay": "Wiedergabe starten",
  "Pause replay": "Wiedergabe pausieren",
  "Animated route replay": "Animierte Routenwiedergabe",
  "Collectibles on the map": "Sammelobjekte auf der Karte",
  "Activity detail sections": "Aktivitätsbereiche",
  "Replay collection": "Wiedergabe-Sammlung",
  "Collectible detail": "Sammelobjekt-Details",
  "Close collectible detail": "Sammelobjekt-Details schließen",
  "Close quest editor": "Quest-Editor schließen",
  "you@example.com": "du@beispiel.de",
  " XP needed": " XP erforderlich",
  "Current level ": "Aktuelles Level ",
  "Quest \"": "Quest „",
  "Published": "Veröffentlicht",
  "Unpublish": "Veröffentlichung aufheben",
  "Delete Account": "Konto löschen",
  "Page not found": "Seite nicht gefunden",
  "Activity": "Aktivität",
  "Distance": "Distanz",
  "Passkeys": "Passkeys",
  "‹ Profile": "‹ Profil",
  "‹ Account & Security": "‹ Konto & Sicherheit",
  "The sign-in check failed": "Die Anmeldeprüfung ist fehlgeschlagen"
};

export const appCopy = {
  en: Object.fromEntries(Object.keys(germanCopy).map((text) => [text, text])),
  de: germanCopy
};

const appCopyKeys = Object.keys(appCopy.en).sort((left, right) => right.length - left.length);

export const translateAppText = (text, locale) => appCopy[locale]?.[text] ?? text;

const translatedPrefixes = [
  ["Unable to load Home: ", "Startseite konnte nicht geladen werden: "],
  ["Unable to load activities: ", "Aktivitäten konnten nicht geladen werden: "],
  ["Unable to load World: ", "Welt konnte nicht geladen werden: "],
  ["Unable to load Progress: ", "Fortschritt konnte nicht geladen werden: "],
  ["We sent a one-time code to ", "Wir haben einen einmaligen Code an "],
  ["We couldn't send a code. ", "Code konnte nicht gesendet werden. "],
  ["Unable to load activities", "Aktivitäten konnten nicht geladen werden"],
  ["View activity from ", "Aktivität vom "],
  ["Route for activity from ", "Route der Aktivität vom "]
];

export const translateAppTextNode = (text, locale) => {
  const exact = translateAppText(text, locale);
  if (exact !== text || locale !== "de") return exact;
  const trimmed = text.trim();
  const leading = text.slice(0, text.indexOf(trimmed));
  const trailing = text.slice(text.indexOf(trimmed) + trimmed.length);
  const translation = translatedPrefixes.find(([source]) => trimmed.startsWith(source));
  if (translation) return `${leading}${translation[1]}${trimmed.slice(translation[0].length)}${trailing}`;
  const dynamicTranslations = [
    [/^(\d+) activity ·$/, "$1 Aktivität ·"],
    [/^(\d+) activities ·$/, "$1 Aktivitäten ·"],
    [/^(\d+) collectibles found$/, "$1 Sammelobjekte gefunden"],
    [/^(\d+) visited here$/, "$1 hier besucht"],
    [/^(\d+) remaining$/, "$1 übrig"],
    [/^(\d+) \/ (\d+) completed$/, "$1 / $2 abgeschlossen"],
    [/^(\d+) of (\d+) selected$/, "$1 von $2 ausgewählt"],
    [/^(\d+) Collectibles Found$/, "$1 Sammelobjekte gefunden"],
    [/^(\d+) collected$/, "$1 gesammelt"],
    [/^(\d+) collectibles$/, "$1 Sammelobjekte"],
    [/^(\d+)h (\d+)m$/, "$1 Std. $2 Min."],
    [/^(\d+)m$/, "$1 Min."],
    [/^(\d+) XP to Level (\d+)$/, "$1 XP bis Level $2"],
    [/^(\d+) to Level (\d+)$/, "$1 bis Level $2"],
    [/^Level (\d+)$/, "Level $1"],
    [/^LEVEL (\d+)$/, "LEVEL $1"],
    [/^Current level (\d+)$/, "Aktuelles Level $1"],
    [/^EXPLORER · LEVEL (\d+)$/, "ENTDECKER · LEVEL $1"],
    [/^(\d+) registered on your account$/, "$1 für dein Konto registriert"],
    [/^(\d+) moment$/, "$1 Moment"],
    [/^(\d+) moments$/, "$1 Momente"]
  ];
  for (const [pattern, replacement] of dynamicTranslations) {
    if (pattern.test(trimmed)) return `${leading}${trimmed.replace(pattern, replacement)}${trailing}`;
  }
  return appCopyKeys.reduce((localized, source) => {
    if (source.length < 4) return localized;
    return localized.replaceAll(source, appCopy.de[source]);
  }, text);
};

export const localizeAppUi = (root, locale) => {
  if (!root || locale === "en") return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, [data-user-content]")) continue;
    const current = node.nodeValue ?? "";
    const translated = translateAppTextNode(current, locale);
    if (translated !== current) node.nodeValue = translated;
  }
  for (const element of root.querySelectorAll("*")) {
    if (element.closest("[data-user-content]")) continue;
    for (const attribute of ["aria-label", "placeholder", "title", "alt"]) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      const translated = translateAppTextNode(value, locale);
      if (translated !== value) element.setAttribute(attribute, translated);
    }
  }
};
