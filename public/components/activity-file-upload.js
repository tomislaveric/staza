import { UploadDropzone } from "./upload-dropzone.js";
import { UploadFileRow } from "./upload-file-row.js";

export const ActivityFileUpload = (file) => file
  ? UploadFileRow({ file, kind: "ACTIVITY FILE" })
  : UploadDropzone({
    id: "activity-file",
    name: "fit",
    label: "Drop file here or click",
    detail: ".fit and .gpx files supported",
    accept: ".fit,.gpx,application/octet-stream,application/gpx+xml,text/xml",
    required: true
  });
