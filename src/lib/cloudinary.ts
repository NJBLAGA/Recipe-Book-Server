import { v2 as cloudinary } from 'cloudinary';

// CLOUDINARY_CLOUD_NAME may have been set to the full URL string
// (e.g. "CLOUDINARY_URL=cloudinary://key:secret@cloudname") by mistake.
// Extract just the cloud name if that's the case.
const rawCloudName = process.env.CLOUDINARY_CLOUD_NAME ?? '';
const urlMatch = rawCloudName.match(/cloudinary:\/\/[^:]+:[^@]+@([^/\s]+)/);
const cloudName = urlMatch ? urlMatch[1] : rawCloudName;

cloudinary.config({
  cloud_name: cloudName,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadImage(buffer: Buffer, folder: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Upload failed'));
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

export async function deleteImage(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}

export function extractPublicId(url: string): string {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
  return match?.[1] ?? '';
}
