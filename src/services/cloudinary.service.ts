import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function validarConfiguracion() {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error(
      'Falta la configuración de Cloudinary en las variables de entorno',
    );
  }
}

export async function subirAvatarDesdeUrl(params: {
  imageUrl: string;
  usuario: string;
}) {
  validarConfiguracion();

  const imageUrl = params.imageUrl.trim();
  const usuario = params.usuario.trim();

  if (!imageUrl) {
    throw new Error('Falta la URL de la imagen');
  }

  const resultado = await cloudinary.uploader.upload(imageUrl, {
    folder: 'clubreads/avatars',
    public_id: usuario || undefined,
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
    transformation: [
      {
        width: 600,
        height: 600,
        crop: 'fill',
        gravity: 'auto',
        quality: 'auto',
        fetch_format: 'auto',
      },
    ],
  });

  return {
    url: resultado.secure_url,
    publicId: resultado.public_id,
  };
}

export async function subirAvatarDesdeBase64(params: {
  imageBase64: string;
  usuario: string;
}) {
  validarConfiguracion();

  const imageBase64 = params.imageBase64.trim();
  const usuario = params.usuario.trim();

  if (!imageBase64) {
    throw new Error('Falta la imagen');
  }

  const resultado = await cloudinary.uploader.upload(imageBase64, {
    folder: 'clubreads/avatars',
    public_id: usuario || undefined,
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
    transformation: [
      {
        width: 600,
        height: 600,
        crop: 'fill',
        gravity: 'auto',
        quality: 'auto',
        fetch_format: 'auto',
      },
    ],
  });

  return {
    url: resultado.secure_url,
    publicId: resultado.public_id,
  };
}