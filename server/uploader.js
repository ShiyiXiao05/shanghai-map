import { v2 as cloudinary } from 'cloudinary';

// Cloudinary 上传器：照片存 CDN，数据库只存链接。
// 未配置 CLOUDINARY_URL 时返回 disabled，照片走数据库 base64 的兜底路径。
export function createCloudinaryUploader(cloudinaryUrl) {
  if (!cloudinaryUrl) {
    return {
      configured: false,
      async upload() {
        throw new Error('未配置 CLOUDINARY_URL');
      },
      async destroy() {},
    };
  }
  cloudinary.config(cloudinaryUrl);
  return {
    configured: true,
    async upload(dataUrl, { folder }) {
      const result = await cloudinary.uploader.upload(dataUrl, {
        folder,
        resource_type: 'image',
      });
      const cloudName = cloudinary.config().cloud_name;
      const thumbUrl =
        `https://res.cloudinary.com/${cloudName}/image/upload/` +
        `w_480,c_fill,q_auto,f_auto/${result.public_id}.${result.format}`;
      return { publicId: result.public_id, url: result.secure_url, thumbUrl };
    },
    async destroy(publicId) {
      await cloudinary.uploader.destroy(publicId);
    },
  };
}
