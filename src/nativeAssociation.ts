export interface NativeAssociationConfig {
  appleAppIds: string[];
  androidPackageName?: string;
  androidSha256CertFingerprints: string[];
}

/** Apple App Site Association document; empty until APPLE_APP_IDS is configured. */
export const appleAppSiteAssociation = (config: NativeAssociationConfig): unknown => ({
  applinks: { details: [{ appIDs: config.appleAppIds, components: [{ "/": "/*" }] }] },
  webcredentials: { apps: config.appleAppIds }
});

/** Android Digital Asset Links statements; empty until package name and fingerprints are configured. */
export const androidAssetLinks = (config: NativeAssociationConfig): unknown[] =>
  config.androidPackageName && config.androidSha256CertFingerprints.length
    ? [{
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: {
        namespace: "android_app",
        package_name: config.androidPackageName,
        sha256_cert_fingerprints: config.androidSha256CertFingerprints
      }
    }]
    : [];
