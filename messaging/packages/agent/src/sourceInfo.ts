// SPDX-License-Identifier: AGPL-3.0-only
export type SourceInfo={version:string;sourceUrl?:string|null;sourceSha256?:string;manifestUrl?:string;sourceManifestSha256?:string;licenseUrl?:string;noticesUrl?:string;noticeUrls?:string[];disclosureUrl?:string;sourceStatus?:string}
export function licenseInfo(sourceInfo?:SourceInfo){
  return {license:'AGPL-3.0-only' as const,clientLicense:'MIT' as const,version:sourceInfo?.version??'0.2.0',sourceUrl:sourceInfo?.sourceUrl??null,...sourceInfo,sourceStatus:sourceInfo?.sourceStatus??'development'}
}
